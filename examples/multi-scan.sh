#!/usr/bin/env bash
# multi-scan.sh — orchestrate filecap scans across multiple SSH-reachable servers.
#
# Customize the SERVERS map below with your own server name → "user@host:/scan/path"
# entries, then run from a directory where you want ./inventories/ and the
# consolidated outputs to land:
#
#   ./examples/multi-scan.sh
#
# Each server scan runs filecap remotely via `npx --yes @icjia/filecap scan ... -o -`
# and pipes the NDJSON output back over SSH. CPU work (walk, hash, introspection)
# happens on the remote; only the small NDJSON output crosses the network.
#
# This is a starter template — extend it with retry logic, parallel execution,
# logging, or whatever your operational needs require.

set -euo pipefail

declare -A SERVERS=(
  ["strapi-prod-01"]="deploy@strapi-prod-01.icjia.local:/var/strapi/uploads"
  ["strapi-prod-02"]="deploy@strapi-prod-02.icjia.local:/var/strapi/uploads"
  # ["general-files"]="deploy@files.icjia.local:/srv/shared/documents"
)

INVENTORIES_DIR="./inventories"
mkdir -p "$INVENTORIES_DIR"

for name in "${!SERVERS[@]}"; do
  target="${SERVERS[$name]}"
  user_host="${target%:*}"
  remote_path="${target##*:}"
  out="$INVENTORIES_DIR/$name.ndjson"

  echo "==> Scanning $name ($user_host:$remote_path)"
  if ssh "$user_host" "npx --yes @icjia/filecap scan '$remote_path' -o -" > "$out"; then
    echo "    wrote $out ($(wc -l < "$out") lines)"
  else
    echo "    FAILED — partial output (if any) is at $out" >&2
  fi
done

echo
echo "==> Per-server scans complete. Inventories in $INVENTORIES_DIR/"
echo "    Future phases will add: filecap rollup ${INVENTORIES_DIR}/*.ndjson -o consolidated.ndjson"
echo "    Future phases will add: filecap report consolidated.ndjson -o ./report/"
