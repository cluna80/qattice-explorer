#!/usr/bin/env bash
# Stop the devnet started by scripts/devnet-start.sh (only the processes whose pids it recorded).
set -euo pipefail
STATE="${QATT_DEVNET_DIR:-$HOME/.qattice-devnet}"
[[ -s "$STATE/pids" ]] || { echo "nothing recorded in $STATE/pids"; exit 0; }
while read -r pid; do
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null && echo "stopped pid $pid"; else echo "pid $pid was not running"; fi
done < "$STATE/pids"
# Give the nodes up to 5 s to exit on their own before forcing anything.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  alive=0; while read -r pid; do kill -0 "$pid" 2>/dev/null && alive=1; done < "$STATE/pids"
  [[ $alive -eq 0 ]] && break; sleep 0.5
done
while read -r pid; do kill -0 "$pid" 2>/dev/null && { kill -9 "$pid" 2>/dev/null || true; echo "force-stopped pid $pid (did not exit within 5 s)"; }; done < "$STATE/pids" || true
: > "$STATE/pids"
echo "done. (On Windows, if a node survives: tasklist | findstr chain-forge-node, then taskkill /PID <pid> /F)"
