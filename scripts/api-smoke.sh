#!/usr/bin/env bash
# Smoke test for /api/v1 auth against a running server (staging or local,
# never prod). Signs in twice with email and password, as the mobile app
# (bearer token, mobile scopes) and as the web app (cookie, which alone may
# manage API keys and approve devices), then calls GET /api/v1/me with each
# credential type: the mobile token, a fresh API key and a device token.
# Checks that scoped tokens are refused where only the web app may act.
# Cleans up the key and all three sessions.
#
#   SMOKE_EMAIL=... SMOKE_PASSWORD=... scripts/api-smoke.sh https://staging.example
#
# Needs curl and jq, and an account on that server without 2FA.
set -euo pipefail

url=${1:?usage: api-smoke.sh <server url>}
url=${url%/}
: "${SMOKE_EMAIL:?set SMOKE_EMAIL}" "${SMOKE_PASSWORD:?set SMOKE_PASSWORD}"

host=$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')
case "$host:$url" in
  retrospend.app:* | *.retrospend.app:* | *:1997 | *:1997/*)
    echo "refusing to run against prod ($url)" >&2
    exit 2 ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
pass=0

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { pass=$((pass + 1)); echo "ok   $*"; }

# request <method> <path> <body or ""> [header...]: body to $tmp/body,
# headers to $tmp/headers, status code on stdout.
request() {
  local method=$1 path=$2 body=$3
  shift 3
  local args=(-sS -X "$method" -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}'
    -H "origin: $url" -H 'accept: application/json')
  for h in "$@"; do args+=(-H "$h"); done
  if [ -n "$body" ]; then args+=(-H 'content-type: application/json' --data "$body"); fi
  curl "${args[@]}" "$url$path"
}

expect_me() {
  local label=$1 kind=$2
  shift 2
  local status
  status=$(request GET /api/v1/me "" "$@")
  [ "$status" = 200 ] || fail "$label: /me answered $status: $(cat "$tmp/body")"
  local got
  got=$(jq -r '.principal.kind' "$tmp/body")
  [ "$got" = "$kind" ] || fail "$label: principal kind $got, expected $kind"
  ok "$label: /me as $(jq -r '.username' "$tmp/body") ($kind, scopes $(jq -c '.principal.scopes' "$tmp/body"))"
}

# 1. Public probe.
status=$(request GET /api/v1/server-info "")
[ "$status" = 200 ] || fail "server-info answered $status"
ok "server-info: version $(jq -r '.version' "$tmp/body")"

status=$(request GET /api/v1/me "")
[ "$status" = 401 ] || fail "/me without credentials answered $status, expected 401"
grep -qi '^content-type: application/problem+json' "$tmp/headers" || fail "401 is not problem+json"
ok "no credentials: 401 problem+json ($(jq -r '.code' "$tmp/body"))"

# 2. Sign in like the mobile app: only it gets set-auth-token, and its
#    session carries the mobile scopes (no admin).
login=$(jq -nc --arg e "$SMOKE_EMAIL" --arg p "$SMOKE_PASSWORD" '{email: $e, password: $p}')
status=$(request POST /api/auth/sign-in/email "$login" "expo-origin: retrospend://")
[ "$status" = 200 ] || fail "mobile sign-in answered $status: $(cat "$tmp/body")"
token=$(grep -i '^set-auth-token:' "$tmp/headers" | head -1 | cut -d' ' -f2- | tr -d '\r')
[ -n "$token" ] || fail "mobile sign-in returned no set-auth-token header"
bearer="authorization: Bearer $token"
expect_me "mobile" mobile "$bearer"
jq -e '.principal.scopes | index("admin") | not' "$tmp/body" >/dev/null || fail "mobile token has admin"

# 3. Sign in like the browser: a cookie, and no token handed to scripts.
status=$(request POST /api/auth/sign-in/email "$login")
[ "$status" = 200 ] || fail "web sign-in answered $status: $(cat "$tmp/body")"
grep -qi '^set-auth-token:' "$tmp/headers" && fail "web sign-in exposed set-auth-token"
web="cookie: $(grep -i '^set-cookie:' "$tmp/headers" | grep -i 'session_token=' | head -1 | cut -d' ' -f2- | cut -d';' -f1)"
expect_me "web cookie" web "$web"

# 4. A short-lived API key (read scope by default), made from the web
#    session only, then revoked.
status=$(request POST /api/auth/api-key/create '{"name":"api-smoke","expiresIn":86400}' "$bearer")
[ "$status" = 403 ] || fail "api-key create with the mobile token answered $status, expected 403"
ok "mobile token cannot mint api keys: 403"
status=$(request POST /api/auth/api-key/create '{"name":"api-smoke","expiresIn":86400}' "$web")
[ "$status" = 200 ] || fail "api-key create answered $status: $(cat "$tmp/body")"
key=$(jq -r '.key' "$tmp/body")
key_id=$(jq -r '.id' "$tmp/body")
expect_me "api key (x-api-key)" apiKey "x-api-key: $key"
expect_me "api key (bearer)" apiKey "authorization: Bearer $key"
status=$(request POST /api/auth/api-key/delete "$(jq -nc --arg id "$key_id" '{keyId: $id}')" "$web")
[ "$status" = 200 ] || fail "api-key delete answered $status"
status=$(request GET /api/v1/me "" "x-api-key: $key")
[ "$status" = 401 ] || fail "revoked key answered $status, expected 401"
ok "revoked api key: 401"

# 5. Device authorization (RFC 8628) for the CLI, approved in the web app.
status=$(request POST /api/auth/device/code '{"client_id":"retrospend-cli","scope":"read"}')
[ "$status" = 200 ] || fail "device code answered $status: $(cat "$tmp/body")"
device_code=$(jq -r '.device_code' "$tmp/body")
user_code=$(jq -r '.user_code' "$tmp/body")
approve=$(jq -nc --arg c "$user_code" '{userCode: $c}')
status=$(request POST /api/auth/device/approve "$approve" "$bearer")
[ "$status" = 403 ] || fail "device approve with the mobile token answered $status, expected 403"
ok "mobile token cannot approve devices: 403"
status=$(request GET "/api/auth/device?user_code=$user_code" "" "$web")
[ "$status" = 200 ] || fail "device verify answered $status"
status=$(request POST /api/auth/device/approve "$approve" "$web")
[ "$status" = 200 ] || fail "device approve answered $status: $(cat "$tmp/body")"
grant=$(jq -nc --arg d "$device_code" \
  '{grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: $d, client_id: "retrospend-cli"}')
status=$(request POST /api/auth/device/token "$grant")
[ "$status" = 200 ] || fail "device token answered $status: $(cat "$tmp/body")"
device_token=$(jq -r '.access_token' "$tmp/body")
expect_me "device token" device "authorization: Bearer $device_token"
[ "$(jq -c '.principal.scopes' "$tmp/body")" = '["read"]' ] || fail "device token scopes are not [\"read\"]"

# 6. Sign all three sessions out.
request POST /api/auth/sign-out '{}' "authorization: Bearer $device_token" >/dev/null
request POST /api/auth/sign-out '{}' "$web" >/dev/null
request POST /api/auth/sign-out '{}' "$bearer" >/dev/null
status=$(request GET /api/v1/me "" "$bearer")
[ "$status" = 401 ] || fail "signed-out bearer answered $status, expected 401"
ok "signed out: 401"

echo "all $pass checks passed against $url"
