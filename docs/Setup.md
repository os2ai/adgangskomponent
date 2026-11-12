# Setting up Adgangskomponenten

This guide describes how an authority or operator sets up Adgangskomponenten from scratch, so that systems can use Fælleskommunal Adgangsstyring (FKA).

For background on the component and the choice between self-managed and managed setup, see [Implementation options](Implementation.md) and [Introduction](Introduction.md).

## Prerequisites

- A Kubernetes cluster (the OS2ai platform uses Traefik as ingress controller, but what's required for cert-manager and ingress depends on your cluster).
- `keycloak-operator` installed in the cluster (see the OS2ai platform's `keycloak-operator` component, or [keycloak-operator](https://github.com/keycloak/keycloak-operator)).
- A PostgreSQL database for Keycloak to use. In OS2ai, this is provided by CloudNativePG; the chart points to it via the `db` section in values.
- cert-manager (or another way to obtain TLS certificates) for the domains `adgang.<FQDN>`, `admin.<FQDN>` and `api.admin.<FQDN>`.
- `helm` 3.10+ locally.

## 1. Prepare the provider jar

The chart mounts `oidc-script-based-protocol-mapper.jar` into Keycloak. The jar is a build product (gitignored) and is built by CI upon release. When installing from a local checkout, it must be built first:

```sh
(cd charts/adgangskomponent && SRC=files/providers/oidc-script-based-protocol-mapper && \
 TZ=UTC find "$SRC" -exec touch -h -t 198001010000 {} + && \
 (cd "$SRC" && TZ=UTC find . -type f | sort | TZ=UTC zip -q -X -D -@ ../oidc-script-based-protocol-mapper.jar))
```

The published OCI chart (`oci://ghcr.io/os2ai/adgangskomponent`) already contains the jar; this step can be skipped here.

## 2. Values

Minimum `values.yaml`:

```yaml
domain: adgang.example.dk

realm:
  name: mit-realm
  displayName: Mit Realm

# Systems (OIDC clients) allowed to log in via the realm:
systems:
  - name: os2ai
    displayName: OS2ai
    rootUrl: https://ai.example.dk
    baseUrl: https://ai.example.dk
    redirectUris:
      - https://ai.example.dk/oauth/oidc/callback
    # secret: generate yourself, e.g. openssl rand -hex 32 - must match the client secret of the connected system

# Database (example: CloudNativePG in the same namespace)
db:
  vendor: postgres
  host: cloudnative-pg-cluster-rw
  database: os2adgang
  usernameSecret:
    name: cloudnative-pg-cluster-admin
    key: username
  passwordSecret:
    name: cloudnative-pg-cluster-admin
    key: password

# Ingress: choose class and annotations that match your ingress controller.
ingress:
  className: traefik
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
```

For more ingress settings per component (admin-UI and admin-API), see the comments in `charts/adgangskomponent/values.yaml`.

## 3. Installation

From the OCI registry:

```sh
helm upgrade --install adgangskomponent oci://ghcr.io/os2ai/adgangskomponent \
  --namespace adgangskomponent --create-namespace \
  --values my-values.yaml
```

Roles must allow operator and Keycloak CRs to create PodDisruptionBudget, Realm etc. Check that everything is synchronized:

```sh
kubectl -n adgangskomponent get keycloak,realm,deployment,poddisruptionbudget
```

Keycloak is ready when `kubectl -n adgangskomponent get keycloak keycloak -o jsonpath='{.status.conditions}'` shows Ready.

## 4. Certificate for FKA integration

For the realm to function as a SAML service provider for FKA, you need a certificate issued to your organization (CVR) - this is the certificate you upload in the admin panel. Brief process:

1. Order a functional/system certificate (OCES3) for your organization from an issuer under the Danish State root CA; [Digitaliseringskataloget](https://digitaliseringskataloget.dk/teknik/certifikater) describes the certificate types. The certificate must be issued by the Danish State and valid (both dates).
2. The same certificate is used for both signing and encryption - FKA requires this.
3. Upload the certificate (p12 or cert+private key as pem) in the 'Certificate Setup' section of the admin panel. The private key must be unencrypted, or the p12 must be uploaded with its password.

The admin panel validates issuer, validity and matches signing/encryption, and shows errors if the certificate cannot be used.

## 5. Admin Panel

The admin UI is found by default at `https://admin.<domain>` (API at `https://api.admin.<domain>`). It requires login via OIDC against the realm's admin client; click the SSO button and authenticate with a Keycloak administrator.

## 6. Connect an OIDC system (example: Open WebUI)

1. Add the system under `systems:` in values (name, redirectUris etc.) including a secret `secret` (the `secret` field on the system - generate a random string yourself, e.g. `openssl rand -hex 32`) and upgrade the chart.
2. Set Open WebUI's `OAUTH_CLIENT_ID` to the system name and `OAUTH_CLIENT_SECRET` to the same secret.
3. `OPENID_PROVIDER_URL` is set to `https://<domain>/realms/<realm>/.well-known/openid-configuration`.

## 7. Troubleshooting

- **PDB reports `expectedPods: 0`** - ensure a chart version >= the one that fixes the Keycloak PDB selector (see CHANGELOG).
- **Keycloak does not become ready** - check that `db` secrets exist and that the database is reachable from the namespace. Ready status can be seen with `kubectl -n adgangskomponent get keycloak keycloak -o jsonpath='{.status.conditions}'`.
- **Login does not work for end users** - check that the user's FKA privileges are synchronized (syncMode FORCE in the realm overwrites per login); SAML events are logged in the Keycloak log.
- **Cert upload fails with 'Certificate not issued by the Danish Government'** - the certificate's issuer-O is not 'Den Danske Stat'; order the correct certificate (section 4).
