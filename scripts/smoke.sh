#!/usr/bin/env bash
# Runs the OAuth flow (DCR → consent → token exchange) and calls MCP initialize / tools/list / list_calendars
# usage: AUTH_PASSWORD=... scripts/smoke.sh [base-url]
set -euo pipefail
BASE=${1:-http://localhost:8787}
REDIRECT=http://localhost:9999/callback
PASSWORD="$AUTH_PASSWORD"
JAR=$(mktemp)

client=$(curl -s -X POST "$BASE/oauth/register" -H 'Content-Type: application/json' \
  -d "{\"client_name\":\"e2e\",\"redirect_uris\":[\"$REDIRECT\"],\"token_endpoint_auth_method\":\"none\"}")
client_id=$(echo "$client" | jq -r .client_id)
echo "registered: $client_id"

verifier=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=\n')
auth_url="$BASE/authorize?response_type=code&client_id=$client_id&redirect_uri=$REDIRECT&code_challenge=$challenge&code_challenge_method=S256&scope=calendar&state=s1&resource=$BASE/mcp"

page=$(curl -s -c "$JAR" -b "$JAR" "$auth_url")
handle=$(echo "$page" | sed -n 's/.*name="handle" value="\([^"]*\)".*/\1/p')
echo "consent handle: ${handle:0:8}..."

wrong=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" -X POST "$auth_url" \
  --data-urlencode "handle=$handle" -d decision=approve --data-urlencode "password=wrong")
echo "wrong password: $wrong"

location=$(curl -s -o /dev/null -w '%{redirect_url}' -c "$JAR" -b "$JAR" -X POST "$auth_url" \
  --data-urlencode "handle=$handle" -d decision=approve --data-urlencode "password=$PASSWORD")
echo "redirect: ${location%%code=*}code=..."
code=$(echo "$location" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')

token=$(curl -s -X POST "$BASE/oauth/token" -d grant_type=authorization_code -d "code=$code" \
  -d "client_id=$client_id" -d "redirect_uri=$REDIRECT" -d "code_verifier=$verifier" -d "resource=$BASE/mcp")
access=$(echo "$token" | jq -r .access_token)
echo "token: scope=$(echo "$token" | jq -r .scope) expires_in=$(echo "$token" | jq -r .expires_in)"

mcp() {
  curl -s -X POST "$BASE/mcp" -H "Authorization: Bearer $access" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -H 'MCP-Protocol-Version: 2025-06-18' -d "$1"
}
echo "--- initialize"
mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}}' | head -c 400; echo
echo "--- tools/list"
mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | grep -o '"name":"[a-z_]*"' | tr '\n' ' '; echo
echo "--- tools/call list_calendars"
mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_calendars","arguments":{}}}' | head -c 400; echo
rm -f "$JAR"
