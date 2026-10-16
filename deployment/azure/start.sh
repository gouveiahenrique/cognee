#!/usr/bin/env bash
# Resume a deployment paused with stop.sh and wait until the API answers.
#
# Usage: deployment/azure/start.sh
set -euo pipefail

RG="${RG:-rg-cognee}"
PREFIX="${PREFIX:-cognee}"
CREDS_FILE="${CREDS_FILE:-$HOME/.cognee-azure/${RG}.env}"
# shellcheck disable=SC1090
. "$CREDS_FILE"
PG_SERVER="${PREFIX}-pg-${SUFFIX}"
API_APP="${PREFIX}-api"

# Postgres first: the API runs migrations against it on startup.
state=$(az postgres flexible-server show -n "$PG_SERVER" -g "$RG" --query state -o tsv)
if [ "$state" = "Ready" ]; then
  echo "==> Postgres $PG_SERVER already running"
else
  echo "==> Starting Postgres $PG_SERVER (state: $state)"
  az postgres flexible-server start -n "$PG_SERVER" -g "$RG" -o none
fi

for app in "$API_APP" "${PREFIX}-mcp" "${PREFIX}-ui"; do
  if az containerapp show -n "$app" -g "$RG" -o none 2>/dev/null; then
    echo "==> Scaling $app to one always-on replica"
    az containerapp update -n "$app" -g "$RG" --min-replicas 1 --max-replicas 1 -o none
  fi
done

fqdn() { az containerapp show -n "$1" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv; }
API_URL="https://$(fqdn "$API_APP")"
echo "==> Waiting for $API_URL/health"
for _ in $(seq 1 60); do
  if curl -sf -m 10 -o /dev/null "$API_URL/health"; then
    echo "==> Up"
    echo "API:  $API_URL"
    if az containerapp show -n "${PREFIX}-ui" -g "$RG" -o none 2>/dev/null; then
      echo "UI:   https://$(fqdn "${PREFIX}-ui")"
    fi
    if az containerapp show -n "${PREFIX}-mcp" -g "$RG" -o none 2>/dev/null; then
      echo "MCP:  https://$(fqdn "${PREFIX}-mcp")/mcp"
    fi
    exit 0
  fi
  sleep 10
done
echo "API did not become healthy in 10 minutes; check: az containerapp logs show -n $API_APP -g $RG" >&2
exit 1
