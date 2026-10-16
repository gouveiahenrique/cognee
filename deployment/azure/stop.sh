#!/usr/bin/env bash
# Pause the Azure deployment to save money, keeping all data.
#
# Usage: deployment/azure/stop.sh
#
# - Container apps scale to zero replicas: no compute is billed, URLs, secrets
#   and config stay. (Without a running replica, requests just wait for one;
#   start.sh puts the always-on replica back.)
# - Postgres is stopped: compute stops billing, storage (32 GiB) still bills.
#   Azure restarts a stopped Flexible Server automatically after 7 days; run
#   this script again to stop it again.
#
# Left as is (small fixed cost): the registry (Basic), the storage account,
# Log Analytics and the Container Apps environment, which bills nothing idle.
set -euo pipefail

RG="${RG:-rg-cognee}"
PREFIX="${PREFIX:-cognee}"
CREDS_FILE="${CREDS_FILE:-$HOME/.cognee-azure/${RG}.env}"
# shellcheck disable=SC1090
. "$CREDS_FILE"
PG_SERVER="${PREFIX}-pg-${SUFFIX}"

for app in "${PREFIX}-ui" "${PREFIX}-mcp" "${PREFIX}-api"; do
  if az containerapp show -n "$app" -g "$RG" -o none 2>/dev/null; then
    echo "==> Scaling $app to zero"
    az containerapp update -n "$app" -g "$RG" --min-replicas 0 --max-replicas 1 -o none
  fi
done

state=$(az postgres flexible-server show -n "$PG_SERVER" -g "$RG" --query state -o tsv)
if [ "$state" = "Stopped" ]; then
  echo "==> Postgres $PG_SERVER already stopped"
else
  echo "==> Stopping Postgres $PG_SERVER (state: $state)"
  az postgres flexible-server stop -n "$PG_SERVER" -g "$RG" -o none
fi

echo "==> Stopped. Run deployment/azure/start.sh to bring it back."
