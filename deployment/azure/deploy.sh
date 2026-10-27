#!/usr/bin/env bash
# Deploy the cognee API to Azure Container Apps backed by Azure Database for
# PostgreSQL Flexible Server (relational + pgvector + postgres_demo graph).
#
# Usage: deployment/azure/deploy.sh [path/to/.env]
#
# LLM/embedding settings are read from the given .env (default: ./.env). Keys
# become Container Apps secrets and are never echoed. Generated credentials
# (Postgres admin password, default-user password, JWT secrets) are written to
# $CREDS_FILE (mode 600) and reused on re-runs, so the script is idempotent.
#
# GitHub / Linear connectors: set GITHUB_* / LINEAR_* in the .env (see
# .env.template) and they are passed to the API; callback and frontend URLs
# default to this deployment's API and UI apps.
#
# Image: by default the image is built in a private ACR from ./Dockerfile and the
# app pulls it with its managed identity (needs rights to create an AcrPull role
# assignment). Set IMAGE to a public image (e.g. IMAGE=docker.io/cognee/cognee:1.6.3)
# to skip the ACR, the build and the role assignment entirely.
#
# NOTE: graph-on-Postgres (postgres_demo) is a demo backend, not production-ready.
set -euo pipefail

ENV_FILE="${1:-.env}"
LOCATION="${LOCATION:-eastus2}"
RG="${RG:-rg-cognee}"
PREFIX="${PREFIX:-cognee}"
CREDS_FILE="${CREDS_FILE:-$HOME/.cognee-azure/${RG}.env}"

LOG_WS="${PREFIX}-logs"
ACA_ENV="${PREFIX}-env"
APP="${PREFIX}-api"
PG_SKU="${PG_SKU:-Standard_B1ms}"  # cheapest Flexible Server SKU
PG_VERSION="${PG_VERSION:-16}"
PG_DB="cognee_db"
PG_ADMIN="cogneeadmin"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"

log() { printf '\n==> %s\n' "$*"; }

# Read one value from the .env without sourcing it (it may contain shell-hostile
# lines). Strips surrounding quotes.
env_get() {
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- |
    sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

[ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }

# ---- credentials (generated once, reused) ---------------------------------
mkdir -p "$(dirname "$CREDS_FILE")"
if [ ! -f "$CREDS_FILE" ]; then
  umask 077
  suffix=$(openssl rand -hex 3)
  cat >"$CREDS_FILE" <<EOF
SUFFIX=$suffix
PG_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' )Aa1
DEFAULT_USER_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')
FASTAPI_USERS_JWT_SECRET=$(openssl rand -hex 32)
FASTAPI_USERS_RESET_PASSWORD_TOKEN_SECRET=$(openssl rand -hex 32)
FASTAPI_USERS_VERIFICATION_TOKEN_SECRET=$(openssl rand -hex 32)
EOF
fi
# Added after the first deploys, so older credential files lack it. Generated once
# and kept: changing the salt invalidates every stored API key.
if ! grep -q '^API_KEY_HASH_SALT=' "$CREDS_FILE"; then
  echo "API_KEY_HASH_SALT=$(openssl rand -hex 32)" >>"$CREDS_FILE"
fi
# shellcheck disable=SC1090
. "$CREDS_FILE"

ACR="${PREFIX}acr${SUFFIX}"
PG_SERVER="${PREFIX}-pg-${SUFFIX}"
STORAGE="${PREFIX}st${SUFFIX}"

# ---- prerequisites ---------------------------------------------------------
log "Registering providers and the containerapp extension"
az extension add --name containerapp --upgrade --only-show-errors
for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry \
  Microsoft.DBforPostgreSQL Microsoft.Storage; do
  az provider register -n "$ns" --wait --only-show-errors
done

log "Resource group $RG ($LOCATION)"
# A group's location only holds its metadata; reuse one created elsewhere.
az group show -n "$RG" -o none 2>/dev/null || az group create -n "$RG" -l "$LOCATION" -o none

# ---- registry + image ------------------------------------------------------
if [ -n "${IMAGE:-}" ]; then
  log "Using prebuilt image $IMAGE (no ACR, no build)"
else
  log "Container registry $ACR"
  az acr show -n "$ACR" -g "$RG" -o none 2>/dev/null ||
    az acr create -n "$ACR" -g "$RG" -l "${ACR_LOCATION:-$LOCATION}" --sku Basic --admin-enabled false -o none

  if [ "${SKIP_BUILD:-0}" = "1" ] ||
    az acr repository show -n "$ACR" --image "cognee:$IMAGE_TAG" -o none 2>/dev/null; then
    log "Image cognee:$IMAGE_TAG already in $ACR, skipping build"
  else
    log "Building image in ACR (linux/amd64): cognee:$IMAGE_TAG"
    # ACR quick builds use the legacy builder, which rejects BuildKit's
    # `RUN --mount=type=cache`. Those mounts are only uv download caches, so a
    # copy without them builds the same image, just without the cache.
    ACR_DOCKERFILE=".Dockerfile.acr"
    trap 'rm -f "$ACR_DOCKERFILE"' EXIT
    sed -E 's#--mount=type=cache,target=[^ ]+[[:space:]]*##' Dockerfile >"$ACR_DOCKERFILE"
    az acr build -r "$ACR" -t "cognee:$IMAGE_TAG" -t cognee:latest \
      --platform linux/amd64 --timeout 7200 -f "$ACR_DOCKERFILE" . --only-show-errors
    rm -f "$ACR_DOCKERFILE"
  fi
fi

# ---- postgres --------------------------------------------------------------
log "Postgres Flexible Server $PG_SERVER ($PG_SKU, v$PG_VERSION)"
if ! az postgres flexible-server show -n "$PG_SERVER" -g "$RG" -o none 2>/dev/null; then
  az postgres flexible-server create -n "$PG_SERVER" -g "$RG" -l "$LOCATION" \
    --tier Burstable --sku-name "$PG_SKU" --version "$PG_VERSION" \
    --storage-size 32 --storage-auto-grow Disabled --backup-retention 7 \
    --geo-redundant-backup Disabled --high-availability Disabled \
    --admin-user "$PG_ADMIN" --admin-password "$PG_PASSWORD" \
    --public-access 0.0.0.0 --yes -o none
fi
az postgres flexible-server db show -g "$RG" -s "$PG_SERVER" -d "$PG_DB" -o none 2>/dev/null ||
  az postgres flexible-server db create -g "$RG" -s "$PG_SERVER" -d "$PG_DB" -o none
# Allow-list pgvector; cognee runs CREATE EXTENSION itself (also per dataset DB).
az postgres flexible-server parameter set -g "$RG" -s "$PG_SERVER" \
  --name azure.extensions --value VECTOR -o none
PG_HOST=$(az postgres flexible-server show -n "$PG_SERVER" -g "$RG" \
  --query fullyQualifiedDomainName -o tsv)

# ---- storage for raw uploaded files ----------------------------------------
log "Storage account $STORAGE (Azure Files share for DATA_ROOT_DIRECTORY)"
az storage account show -n "$STORAGE" -g "$RG" -o none 2>/dev/null ||
  az storage account create -n "$STORAGE" -g "$RG" -l "$LOCATION" \
    --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 -o none
STORAGE_KEY=$(az storage account keys list -n "$STORAGE" -g "$RG" --query '[0].value' -o tsv)
az storage share-rm create --storage-account "$STORAGE" -g "$RG" -n cognee-data \
  --quota 100 -o none 2>/dev/null || true

# ---- container apps environment -------------------------------------------
log "Log Analytics + Container Apps environment $ACA_ENV"
az monitor log-analytics workspace show -n "$LOG_WS" -g "$RG" -o none 2>/dev/null ||
  az monitor log-analytics workspace create -n "$LOG_WS" -g "$RG" -l "$LOCATION" -o none
LOG_ID=$(az monitor log-analytics workspace show -n "$LOG_WS" -g "$RG" --query customerId -o tsv)
LOG_KEY=$(az monitor log-analytics workspace get-shared-keys -n "$LOG_WS" -g "$RG" \
  --query primarySharedKey -o tsv)
az containerapp env show -n "$ACA_ENV" -g "$RG" -o none 2>/dev/null ||
  az containerapp env create -n "$ACA_ENV" -g "$RG" -l "$LOCATION" \
    --logs-workspace-id "$LOG_ID" --logs-workspace-key "$LOG_KEY" -o none
az containerapp env storage show -n "$ACA_ENV" -g "$RG" --storage-name cognee-data -o none 2>/dev/null ||
  az containerapp env storage set -n "$ACA_ENV" -g "$RG" --storage-name cognee-data \
  --azure-file-account-name "$STORAGE" --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name cognee-data --access-mode ReadWrite -o none

# ---- app -------------------------------------------------------------------
LLM_API_KEY_VAL=$(env_get LLM_API_KEY)
EMBEDDING_API_KEY_VAL=$(env_get EMBEDDING_API_KEY)
[ -n "$LLM_API_KEY_VAL" ] || { echo "LLM_API_KEY missing in $ENV_FILE" >&2; exit 1; }
[ -n "$EMBEDDING_API_KEY_VAL" ] || EMBEDDING_API_KEY_VAL="$LLM_API_KEY_VAL"

SECRETS=(
  "llm-api-key=$LLM_API_KEY_VAL"
  "embedding-api-key=$EMBEDDING_API_KEY_VAL"
  "db-password=$PG_PASSWORD"
  "default-user-password=$DEFAULT_USER_PASSWORD"
  "jwt-secret=$FASTAPI_USERS_JWT_SECRET"
  "reset-secret=$FASTAPI_USERS_RESET_PASSWORD_TOKEN_SECRET"
  "verify-secret=$FASTAPI_USERS_VERIFICATION_TOKEN_SECRET"
  "api-key-hash-salt=$API_KEY_HASH_SALT"
  # The session cache does not read DATABASE_CONNECT_ARGS, so TLS goes in its URL.
  "cache-db-url=postgresql+asyncpg://$PG_ADMIN:$PG_PASSWORD@$PG_HOST:5432/$PG_DB?ssl=require"
)

ENVS=(
  "ENV=prod" "LOG_LEVEL=INFO"
  "DATA_ROOT_DIRECTORY=/cognee-storage/data"
  "SYSTEM_ROOT_DIRECTORY=/cognee-storage/system"
  "DB_PROVIDER=postgres" "DB_HOST=$PG_HOST" "DB_PORT=5432" "DB_NAME=$PG_DB"
  "DB_USERNAME=$PG_ADMIN" "DB_PASSWORD=secretref:db-password"
  'DATABASE_CONNECT_ARGS={"ssl": "require"}'
  # With access control on, pgvector and the Postgres graph need their own
  # credentials (no fallback to DB_*). The *_shared handlers keep every dataset
  # in one database (a schema each) instead of a database per dataset, which
  # fits the B1ms server's small connection limit.
  "VECTOR_DB_PROVIDER=pgvector" "VECTOR_DATASET_DATABASE_HANDLER=pgvector_shared"
  "VECTOR_DB_HOST=$PG_HOST" "VECTOR_DB_PORT=5432" "VECTOR_DB_NAME=$PG_DB"
  "VECTOR_DB_USERNAME=$PG_ADMIN" "VECTOR_DB_PASSWORD=secretref:db-password"
  "GRAPH_DATABASE_PROVIDER=postgres_demo"
  "GRAPH_DATASET_DATABASE_HANDLER=postgres_graph_shared"
  "GRAPH_DATABASE_HOST=$PG_HOST" "GRAPH_DATABASE_PORT=5432" "GRAPH_DATABASE_NAME=$PG_DB"
  "GRAPH_DATABASE_USERNAME=$PG_ADMIN" "GRAPH_DATABASE_PASSWORD=secretref:db-password"
  "CACHE_BACKEND=postgres" "CACHE_DB_URL=secretref:cache-db-url"
  "LLM_API_KEY=secretref:llm-api-key"
  "EMBEDDING_API_KEY=secretref:embedding-api-key"
  "DEFAULT_USER_PASSWORD=secretref:default-user-password"
  "FASTAPI_USERS_JWT_SECRET=secretref:jwt-secret"
  "FASTAPI_USERS_RESET_PASSWORD_TOKEN_SECRET=secretref:reset-secret"
  "FASTAPI_USERS_VERIFICATION_TOKEN_SECRET=secretref:verify-secret"
  # Store API keys hashed (existing plain-text keys are rehashed on startup)
  # and close public sign-up: admins add users from the UI's Members page.
  "HASH_API_KEY=true" "API_KEY_HASH_SALT=secretref:api-key-hash-salt"
  "ALLOW_PUBLIC_REGISTRATION=${ALLOW_PUBLIC_REGISTRATION:-false}"
  # Embed triplets at cognify so improve()'s triplet_enrichment stage runs;
  # without it a remember() with no session_id has no improve stage to run.
  "TRIPLET_EMBEDDING=${TRIPLET_EMBEDDING:-true}"
)
# Non-secret LLM/embedding settings copied from the .env when present.
for k in LLM_PROVIDER LLM_MODEL LLM_ENDPOINT LLM_API_VERSION EMBEDDING_PROVIDER \
  EMBEDDING_MODEL EMBEDDING_DIMENSIONS EMBEDDING_ENDPOINT EMBEDDING_API_VERSION \
  STRUCTURED_OUTPUT_FRAMEWORK \
  LLM_EXTRACTION_MODEL LLM_SUMMARIZATION_MODEL LLM_QUERY_MODEL; do
  v=$(env_get "$k")
  if [ -n "$v" ]; then ENVS+=("$k=$v"); fi
done

# GitHub App / Linear OAuth app, each only when its client id is in the .env.
# Secret values become Container Apps secrets; the callback and frontend URLs
# default to this deployment's own API and UI apps (deploy-ui-mcp.sh names the
# UI "${PREFIX}-ui"), so only the app registration values need to be supplied.
DOMAIN=$(az containerapp env show -n "$ACA_ENV" -g "$RG" --query properties.defaultDomain -o tsv)
add_integration() {
  local provider=$1 prefix=$2 secret_keys=$3 plain_keys=$4 k v name
  [ -n "$(env_get "${prefix}_CLIENT_ID")" ] || return 0
  log "Configuring the $provider integration"
  for k in $secret_keys; do
    v=$(env_get "${prefix}_$k")
    [ -n "$v" ] || { echo "${prefix}_$k missing in $ENV_FILE" >&2; exit 1; }
    name="$provider-$(echo "$k" | tr 'A-Z_' 'a-z-')"
    SECRETS+=("$name=$v")
    ENVS+=("${prefix}_$k=secretref:$name")
  done
  for k in $plain_keys; do
    v=$(env_get "${prefix}_$k")
    [ -n "$v" ] || { echo "${prefix}_$k missing in $ENV_FILE" >&2; exit 1; }
    ENVS+=("${prefix}_$k=$v")
  done
  v=$(env_get "${prefix}_REDIRECT_URI")
  ENVS+=("${prefix}_REDIRECT_URI=${v:-https://${APP}.${DOMAIN}/api/v1/integrations/${provider}/callback}")
  v=$(env_get "${prefix}_FRONTEND_BASE_URL")
  ENVS+=("${prefix}_FRONTEND_BASE_URL=${v:-https://${PREFIX}-ui.${DOMAIN}}")
}
add_integration github GITHUB "CLIENT_SECRET APP_PRIVATE_KEY WEBHOOK_SECRET" "CLIENT_ID APP_ID APP_SLUG"
add_integration linear LINEAR "CLIENT_SECRET WEBHOOK_SECRET" "CLIENT_ID"

if [ -n "${IMAGE:-}" ]; then
  APP_IMAGE="$IMAGE"
  REGISTRY_ARGS=()  # public image: anonymous pull
else
  ACR_SERVER=$(az acr show -n "$ACR" -g "$RG" --query loginServer -o tsv)
  APP_IMAGE="$ACR_SERVER/cognee:$IMAGE_TAG"
  REGISTRY_ARGS=(--registry-server "$ACR_SERVER" --registry-identity system)
fi

log "Container app $APP ($APP_IMAGE)"
if ! az containerapp show -n "$APP" -g "$RG" -o none 2>/dev/null; then
  # The ${arr[@]+...} form keeps an empty array safe under `set -u` on bash 3.2.
  az containerapp create -n "$APP" -g "$RG" --environment "$ACA_ENV" \
    --image "$APP_IMAGE" \
    ${REGISTRY_ARGS[@]+"${REGISTRY_ARGS[@]}"} \
    --ingress external --target-port 8000 \
    --cpu 2 --memory 4Gi --min-replicas 1 --max-replicas 1 \
    --secrets "${SECRETS[@]}" --env-vars "${ENVS[@]}" -o none
else
  # An app first created from a public image (IMAGE=...) has no registry login,
  # so switching it to the ACR image fails with UNAUTHORIZED. Give its identity
  # AcrPull and point the app at the registry before the image update.
  if [ -z "${IMAGE:-}" ] && [ -z "$(az containerapp show -n "$APP" -g "$RG" \
    --query "properties.configuration.registries[?server=='$ACR_SERVER'] | [0].server" -o tsv)" ]; then
    az containerapp identity assign -n "$APP" -g "$RG" --system-assigned -o none
    APP_PRINCIPAL=$(az containerapp show -n "$APP" -g "$RG" --query identity.principalId -o tsv)
    az role assignment create --assignee-object-id "$APP_PRINCIPAL" \
      --assignee-principal-type ServicePrincipal --role AcrPull \
      --scope "$(az acr show -n "$ACR" -g "$RG" --query id -o tsv)" -o none
    az containerapp registry set -n "$APP" -g "$RG" --server "$ACR_SERVER" \
      --identity system -o none
  fi
  az containerapp secret set -n "$APP" -g "$RG" --secrets "${SECRETS[@]}" -o none
  az containerapp update -n "$APP" -g "$RG" --image "$APP_IMAGE" \
    --set-env-vars "${ENVS[@]}" -o none
fi

# Mount the Azure Files share at the data root (raw uploaded files).
log "Mounting Azure Files at /cognee-storage/data"
tmp=$(mktemp)
az containerapp show -n "$APP" -g "$RG" -o yaml >"$tmp"
python3 - "$tmp" <<'PY'
import sys, yaml
path = sys.argv[1]
doc = yaml.safe_load(open(path))
tpl = doc["properties"]["template"]
tpl["volumes"] = [{"name": "cognee-data", "storageType": "AzureFile", "storageName": "cognee-data"}]
for c in tpl["containers"]:
    c["volumeMounts"] = [{"volumeName": "cognee-data", "mountPath": "/cognee-storage/data"}]
    c["probes"] = [
        {"type": "Startup", "httpGet": {"path": "/health", "port": 8000},
         "periodSeconds": 10, "failureThreshold": 30, "timeoutSeconds": 5},
        {"type": "Liveness", "httpGet": {"path": "/health", "port": 8000},
         "periodSeconds": 30, "failureThreshold": 3, "timeoutSeconds": 10},
    ]
yaml.safe_dump(doc, open(path, "w"))
PY
az containerapp update -n "$APP" -g "$RG" --yaml "$tmp" -o none
rm -f "$tmp"

FQDN=$(az containerapp show -n "$APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
log "Done"
echo "API:          https://$FQDN"
echo "Health:       https://$FQDN/health"
echo "Docs:         https://$FQDN/docs"
echo "Credentials:  $CREDS_FILE (default user: default_user@example.com)"
