# Changelog

All notable changes to this project will be documented in this file.

See [keep a changelog](https://keepachangelog.com/en/1.1.0/) for information about writing changes to this log.

## [Unreleased]

### Added

* **[Health checks on admin frontend and API.](https://github.com/os2ai/adgangskomponent/issues/10)** Both admin deployments now expose named `http` ports and readiness/liveness probes against `/healthz`. The API serves `GET /healthz` directly (with access logging suppressed for it); the UI's nginx answers `= /healthz` with 200 without access logs. API behavior covered by the new `admin/api` test suite (`npm test`), run on pull requests.

* **[Resource requests and limits on admin deployments.](https://github.com/os2ai/adgangskomponent/issues/9)** The admin UI and API containers get deliberately small defaults (requests 10m/64Mi, limits 250m/256Mi for the UI and 500m/256Mi for the API), overridable via `admin.ui.resources` / `admin.api.resources` in values. These are small workloads and should not schedule without a request. The values were verified against certificate upload load: even ten concurrent 8192 bit uploads peak at around 32MB memory, while the CPU bound openssl conversions are what the API cpu limit needs to accommodate.

### Changed

* **[Upgrade Node.js to 26.13.1.](https://github.com/os2ai/adgangskomponent/pull/34)**
The admin api runtime image, the admin ui build image and the CI test workflow move
from Node.js 24 to 26, which entered Long Term Support as "Lithium" in October 2026.
Both Dockerfiles pin the tag together with the matching amd64 child manifest digest
of node:26.13.1-slim.

* **[Bump nginx to 1.31.8.](https://github.com/os2ai/adgangskomponent/pull/30)** The admin UI runtime image moves from nginx 1.31.1 to 1.31.8, pinned by manifest digest. The admin API image additionally runs `apt upgrade` before installing openssl, so it picks up base-image security fixes at build time.
* **[CORS restricted to configured origins.](https://github.com/os2ai/adgangskomponent/issues/8)** The admin API answers with `Access-Control-Allow-Origin: *` only while its `CORS_ALLOWED_ORIGINS` environment variable is unset or empty; configured values (comma-separated) form an allow-list. The chart value `admin.api.corsAllowedOrigins` defaults to the admin UI origin when omitted; an explicit empty value is passed through to the API unchanged. The wildcard fallback is deprecated and will be replaced by no CORS at all in v2.0.0. Behavior covered by the new `admin/api` test suite (`npm test`), run on pull requests.

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
