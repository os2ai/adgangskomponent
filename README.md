Adgangskomponent
================

This component bridges the gap between Fælleskommunal Adgangsstyring (FKA) and applications authenticating with OIDC.
It consists of a Keycloak instance and realm bootstrapping, and a small admin UI for managing certificates.

Keycloak is deployed in one of two ways, selected with `keycloak.operator.enabled`:

- `true` (default): the chart renders `Keycloak` and `KeycloakRealmImport` custom resources, so an
  installed [keycloak-operator](https://www.keycloak.org/operator/installation) whose
  `watchNamespaces` covers the release namespace is required. The operator may be shared: one
  instance serves many namespaces. Do **not** install a second copy of the operator - cluster-
  scoped names would collide and a second release could not be installed.
- `false`: the chart renders Keycloak itself - a StatefulSet, Services and its Ingress - so no
  keycloak-operator, CRDs or operator RBAC are needed. This chart has no chart dependencies in
  either mode.

The realm is defined once and used by both modes: as the `KeycloakRealmImport` custom resource in
operator mode, and as the `realm.json` that Keycloak imports at startup in the bundled mode. Realm,
clients, claims and identity providers therefore cannot drift between the two. The Keycloak host,
resource names and admin UI URLs are identical in both modes.

In bundled mode the realm is imported with `--import-realm`, which only seeds an **empty**
database. To apply changes to `realm` or `systems` on an existing installation, delete the realm in
Keycloak and restart the StatefulSet; the pod includes the realm checksum, so a `helm upgrade`
that changes the realm rolls the pods.

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
