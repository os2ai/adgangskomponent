#!/usr/bin/env bash
# Throwaway probe: proves the rendered realm produces a plain-name `groups` claim for a user
# in cluster-admins, as consumed by Grafana role_attribute_path / Argo RBAC. Not part of CI.
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE_DIR=test/keycloak-validation
BASE=http://127.0.0.1:18080
compose() { docker compose -p adc-keycloak-validation -f "$COMPOSE_DIR/docker-compose.yaml" "$@"; }

[ -f "$COMPOSE_DIR/realm.json" ] || { echo "run scripts/validate-keycloak.sh first"; exit 1; }
compose down -v >/dev/null 2>&1
KC_PORT=18080 compose up -d >/dev/null
for _ in $(seq 1 90); do curl -fsS -o /dev/null "$BASE/realms/master" 2>/dev/null && break; sleep 2; done

TOKEN=$(curl -fsS -X POST "$BASE/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d username=admin -d password=admin | jq -r .access_token)
api() { curl -fsS -H "Authorization: Bearer $TOKEN" "$@"; }

# ROPC is disabled in the shipped realm (and the browser flow is FKA-only), so flip it on the
# grafana client in this throwaway instance only, purely to mint a token for a local probe user.
GRAFANA=$(api "$BASE/admin/realms/validation/clients?clientId=grafana" | jq -r '.[0]')
GRAFANA=$(jq -c '.directAccessGrantsEnabled = true' <<<"$GRAFANA")
curl -fsS -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "$GRAFANA" "$BASE/admin/realms/validation/clients/$(jq -r .id <<<"$GRAFANA")" >/dev/null

api -X POST "$BASE/admin/realms/validation/users" -H 'Content-Type: application/json' \
  -d '{"username":"probe","email":"probe@example.org","enabled":true,"firstName":"Probe","lastName":"User"}'
UID_=$(api "$BASE/admin/realms/validation/users?username=probe" | jq -r '.[0].id')
api -X PUT "$BASE/admin/realms/validation/users/$UID_/reset-password" -H 'Content-Type: application/json' \
  -d '{"type":"password","value":"probe","temporary":false}'
GRP=$(api "$BASE/admin/realms/validation/groups?search=cluster-admins" | jq -r '.[0].id')
api -X PUT "$BASE/admin/realms/validation/users/$UID_/groups/$GRP"

SECRET=$(jq -r '.clients[] | select(.clientId=="grafana") | .secret' < "$COMPOSE_DIR/realm.json")
RT=$(curl -fsS -X POST "$BASE/realms/validation/protocol/openid-connect/token" \
  -u "grafana:$SECRET" -d grant_type=password -d username=probe -d password=probe)

# Note: the /userinfo endpoint resolves claims against the login session, which password
# grant tokens do not have (and the realm's browser flow is FKA-only, so no headless
# authorization-code flow exists here). Grafana over its normal login flow authenticates
# with a real session; Argo RBAC reads the groups claim from the token it just minted.
for kind in access_token id_token; do
  TOK=$(jq -r ".$kind // empty" <<<"$RT")
  [ -n "$TOK" ] || { echo "== $kind == (not issued for this grant)"; continue; }
  echo "== $kind =="
  python3 -c '
import base64, json, sys
parts = sys.argv[1].split(".")
payload = parts[1] + "=" * (-len(parts[1]) % 4)
c = json.loads(base64.urlsafe_b64decode(payload))
print(json.dumps({k: c.get(k) for k in ("groups", "preferred_username", "email", "scope", "azp", "aud")}, indent=2))
' "$TOK"
done
compose down -v >/dev/null
