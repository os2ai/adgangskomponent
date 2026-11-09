#!/usr/bin/env bash
# Validates the realm config produced by charts/adgangskomponent by importing it into a
# throwaway Keycloak (docker compose) and asserting the cluster-tooling setup from
# https://github.com/os2ai/helm-deployments/issues/80#issuecomment-6684083324 via the admin API.
# Repeatable: tears down state on every run (fresh container, --import-realm).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD
CHART=charts/adgangskomponent
COMPOSE_DIR=test/keycloak-validation
JAR=$CHART/files/providers/oidc-script-based-protocol-mapper.jar
KC_PORT=${KC_PORT:-18080}
BASE=http://127.0.0.1:$KC_PORT
REALM=validation
FAILURES=0

log() { printf 'validate: %s\n' "$*"; }
check() { # check <description> <shell test expression result (0/1)>
  if [ "$1" = 0 ]; then log "OK   $2"; else log "FAIL $2"; FAILURES=$((FAILURES + 1)); fi
}

# The chart renders this jar into a configmap and refuses to template without it (built by CI; see README).
if [ ! -f "$JAR" ]; then
  log "Building provider jar"
  (cd "$CHART" && SRC=files/providers/oidc-script-based-protocol-mapper && \
    TZ=UTC find "$SRC" -exec touch -h -t 198001010000 {} + && \
    (cd "$SRC" && TZ=UTC find . -type f | sort | TZ=UTC zip -q -X -D -@ ../oidc-script-based-protocol-mapper.jar))
fi

log "Rendering chart with cluster-access values"
helm template validation "$CHART" -f "$COMPOSE_DIR/values-cluster-access.yaml" > "$COMPOSE_DIR/rendered.yaml"

# Default values must stay valid and must NOT contain cluster tooling config (backward compat).
log "Rendering chart with default values"
helm template defaults "$CHART" --set domain=k.example.org --set realm.name=os2adgang > /tmp/adc-defaults.yaml
python3 -c 'import yaml,sys; list(yaml.safe_load_all(open("/tmp/adc-defaults.yaml")))'

log "Extracting realm JSON"
python3 - "$COMPOSE_DIR/rendered.yaml" "$COMPOSE_DIR/realm.json" <<'EOF'
import json, sys, yaml
docs = list(yaml.safe_load_all(open(sys.argv[1])))
realm = next(d["spec"]["realm"] for d in docs if d and d.get("kind") == "KeycloakRealmImport")
json.dump(realm, open(sys.argv[2], "w"))
EOF

log "Checking default-values realm"
python3 - /tmp/adc-defaults.yaml <<'EOF'
import sys, yaml
docs = list(yaml.safe_load_all(open(sys.argv[1])))
realm = next(d["spec"]["realm"] for d in docs if d and d.get("kind") == "KeycloakRealmImport")
ids = {c["clientId"] for c in realm["clients"]}
assert realm["groups"] == [], "default realm should have no groups"
assert realm["clientScopes"] == [] or all(s["name"] != "cluster-groups" for s in realm["clientScopes"]), \
    "default realm should not define cluster-groups"
assert not {"grafana", "argocd", "argocd-cli"} & ids, "default realm should not define cluster tooling clients"
EOF

compose() { docker compose -p adc-keycloak-validation -f "$COMPOSE_DIR/docker-compose.yaml" "$@"; }

log "Bringing up Keycloak (fresh)"
compose down -v >/dev/null 2>&1
KC_PORT=$KC_PORT compose up -d >/dev/null

log "Waiting for Keycloak"
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "$BASE/realms/master" 2>/dev/null; then break; fi
  sleep 2
done
curl -fsS -o /dev/null "$BASE/realms/master" || { log "Keycloak did not come up"; compose logs --tail 50; exit 1; }

log "Requesting admin token"
TOKEN=$(curl -fsS -X POST "$BASE/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d username=admin -d password=admin | jq -r .access_token)

api() { curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE$1"; }

cid() { # cid <clientId> -> client uuid
  api "/admin/realms/$REALM/clients?clientId=$1" | jq -r --arg id "$1" '.[] | select(.clientId==$id) | .id // empty'
}

# Realm imported at all (start-dev --import-realm)
IMPORTED=$(api "/admin/realms/$REALM" | jq -r .realm)
check $([ "$IMPORTED" = "$REALM" ]; echo $?) "realm '$REALM' imported"

# Group
GRP=$(api "/admin/realms/$REALM/groups?search=cluster-admins" | jq -r '[.[] | select(.name=="cluster-admins")] | length')
check $([ "$GRP" = 1 ]; echo $?) "group cluster-admins exists"

# Clients and their type
for pair in grafana:false argocd:false argocd-cli:true; do
  name=${pair%%:*}; want=${pair##*:}
  PUB=$(api "/admin/realms/$REALM/clients?clientId=$name" | jq -r --arg id "$name" '.[] | select(.clientId==$id) | .publicClient')
  check $([ "$PUB" = "$want" ]; echo $?) "client $name exists with publicClient=$want"
done

# Public CLI client usable for `argocd login --sso`: standard flow + PKCE
CLI_ATTR=$(api "/admin/realms/$REALM/clients?clientId=argocd-cli" | jq -r --arg id argocd-cli \
  '.[] | select(.clientId==$id) | "\(.standardFlowEnabled) \(.attributes["pkce.code.challenge.method"] // "-")"')
check $([ "$CLI_ATTR" = "true S256" ]; echo $?) "argocd-cli has standard flow + PKCE S256"

# Client scope with group membership mapper, full group path OFF
SCOPE_ID=$(api "/admin/realms/$REALM/client-scopes?search=cluster-groups" | jq -r '[.[] | select(.name=="cluster-groups")] | .[0].id // empty')
check $([ -n "$SCOPE_ID" ]; echo $?) "client scope cluster-groups exists"
if [ -n "$SCOPE_ID" ]; then
  MAPPER=$(api "/admin/realms/$REALM/client-scopes/$SCOPE_ID/protocol-mappers/models" | jq -r \
    '[.[] | select(.protocolMapper=="oidc-group-membership-mapper" and .config["full.path"]=="false" and .config["claim.name"]=="groups")] | length')
  check $([ "$MAPPER" = 1 ]; echo $?) "scope cluster-groups has group membership mapper (claim 'groups', full path off)"
fi

# Scope attached as default to each tooling client
for name in grafana argocd argocd-cli; do
  ID=$(cid "$name")
  ATTACHED=0
  [ -n "$ID" ] && ATTACHED=$(api "/admin/realms/$REALM/clients/$ID/default-client-scopes" | jq '[.[] | select(.name=="cluster-groups")] | length')
  check $([ "$ATTACHED" = 1 ]; echo $?) "client $name has cluster-groups as default client scope"
done

log "Tearing down"
compose down -v >/dev/null

if [ "$FAILURES" -gt 0 ]; then log "$FAILURES check(s) failed"; exit 1; fi
log "all checks passed"
