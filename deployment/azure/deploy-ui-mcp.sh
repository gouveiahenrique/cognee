#!/usr/bin/env bash
# Add the cognee UI and the MCP server next to an API deployed by deploy.sh.
#
# Usage: deployment/azure/deploy-ui-mcp.sh
#
# - frontend: the published cognee/cognee-ui image, pointed at the API's public
#   URL (the browser talks to the API directly, so the API's CORS list gets the
#   frontend's origin).
# - cognee-mcp: built in ACR from cognee-mcp/Dockerfile and run in API mode, so
#   it never opens the databases itself; it authenticates with an API key
#   created for the default user and stored as a Container Apps secret. The MCP
#   endpoint requires a valid Cognee API key in an `X-Api-Key` header (any key
#   created with POST /api/v1/auth/api-keys), checked against the API by an
#   nginx sidecar in the same app.
#
# Images: both are built in the private ACR by default, and the apps pull them
# with their managed identity (needs rights to create an AcrPull role
# assignment). Set MCP_IMAGE and/or UI_IMAGE to public images (e.g.
# MCP_IMAGE=docker.io/cognee/cognee-mcp:main UI_IMAGE=docker.io/cognee/cognee-ui:main)
# to skip the build and the registry/role assignment for that app. With both
# set, the ACR is not touched at all. An override is always pulled anonymously.
set -euo pipefail

RG="${RG:-rg-cognee}"
PREFIX="${PREFIX:-cognee}"
CREDS_FILE="${CREDS_FILE:-$HOME/.cognee-azure/${RG}.env}"
ACA_ENV="${PREFIX}-env"
API_APP="${API_APP:-${PREFIX}-api}"
# UI app name (also its public hostname). Override to rebrand, e.g. UI_APP=context-mesh.
UI_APP="${UI_APP:-${PREFIX}-ui}"
UI_REPO="${UI_REPO:-cognee-ui}"
MCP_APP="${MCP_APP:-${PREFIX}-mcp}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
# Tag the UI image with the frontend tree's content hash, so local (uncommitted)
# frontend changes produce a new tag and get rebuilt.
# The UI is rebranded at build time (deployment/branding/rebrand.py), so the
# source keeps upstream's wording and rebases cleanly. BRAND= (empty) builds the
# unbranded Cognee UI.
BRAND="${BRAND-context-mesh}"
UI_TAG="${UI_TAG:-$({ git ls-files -cmo --exclude-standard cognee-frontend deployment/branding |
  sort -u | xargs shasum 2>/dev/null; echo "brand=$BRAND"; } | shasum | cut -c1-12)}"

log() { printf '\n==> %s\n' "$*"; }

[ -f "$CREDS_FILE" ] || { echo "run deploy.sh first ($CREDS_FILE missing)" >&2; exit 1; }
# shellcheck disable=SC1090
. "$CREDS_FILE"
ACR="${PREFIX}acr${SUFFIX}"

DOMAIN=$(az containerapp env show -n "$ACA_ENV" -g "$RG" --query properties.defaultDomain -o tsv)
API_URL="https://${API_APP}.${DOMAIN}"
UI_URL="https://${UI_APP}.${DOMAIN}"
MCP_HOST="${MCP_APP}.${DOMAIN}"
# The ACR is only needed when at least one image is not overridden.
ACR_SERVER=""
if [ -z "${MCP_IMAGE:-}" ] || [ -z "${UI_IMAGE:-}" ]; then
  ACR_SERVER=$(az acr show -n "$ACR" -g "$RG" --query loginServer -o tsv)
fi

# An app only gets registry config (and the AcrPull role) when its image lives
# in our ACR; any other image is pulled anonymously.
uses_acr() { [ -n "$ACR_SERVER" ] && [[ "$1" == "$ACR_SERVER"/* ]]; }

# ---- MCP image ---------------------------------------------------------------
if [ -n "${MCP_IMAGE:-}" ]; then
  log "Using prebuilt MCP image $MCP_IMAGE (no build)"
elif [ "${SKIP_BUILD:-0}" = "1" ] ||
  az acr repository show -n "$ACR" --image "cognee-mcp:$IMAGE_TAG" -o none 2>/dev/null; then
  MCP_IMAGE="$ACR_SERVER/cognee-mcp:$IMAGE_TAG"
  log "Image cognee-mcp:$IMAGE_TAG already in $ACR, skipping build"
else
  MCP_IMAGE="$ACR_SERVER/cognee-mcp:$IMAGE_TAG"
  log "Building cognee-mcp:$IMAGE_TAG in ACR (linux/amd64)"
  # ACR quick builds use the legacy builder: drop the BuildKit-only uv cache mounts.
  ACR_DOCKERFILE=".Dockerfile.mcp.acr"
  trap 'rm -f "$ACR_DOCKERFILE"' EXIT
  sed -E 's#--mount=type=cache,target=[^ ]+[[:space:]]*##' cognee-mcp/Dockerfile >"$ACR_DOCKERFILE"
  az acr build -r "$ACR" -t "cognee-mcp:$IMAGE_TAG" -t cognee-mcp:latest \
    --platform linux/amd64 --timeout 7200 -f "$ACR_DOCKERFILE" . --only-show-errors
  rm -f "$ACR_DOCKERFILE"
fi

# ---- UI image ----------------------------------------------------------------
# Built from this checkout rather than pulling cognee/cognee-ui, so local
# frontend fixes ship. UI_IMAGE overrides this with a prebuilt image.
if [ -z "${UI_IMAGE:-}" ]; then
  UI_IMAGE="$ACR_SERVER/$UI_REPO:$UI_TAG"
  if az acr repository show -n "$ACR" --image "$UI_REPO:$UI_TAG" -o none 2>/dev/null; then
    log "Image $UI_REPO:$UI_TAG already in $ACR, skipping build"
  else
    log "Building $UI_REPO:$UI_TAG in ACR (linux/amd64, brand: ${BRAND:-none})"
    # Build from a copy of the frontend (the files git would commit), so the
    # rebrand never touches the checkout.
    UI_BUILD_ROOT=$(mktemp -d)
    trap 'rm -rf "$UI_BUILD_ROOT" "${ACR_DOCKERFILE:-}"' EXIT
    git ls-files -cmo --exclude-standard cognee-frontend | while IFS= read -r f; do
      if [ -f "$f" ]; then mkdir -p "$UI_BUILD_ROOT/$(dirname "$f")"; cp -p "$f" "$UI_BUILD_ROOT/$f"; fi
    done
    UI_CONTEXT="$UI_BUILD_ROOT/cognee-frontend"
    if [ -n "$BRAND" ]; then
      python3 deployment/branding/rebrand.py "$UI_CONTEXT" "$BRAND"
    fi
    # The legacy ACR builder rejects BuildKit-only syntax: drop the syntax
    # directive and turn COPY --chmod into a COPY plus chmod.
    UI_DOCKERFILE="$UI_CONTEXT/.Dockerfile.acr"
    sed -E -e '/^# syntax=/d' \
      -e 's#^COPY --chmod=755 (docker-entrypoint\.sh) (/usr/local/bin/docker-entrypoint\.sh)#COPY \1 \2\nRUN chmod 755 \2#' \
      cognee-frontend/Dockerfile >"$UI_DOCKERFILE"
    az acr build -r "$ACR" -t "$UI_REPO:$UI_TAG" -t "$UI_REPO:latest" --target runner \
      --platform linux/amd64 --timeout 3600 -f "$UI_DOCKERFILE" "$UI_CONTEXT" --only-show-errors
  fi
fi

# ---- API key for MCP (created once, kept in the creds file) ------------------
if [ -z "${MCP_API_KEY:-}" ]; then
  log "Creating an API key for the MCP server"
  TOKEN=$(curl -sf -X POST "$API_URL/api/v1/auth/login" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "username=default_user@example.com" \
    --data-urlencode "password=$DEFAULT_USER_PASSWORD" |
    python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
  MCP_API_KEY=$(curl -sf -X POST "$API_URL/api/v1/auth/api-keys" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"name": "cognee-mcp (azure)"}' |
    python3 -c 'import sys,json; print(json.load(sys.stdin)["key"])')
  [ -n "$MCP_API_KEY" ] || { echo "API key creation failed" >&2; exit 1; }
  (umask 077; echo "MCP_API_KEY=$MCP_API_KEY" >>"$CREDS_FILE")
fi

# ---- API: allow the UI origin ------------------------------------------------
log "Allowing $UI_URL in the API's CORS origins"
az containerapp update -n "$API_APP" -g "$RG" \
  --set-env-vars "CORS_ALLOWED_ORIGINS=$UI_URL" "UI_APP_URL=$UI_URL" -o none

# ---- frontend ----------------------------------------------------------------
UI_SECRETS=("default-user-password=$DEFAULT_USER_PASSWORD")
UI_ENVS=("COGNEE_BACKEND_URL=$API_URL" "DEFAULT_USER_PASSWORD=secretref:default-user-password")
log "Container app $UI_APP ($UI_IMAGE)"
if ! az containerapp show -n "$UI_APP" -g "$RG" -o none 2>/dev/null; then
  az containerapp create -n "$UI_APP" -g "$RG" --environment "$ACA_ENV" \
    --image "$UI_IMAGE" --ingress external --target-port 3000 \
    $(uses_acr "$UI_IMAGE" && echo --registry-server "$ACR_SERVER" --registry-identity system) \
    --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
    --secrets "${UI_SECRETS[@]}" --env-vars "${UI_ENVS[@]}" -o none
else
  # An app first created from the public image has no registry login yet. Its
  # identity also needs AcrPull, which `registry set` does not grant on its
  # own (the pull then retries until the role exists). Skipped for images
  # outside our ACR.
  if uses_acr "$UI_IMAGE" && [ -z "$(az containerapp show -n "$UI_APP" -g "$RG" \
    --query "properties.configuration.registries[?server=='$ACR_SERVER'] | [0].server" -o tsv)" ]; then
    az containerapp identity assign -n "$UI_APP" -g "$RG" --system-assigned -o none
    UI_PRINCIPAL=$(az containerapp show -n "$UI_APP" -g "$RG" --query identity.principalId -o tsv)
    az role assignment create --assignee-object-id "$UI_PRINCIPAL" \
      --assignee-principal-type ServicePrincipal --role AcrPull \
      --scope "$(az acr show -n "$ACR" -g "$RG" --query id -o tsv)" -o none
    az containerapp registry set -n "$UI_APP" -g "$RG" --server "$ACR_SERVER" \
      --identity system -o none
  fi
  az containerapp secret set -n "$UI_APP" -g "$RG" --secrets "${UI_SECRETS[@]}" -o none
  az containerapp update -n "$UI_APP" -g "$RG" --image "$UI_IMAGE" \
    --set-env-vars "${UI_ENVS[@]}" -o none
fi

# ---- MCP ---------------------------------------------------------------------
MCP_SECRETS=("api-token=$MCP_API_KEY")
MCP_ENVS=(
  "TRANSPORT_MODE=http" "API_URL=$API_URL" "API_TOKEN=secretref:api-token"
  "COGNEE_API_AUTH_SCHEME=x-api-key"
  # Azure's ingress forwards the bare hostname (no port), which the ":*"
  # patterns never match, so allow the exact host as well.
  "MCP_ALLOWED_HOSTS=$MCP_HOST,$MCP_HOST:*"
  "PYTHONUNBUFFERED=1"
)
log "Container app $MCP_APP ($MCP_IMAGE)"
if ! az containerapp show -n "$MCP_APP" -g "$RG" -o none 2>/dev/null; then
  az containerapp create -n "$MCP_APP" -g "$RG" --environment "$ACA_ENV" \
    --image "$MCP_IMAGE" \
    $(uses_acr "$MCP_IMAGE" && echo --registry-server "$ACR_SERVER" --registry-identity system) \
    --ingress external --target-port 8000 \
    --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
    --args=--no-migration \
    --secrets "${MCP_SECRETS[@]}" --env-vars "${MCP_ENVS[@]}" -o none
else
  az containerapp secret set -n "$MCP_APP" -g "$RG" --secrets "${MCP_SECRETS[@]}" -o none
  # --container-name: the app has an auth sidecar after the first run. The MCP
  # container keeps the name it was created with, which differs from the app
  # name when the app was copied under a new one (cognee-mcp -> context-mesh-mcp).
  MCP_CONTAINER=$(az containerapp show -n "$MCP_APP" -g "$RG" \
    --query "properties.template.containers[?name!='mcp-auth'] | [0].name" -o tsv)
  az containerapp update -n "$MCP_APP" -g "$RG" --container-name "$MCP_CONTAINER" \
    --image "$MCP_IMAGE" --set-env-vars "${MCP_ENVS[@]}" -o none
fi

# cognee-mcp has no inbound authentication of its own, so an nginx sidecar in the
# same app takes the ingress. For every request it asks the Cognee API whether the
# caller's `X-Api-Key` is valid (GET /api/v1/auth/me) and only then proxies to the
# MCP container on localhost. The sidecar is the public port; cognee-mcp itself is
# not reachable from outside. Callers still act as the MCP server's own API user.
log "Requiring a valid Cognee API key on $MCP_APP (nginx sidecar)"
tmp=$(mktemp)
az containerapp show -n "$MCP_APP" -g "$RG" -o yaml >"$tmp"
API_HOST="${API_APP}.${DOMAIN}" python3 - "$tmp" <<'PY'
import os, sys, yaml
path = sys.argv[1]
doc = yaml.safe_load(open(path))

# ${API_HOST} is filled in by the nginx image's envsubst from the container env.
# The API's address is resolved once, when nginx starts.
conf = """\
# Accepted keys are cached for a minute, so a revoked key stops working within it.
proxy_cache_path /var/cache/nginx/mcp_auth keys_zone=mcp_auth:1m max_size=1m inactive=5m;
server {
    listen 8080;

    location = /_auth {
        internal;
        proxy_pass https://${API_HOST}/api/v1/auth/me;
        # nginx defaults to HTTP/1.0 upstream, which the Container Apps ingress
        # in front of the API rejects with 426.
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
        proxy_set_header X-Api-Key $http_x_api_key;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_cache mcp_auth;
        proxy_cache_key $http_x_api_key;
        proxy_cache_valid 200 60s;
        proxy_ignore_headers Set-Cookie Cache-Control Expires;
    }

    location / {
        if ($http_x_api_key = "") { return 401 "unauthorized\\n"; }
        auth_request /_auth;
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Connection "";
        # The caller's key is checked here, not passed on to the MCP server.
        proxy_set_header X-Api-Key "";
        # Streamable HTTP / SSE: never buffer, allow long-lived responses.
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
"""
script = (
    "mkdir -p /etc/nginx/templates"
    " && printf '%s\\n' \"$NGINX_CONF\" > /etc/nginx/templates/default.conf.template"
    " && exec /docker-entrypoint.sh nginx -g 'daemon off;'"
)
sidecar = {
    "name": "mcp-auth",
    "image": "docker.io/library/nginx:1.27-alpine",
    "command": ["/bin/sh", "-c"],
    "args": [script],
    "resources": {"cpu": 0.25, "memory": "0.5Gi"},
    "env": [
        {"name": "NGINX_CONF", "value": conf},
        {"name": "API_HOST", "value": os.environ["API_HOST"]},
    ],
}
tpl = doc["properties"]["template"]
tpl["containers"] = [c for c in tpl["containers"] if c["name"] != "mcp-auth"] + [sidecar]
doc["properties"]["configuration"]["ingress"]["targetPort"] = 8080
yaml.safe_dump(doc, open(path, "w"))
PY
az containerapp update -n "$MCP_APP" -g "$RG" --yaml "$tmp" -o none
rm -f "$tmp"

log "Done"
echo "UI:   $UI_URL   (login: default_user@example.com / DEFAULT_USER_PASSWORD in $CREDS_FILE)"
echo "MCP:  https://$MCP_HOST/mcp   (streamable HTTP, header: X-Api-Key: <a Cognee API key>)"
