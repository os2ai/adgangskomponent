Adgangskomponent
================

This component bridges the gap between Fælleskommunal Adgangsstyring (FKA) and applications authenticating with OIDC.
It consists of a Keycloak instance (relying on keycloak-operator) and realm bootstrapping; and a small admin UI for managing certificates.

When well-configured the system maps from FKA privileges to fields on the access token produced when authenticating through the Keycloak instance.
This allows the delegation of roles and other authorization through OIDC-based authentication, based on privileges assigned through FKA.

## OIDC script-based protocol mapper

The Keycloak instance mounts `oidc-script-based-protocol-mapper.jar` (a plain zip of `charts/adgangskomponent/files/providers/oidc-script-based-protocol-mapper/`, containing only the SPI service descriptor) into `/opt/keycloak/providers/` via a ConfigMap rendered from `charts/adgangskomponent/files/providers/oidc-script-based-protocol-mapper.jar`.

The jar is a build artifact (gitignored) and is built by CI before `helm package`.
Build it manually before installing from a checkout:

```sh
(cd charts/adgangskomponent && SRC=files/providers/oidc-script-based-protocol-mapper && \
 TZ=UTC find "$SRC" -exec touch -h -t 198001010000 {} + && \
 (cd "$SRC" && TZ=UTC find . -type f | sort | TZ=UTC zip -q -X -D -@ ../oidc-script-based-protocol-mapper.jar))
```

### Verifying the jar in a published chart

The jar is built deterministically (fixed mtimes, sorted file order, UTC), so its contents can be
verified independently against the repository sources at a given tag:

1. Inspect the published chart for the recorded digests:
   `helm inspect chart oci://ghcr.io/os2ai/adgangskomponent --version <ver>` —
   the `annotations` include `dk.os2ai.provider-jar-sha256` (the jar's sha256) and
   `org.opencontainers.image.revision` (the git commit it was built from).
2. `helm pull` the chart, extract `files/providers/oidc-script-based-protocol-mapper.jar` from it,
   and confirm `sha256sum` matches the annotation.
3. Check out the annotated revision and rebuild the jar with the command above — the result is
   byte-identical, proving the jar in the chart contains exactly the repository sources.

## Cluster tooling login (Grafana, Argo CD)

FKA-authenticated users can be gated into cluster-wide tools via Keycloak group membership instead of a separate realm (the setup in [helm-deployments#80](https://github.com/os2ai/helm-deployments/issues/80)). Three values pieces:

```yaml
groups:
  - name: cluster-admins        # add users to this group to grant access

clientScopes:
  - name: cluster-groups        # scope exposing groups as a plain-name `groups` claim
    description: Group membership claim for gating cluster tooling access
    groupMembershipMappers:
      - name: groups
        claim: groups

systems:
  - name: grafana               # confidential client, secret as usual
    clientScopes: [cluster-groups]
    # ...
  - name: argocd                # confidential client for the Argo CD UI
    clientScopes: [cluster-groups]
    # ...
  - name: argocd-cli            # public client for `argocd login --sso` (PKCE, loopback redirect)
    publicClient: true
    redirectUris: [http://127.0.0.1:*, http://localhost:*]
    clientScopes: [cluster-groups]
    # ...
```

Full group path is off on the mapper, so tools match on the plain group name. The `groups` claim
is verified end-to-end by `test/keycloak-validation/probe-token.sh`, which mints a token for a
test user in `cluster-admins` and prints `groups: ["cluster-admins"]` (plain name, no `/` prefix).

### Grafana (kube-prometheus-stack)

Values for the Adgangskomponent chart (see above): confidential `grafana` client with `clientScopes: [cluster-groups]`,
`redirectUris: [https://grafana.example.com/login/generic_oauth]`, `postLogoutRedirectUris: https://grafana.example.com`.

Grafana values (kube-prometheus-stack subchart shape, `prometheus-stack.grafana`):

```yaml
grafana:
  env:
    GF_AUTH_GENERIC_OAUTH_ENABLED: "true"
    GF_AUTH_GENERIC_OAUTH_NAME: Adgangskomponenten
    GF_AUTH_GENERIC_OAUTH_CLIENT_ID: grafana
    GF_AUTH_GENERIC_OAUTH_ALLOW_SIGNS_UPS: "true"
    GF_AUTH_GENERIC_OAUTH_SCOPES: openid profile email
    GF_AUTH_GENERIC_OAUTH_AUTH_URL: https://adgang.example.com/realms/<REALM>/protocol/openid-connect/auth
    GF_AUTH_GENERIC_OAUTH_TOKEN_URL: https://adgang.example.com/realms/<REALM>/protocol/openid-connect/token
    GF_AUTH_GENERIC_OAUTH_API_URL: https://adgang.example.com/realms/<REALM>/protocol/openid-connect/userinfo
    GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH: contains(groups[*], 'cluster-admins') && 'Admin'
    GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT: "true"
  # The client secret is the GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET key of a separate Secret,
  # pulled in as environment (Grafana reads GF_* variables natively):
  envFromSecrets:
    - name: grafana-oauth-secret   # data: { GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET: <client secret> }
```

- `role_attribute_strict = true` is the gate proper: an FKA-authenticated user *outside*
  `cluster-admins` is rejected instead of silently landing as Viewer.
- Do **not** add `groups` to the requested scopes: Keycloak rejects scope names it does not
  recognize (`invalid_scope`), and the realm has no scope named `groups` — the claim rides on
  the client via the default `cluster-groups` scope regardless (verified by `probe-token.sh`,
  whose token carries `groups` while the requested scope was only `openid profile email`).
- The userinfo endpoint works because the group mapper is enabled for userinfo tokens
  (`userinfo.token.claim: "true"`); Grafana reads claims from userinfo by default.
- `allow_sign_ups = true` auto-provisions FKA users on first login — access is decided by the
  group check, not by account existence.

### Argo CD (argo-cd chart)

Values for the Adgangskomponent chart: confidential `argocd` client with
`redirectUris: [https://argocd.example.com/auth/callback]` and public `argocd-cli` with loopback
redirects, both `clientScopes: [cluster-groups]`.

Argo CD chart values (`argo-cd.configs`):

```yaml
configs:
  secret:
    extra:
      # rendered into argocd-secret; referenced as $oidc.keycloak.clientSecret below
      oidc.keycloak.clientSecret: <client secret>
  cm:
    url: https://argocd.example.com
    oidc.config: |
      name: Adgangskomponenten
      issuer: https://adgang.example.com/realms/<REALM>
      clientID: argocd
      clientSecret: $oidc.keycloak.clientSecret
      # The CLI logs in with the separate public client (`argocd login --sso`),
      # so its loopback callback doesn't need registering on the UI client.
      cliClientID: argocd-cli
      # Must be set explicitly: Argo CD's default (["openid","profile","email","groups"])
      # would make Keycloak reject the login - `groups` is not a scope in this realm, the
      # claim rides on the client via the default `cluster-groups` client scope.
      requestedScopes: ["openid", "profile", "email"]
      # If token validation fails with an audience error, pin it explicitly:
      # allowedAudiences: ["argocd"]
  rbac:
    scopes: "[groups]"
    policy.default: ""
    policy.csv: |
      g, cluster-admins, role:admin
```

- `configs.rbac.scopes: "[groups]"` is required for group matching (it is already set in the
  os2ai cluster deployments); it names the *claim* to inspect, not an OAuth scope. Without it
  Argo CD only matches policies on `sub`.
- `policy.default: ""` keeps users without the group out of any role. For the UI they can log in
  but see nothing; the actual lock-out of non-members in the UI needs Grafana-style strictness
  that Argo RBAC does not provide — the group is the grant, and no group means no permissions.
- `scopes` must list `groups` even though `cluster-groups` is a default client scope on the
  client, keeping it correct if the client is ever consulted with explicit scopes.
- Older Argo CD versions without `cliClientID` can instead run the UI on the PKCE flow
  (`enablePKCEAuthentication: true` with a public UI client and a
  `https://argocd.example.com/pkce/verify` redirect URI) — the separate public client above is
  the cleaner split; use PKCE only if you cannot pin a recent version.

### Grafana/Argo CD user mapping note

Argo CD and Grafana see the same `groups` claim in either token path; neither sees FKA
attributes. Group membership (`cluster-admins`) is added to users via the admin API/UI or by
group mappers on the FKA identity provider if the mapping should be automatic.

### Validating the realm config

```sh
bash scripts/validate-keycloak.sh
```

Renders the chart with `test/keycloak-validation/values-cluster-access.yaml`, imports the realm into a throwaway Keycloak via docker compose (`start-dev --import-realm`), asserts the setup above (group, confidential `grafana`/`argocd`, public `argocd-cli`, `cluster-groups` scope with the group mapper, scope attachment) through the admin REST API, and tears everything down. Repeatable; requires docker, helm, jq, curl. Also runs automatically on pull requests via the `Validate realm config` workflow.
