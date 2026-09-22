Adgangskomponent
================

This component bridges the gap between Fælleskommunal Adgangsstyring (FKA) and applications authenticating with OIDC.
It consists of a Keycloak instance (relying on keycloak-operator) and realm bootstrapping; and a small admin UI for managing certificates.

When well-configured the system maps from FKA privileges to fields on the access token produced when authenticating through the Keycloak instance.
This allows the delegation of roles and other authorization through OIDC-based authentication, based on privileges assigned through FKA.

## OIDC script-based protocol mapper

The Keycloak instance mounts `oidc-script-based-protocol-mapper.jar` (a plain zip of `charts/adgangskomponent/files/providers/oidc-script-based-protocol-mapper/`, containing only the SPI service descriptor) into `/opt/keycloak/providers/` via a ConfigMap rendered from `charts/adgangskomponent/files/providers/oidc-script-based-protocol-mapper.jar`.

The jar is a build artifact (gitignored) and is built by CI before `helm package`.
