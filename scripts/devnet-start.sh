#!/usr/bin/env bash
# Start a PERSISTENT four-node Qattice devnet for the Explorer (unlike tests/devnet/run_4node_devnet.sh, which tears the
# nodes down as soon as it reaches its target height).
#
#   scripts/devnet-start.sh --repo /c/Dev/chain-forge-engine            # your Qattice checkout (needs a built node binary)
#   scripts/devnet-start.sh --repo ... --bin /c/Dev/cf-target2/debug/chain-forge-node.exe
#
# API ports 19080-19083 (the Explorer's defaults), P2P ports 28000-28003 (the same as the repo's own script, so do not run both).
# State: $QATT_DEVNET_DIR (default ~/.qattice-devnet): pids, logs. Stop with scripts/devnet-stop.sh.
# The nodes run without --data-dir: the chain restarts from genesis each time you start it. Devnet keys only (committed test keys).
set -euo pipefail

REPO=""; BIN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --bin)  BIN="$2";  shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$REPO" && -d "$REPO" ]] || { echo "usage: $0 --repo <Qattice checkout> [--bin <chain-forge-node binary>]" >&2; exit 2; }

if [[ -z "$BIN" ]]; then
  for c in "${CARGO_TARGET_DIR:-/nonexistent}/debug/chain-forge-node.exe" "${CARGO_TARGET_DIR:-/nonexistent}/debug/chain-forge-node" \
           "$REPO/target/debug/chain-forge-node.exe" "$REPO/target/debug/chain-forge-node"; do
    [[ -x "$c" ]] && { BIN="$c"; break; }
  done
fi
[[ -n "$BIN" && -x "$BIN" ]] || { echo "no node binary found; build it (cargo build -p chain-forge-node) or pass --bin" >&2; exit 1; }

GENESIS="$REPO/tests/devnet/genesis-4node-mldsa.json"
KEYS="$REPO/tests/devnet/keys/mldsa"
[[ -f "$GENESIS" ]] || { echo "missing $GENESIS" >&2; exit 1; }

STATE="${QATT_DEVNET_DIR:-$HOME/.qattice-devnet}"
mkdir -p "$STATE/logs"
if [[ -s "$STATE/pids" ]]; then
  while read -r pid; do
    if kill -0 "$pid" 2>/dev/null; then echo "a devnet already seems to be running (pid $pid). Run scripts/devnet-stop.sh first." >&2; exit 1; fi
  done < "$STATE/pids"
fi
: > "$STATE/pids"

NAMES=(alice bob carol dave); API=(19080 19081 19082 19083); P2P=(28000 28001 28002 28003)
echo "binary:  $BIN"; echo "genesis: $GENESIS"; echo "state:   $STATE"
for i in 0 1 2 3; do
  n="${NAMES[$i]}"
  boot=(); [[ $i -gt 0 ]] && boot=(--bootstrap "/ip4/127.0.0.1/tcp/${P2P[0]}")
  # No wrapper subshell: $! must be the node process itself, or stop cannot find it.
  nohup "$BIN" --genesis "$GENESIS" --validator "qcb1$n" --key-file "$KEYS/$n.key.json" \
        --api-port "${API[$i]}" --p2p-port "${P2P[$i]}" "${boot[@]}" > "$STATE/logs/$n.log" 2>&1 &
  echo $! >> "$STATE/pids"
  echo "started $n (pid $!, api :${API[$i]})"
done

echo "waiting for the nodes to answer..."
for attempt in $(seq 1 40); do
  up=0
  for p in "${API[@]}"; do curl -fsS --max-time 2 "http://127.0.0.1:$p/api/status" >/dev/null 2>&1 && up=$((up+1)) || true; done
  [[ $up -eq 4 ]] && { echo "all four nodes are answering. Serve the Explorer (python3 -m http.server 5500) and open http://localhost:5500/"; exit 0; }
  sleep 1
done
echo "only $up of 4 nodes answered; see $STATE/logs" >&2; exit 1
