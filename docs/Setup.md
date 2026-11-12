# Opsætning af Adgangskomponenten

Denne guide beskriver, hvordan en myndighed eller driftsleverandør sætter Adgangskomponenten op fra bunden, så systemer kan benytte sig af Fælleskommunal Adgangsstyring (FKA).

For baggrunden for komponenten og valget mellem egen- og managed opsætning, se [Implementeringsmuligheder](Implementation.md) og [Introduction](Introduction.md).

## Forudsætninger

- Et Kubernetes-cluster (OS2ai-platformen bruger Traefik som ingress-controller, men hvad der skal til af cert-manager og ingress afhænger af jeres cluster).
- `keycloak-operator` installeret i clusteret (se OS2ai-platformens `keycloak-operator`-komponent, eller [keycloak-operator](https://github.com/keycloak/keycloak-operator)).
- En PostgreSQL-database som Keycloak kan bruge. I OS2ai leveres den af CloudNativePG; chartet peger på den via `db`-sektionen i values.
- cert-manager (eller anden måde at skaffe TLS-certifikater på) til domænerne `adgang.<FQDN>`, `admin.<FQDN>` og `api.admin.<FQDN>`.
- `helm` 3.10+ lokalt.

## 1. Forbered provider-jaret

Chartet monterer `oidc-script-based-protocol-mapper.jar` ind i Keycloak. Jaret er et byggeprodukt (gitignoret) og bygges af CI ved udgivelse. Ved installation fra et lokalt checkout skal det bygges først:

```sh
(cd charts/adgangskomponent && SRC=files/providers/oidc-script-based-protocol-mapper && \
 TZ=UTC find "$SRC" -exec touch -h -t 198001010000 {} + && \
 (cd "$SRC" && TZ=UTC find . -type f | sort | TZ=UTC zip -q -X -D -@ ../oidc-script-based-protocol-mapper.jar))
```

Den publicerede OCI-chart (`oci://ghcr.io/os2ai/adgangskomponent`) indeholder jaret allerede; her springes dette trin over.

## 2. Values

Minimum `values.yaml`:

```yaml
domain: adgang.example.dk

realm:
  name: mit-realm
  displayName: Mit Realm

# Systemer (OIDC-klienter) der må logge ind via realm'et:
systems:
  - name: os2ai
    displayName: OS2ai
    rootUrl: https://ai.example.dk
    baseUrl: https://ai.example.dk
    redirectUris:
      - https://ai.example.dk/oauth/oidc/callback
    # secret: generér selv, fx: openssl rand -hex 32 - skal matche klientsecretet hos det tilsluttede system

# Database (eksempel: CloudNativePG i samme namespace)
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

# Ingress: vælg klasse og annotationer der passer til jeres ingress-controller.
ingress:
  className: traefik
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
```

For flere ingress-indstillinger pr. komponent (admin-UI og admin-API), se kommentarerne i `charts/adgangskomponent/values.yaml`.

## 3. Installation

Fra OCI-registret:

```sh
helm upgrade --install adgangskomponent oci://ghcr.io/os2ai/adgangskomponent \
  --namespace adgangskomponent --create-namespace \
  --values my-values.yaml
```

Rollerne skal give operator og Keycloak-CR'er lov til at oprette PodDisruptionBudget, Realm m.m. Tjek at alt er synkroniseret:

```sh
kubectl -n adgangskomponent get keycloak,realm,deployment,poddisruptionbudget
```

Keycloak er klar, når `kubectl -n adgangskomponent get keycloak keycloak -o jsonpath='{.status.conditions}'` viser Ready.

## 4. Certifikat til FKA-integration

For at realm'et kan fungere som SAML-serviceprovider over for FKA, skal I bruge et certifikat udstedt på jeres organisation (CVR) - det er det certifikat, I uploader i admin-panelet. Kort proces:

1. Bestil et funktions-/systemcertifikat (OCES3) på jeres organisation hos en udsteder under Den Danske Stat rod-CA; [Digitaliseringskataloget](https://digitaliseringskataloget.dk/teknik/certifikater) beskriver certifikattyperne. Certifikatet skal være udstedt af Den Danske Stat og gyldigt (begge datoer).
2. Ét og samme certifikat bruges til både signering og kryptering - FKA kræver det.
3. Upload certifikatet (p12 eller cert+private key som pem) i admin-panelets "Certifikatopsætning"-afsnit. Den private nøgle skal være ukrypteret, eller p12'en skal uploades med sin adgangskode.

Admin-panelet validerer udsteder, gyldighed og matcher signering/kryptering, og viser fejl, hvis certifikatet ikke kan bruges.

## 5. Admin-panelet

Admin-UI'et findes som standard på `https://admin.<domain>` (API på `https://api.admin.<domain>`). Det kræver login via OIDC mod realm'ets admin-klient; klik på SSO-knappen og godkend med en Keycloak-administrateur.

## 6. Tilslut et OIDC-system (eksempel: Open WebUI)

1. Tilføj systemet under `systems:` i values (name, redirectUris m.m.) inkl. et hemmeligt `secret` (feltet `secret` på systemet - generér en tilfældig streng selv, fx `openssl rand -hex 32`) og opgrader chartet.
2. Sæt Open WebUI's `OAUTH_CLIENT_ID` til systemets navn og `OAUTH_CLIENT_SECRET` til det samme secret.
3. `OPENID_PROVIDER_URL` sættes til `https://<domain>/realms/<realm>/.well-known/openid-configuration`.

## 7. Fejlfinding

- **PDB melder `expectedPods: 0`** - sørg for en chart-version >= den, der retter Keycloak-PDB-selectoren (se CHANGELOG).
- **Keycloak bliver ikke klar** - kontroller at `db`-secrets findes, og at databasen kan nås fra namespace'et. Klar status ses med `kubectl -n adgangskomponent get keycloak keycloak -o jsonpath='{.status.conditions}'`.
- **Login virker ikke for slutbrugere** - tjek at brugerens FKA-rettigheder er synket (syncMode FORCE i realm'et overskriver pr. login); SAML-hændelser logges i Keycloak-loggen.
- **Cert-upload fejler med "Certificate not issued by the Danish Government"** - certifikatets udsteder-O er ikke "Den Danske Stat"; bestil det rigtige certifikat (afsnit 4).
