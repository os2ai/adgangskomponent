# Changelog

All notable changes to this project will be documented in this file.

See [keep a changelog](https://keepachangelog.com/en/1.1.0/) for information about writing changes to this log.

## [Unreleased]

### Added

* **Cluster tooling login support.** The realm config now supports gating login to cluster-wide tools (Grafana, Argo CD UI and CLI) on Keycloak group membership, as in the Hjørring setup (see [helm-deployments#80](https://github.com/os2ai/helm-deployments/issues/80)). Values gained `groups` (realm groups, e.g. `cluster-admins`), `clientScopes` (scopes carrying group membership mappers with full group path off, e.g. `cluster-groups`) and per-system `publicClient` (for `argocd login --sso`) and `clientScopes` (scopes attached as default to the client). Default values render the exact same realm as before. The rendered realm is now checked by `scripts/validate-keycloak.sh` in a CI workflow that runs on pull requests, so a change cannot merge with a realm the cluster tooling cannot log in against.

### Security

* **[Switch from IMPORT to FORCE.](https://github.com/os2ai/adgangskomponent/commit/1f120797a13ecb64bde38dc975a046a136c01a20)** The IdP in the Keycloak Realm is now initially set up to overwrite the users information, each time they login through the Adgangskomponent.
This results in roles and groups being synced correctly, so stale permissions no longer persist indefinitely.
* **[Build OIDC Script Protocol Mapper JAR.](https://github.com/os2ai/adgangskomponent/commit/7896f39932d830cb8388a8897ca993b4134895a3)** Avoiding a potential subtle supply chain attack vector by including the build pipeline and verification mechanism for the included keycloak mapper.

### Fixed

* **[Minor typo in chart build workflow.](https://github.com/os2ai/adgangskomponent/commit/95b5c904d98ab3ae38795b9a773899a4b009d75d)** This never allowed for the override function it proclaimed to facilitate due to a typo in the jq command.
* **[Add priority to certificates when uploaded.](https://github.com/os2ai/adgangskomponent/pull/28)** The signing KeyDescriptor is now listed before the encryption KeyDescriptor.

## [1.0.0]

### Added

* Initial release of Adgangskomponent.
