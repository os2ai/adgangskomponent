{{/*
Keycloak deployment mode: "chart" (bundled keycloakx subchart, no operator needed)
or "operator" (Keycloak/KeycloakRealmImport CRs, requires an installed keycloak-operator).
*/}}
{{- define "adgangskomponent.keycloakMode" -}}
{{- if .Values.keycloak.chart.enabled -}}
chart
{{- else -}}
operator
{{- end -}}
{{- end }}

{{/*
Full name of the keycloakx subchart's resources (Services `-http`/`-headless`, StatefulSet),
mirroring keycloakx's own fullname logic, which is not reachable from this chart's scope.
*/}}
{{- define "adgangskomponent.keycloakChartFullname" -}}
{{- if .Values.keycloakx.fullnameOverride -}}
{{- .Values.keycloakx.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default "keycloakx" .Values.keycloakx.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end }}
