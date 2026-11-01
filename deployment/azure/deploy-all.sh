#!/usr/bin/env bash
# Deploy the Cognee API, UI, and MCP server to Azure Container Apps.
#
# Usage: deployment/azure/deploy-all.sh [path/to/.env] [--check]
#
# This is a thin orchestrator: deploy.sh provisions the API and shared
# infrastructure; deploy-ui-mcp.sh deploys the UI and authenticated MCP app.
# Shared settings (RG, PREFIX, CREDS_FILE, image overrides) are passed through.
# --check validates local inputs and Azure login without changing Azure.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
CALLER_PWD=$PWD
API_SCRIPT="$SCRIPT_DIR/deploy.sh"
UI_MCP_SCRIPT="$SCRIPT_DIR/deploy-ui-mcp.sh"
ENV_FILE=".env"
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -* ) echo "unknown option: $arg" >&2; exit 2 ;;
    * )
      if [ "$ENV_FILE" != ".env" ]; then
        echo "only one .env path may be supplied" >&2
        exit 2
      fi
      ENV_FILE="$arg"
      ;;
  esac
done

if [ "$ENV_FILE" != ".env" ] && [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$CALLER_PWD/$ENV_FILE"
fi
if [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$REPO_ROOT/$ENV_FILE"
fi

cd "$REPO_ROOT"

RG="${RG:-rg-cognee}"
PREFIX="${PREFIX:-cognee}"
CREDS_FILE="${CREDS_FILE:-$HOME/.cognee-azure/${RG}.env}"
LOCATION="${LOCATION:-eastus2}"
API_READY_TIMEOUT_SECONDS="${API_READY_TIMEOUT_SECONDS:-600}"
API_READY_INTERVAL_SECONDS="${API_READY_INTERVAL_SECONDS:-10}"
export RG PREFIX CREDS_FILE LOCATION

log() { printf '\n==> %s\n' "$*"; }
fail() { echo "deploy-all: $*" >&2; exit 1; }

for command_name in az curl python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command '$command_name' is not installed"
done
[ -f "$API_SCRIPT" ] || fail "API deployment script not found: $API_SCRIPT"
[ -f "$UI_MCP_SCRIPT" ] || fail "UI/MCP deployment script not found: $UI_MCP_SCRIPT"
[ -f "$ENV_FILE" ] || fail "env file not found: $ENV_FILE"

case "$API_READY_TIMEOUT_SECONDS:$API_READY_INTERVAL_SECONDS" in
  *[!0-9:]*|:*|*:) fail "API readiness timeout and interval must be positive integers" ;;
esac
[ "$API_READY_TIMEOUT_SECONDS" -gt 0 ] || fail "API readiness timeout must be positive"
[ "$API_READY_INTERVAL_SECONDS" -gt 0 ] || fail "API readiness interval must be positive"

az account show -o none >/dev/null 2>&1 || fail "Azure CLI is not logged in; run 'az login' first"
python3 -c 'import yaml' >/dev/null 2>&1 || fail "Python PyYAML is required by the deployment scripts"

log "Preflight passed"
printf 'Repository: %s\nResource group: %s\nLocation: %s\nPrefix: %s\nCredentials: %s\nEnv file: %s\n' \
  "$REPO_ROOT" "$RG" "$LOCATION" "$PREFIX" "$CREDS_FILE" "$ENV_FILE"
if [ -n "${IMAGE:-}" ]; then printf 'API image override: %s\n' "$IMAGE"; fi
if [ -n "${UI_IMAGE:-}" ]; then printf 'UI image override: %s\n' "$UI_IMAGE"; fi
if [ -n "${MCP_IMAGE:-}" ]; then printf 'MCP image override: %s\n' "$MCP_IMAGE"; fi

if [ "$CHECK_ONLY" = "1" ]; then
  log "Check-only mode; Azure resources were not changed"
  exit 0
fi

log "Deploying API and shared infrastructure"
bash "$API_SCRIPT" "$ENV_FILE"

ACA_ENV="${PREFIX}-env"
API_APP="${API_APP:-${PREFIX}-api}"
DOMAIN=$(az containerapp env show -n "$ACA_ENV" -g "$RG" --query properties.defaultDomain -o tsv)
[ -n "$DOMAIN" ] || fail "could not determine Container Apps domain for $ACA_ENV"
API_URL="https://${API_APP}.${DOMAIN}"

log "Waiting for API health at $API_URL/health (timeout ${API_READY_TIMEOUT_SECONDS}s)"
start_time=$(date +%s)
while ! curl --fail --silent --show-error --max-time 10 "$API_URL/health" >/dev/null 2>&1; do
  now=$(date +%s)
  elapsed=$((now - start_time))
  if [ "$elapsed" -ge "$API_READY_TIMEOUT_SECONDS" ]; then
    fail "API did not become healthy within ${API_READY_TIMEOUT_SECONDS}s: $API_URL/health"
  fi
  printf 'API not ready yet (%ss elapsed); retrying in %ss\n' "$elapsed" "$API_READY_INTERVAL_SECONDS"
  sleep "$API_READY_INTERVAL_SECONDS"
done

log "API is healthy; deploying UI and MCP"
bash "$UI_MCP_SCRIPT"

log "All components deployed"
printf 'API: %s\nUI:  https://%s.%s\nMCP: https://%s.%s/mcp\n' \
  "$API_URL" "${UI_APP:-${PREFIX}-ui}" "$DOMAIN" "${MCP_APP:-${PREFIX}-mcp}" "$DOMAIN"
