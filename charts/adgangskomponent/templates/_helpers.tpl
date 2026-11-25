{{/*
Keycloak deployment mode:
  operator - Keycloak/KeycloakRealmImport custom resources, reconciled by an already installed
             keycloak-operator. Default, and what this chart has always done. The operator may be
             shared: it only needs this release's namespace in its `watchNamespaces` (or watch
             everything).
  bundled  - Keycloak runs from manifests rendered by this chart itself. No keycloak-operator, no
             CRDs and no operator RBAC are needed.
*/}}
{{- define "adgangskomponent.keycloakMode" -}}
{{- if .Values.keycloak.operator.enabled -}}
operator
{{- else -}}
bundled
{{- end -}}
{{- end }}
