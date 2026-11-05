# A persistent four-node devnet for the Explorer

`tests/devnet/run_4node_devnet.sh` in the Qattice repository starts four nodes, waits for a target height, then **tears them down**,
so it is unsuitable for watching. `scripts/devnet-start.sh` here starts the same four nodes (same genesis, same committed devnet-only
keys, API `19080-19083`, P2P `28000-28003`) and leaves them running. Do not run both at once: the ports are the same.

## Linux / macOS / Git Bash
```bash
# build the node once, from the Qattice commit you want to watch (do this in a separate worktree so your work is untouched)
cd /c/Dev/chain-forge-engine && git fetch origin main
git worktree add ../qattice-main-wt origin/main && cd ../qattice-main-wt
export CARGO_INCREMENTAL=0 && cargo build -j 2 -p chain-forge-node          # binary lands in $CARGO_TARGET_DIR/debug (or ./target/debug)

# start the devnet and the Explorer
cd /c/Dev/qattice-explorer
scripts/devnet-start.sh --repo /c/Dev/qattice-main-wt                        # add --bin <path>.exe if it cannot find the binary
scripts/devnet-status.sh                                                      # four heights that keep growing
python -m http.server 5500                                                    # in a second Git Bash window; open http://localhost:5500/
```
State (pids, logs) lives in `~/.qattice-devnet` (override with `QATT_DEVNET_DIR`). Stop with `scripts/devnet-stop.sh`. The nodes have
no data directory: starting again restarts the chain from genesis.

## Acceptance procedure (what to look at)
1. `node scripts/live-check.js` prints four heights rising together and ends with `PASS` (every node advanced and all agree on the block hash).
2. In the browser the banner reads `4 of 4 nodes online`, *Chain Height* rises about every 2-3 seconds, and the newest block appears at
   the top of *Block Stream* with its hash and proposer. Clicking a block reads it from the node.
3. `scripts/devnet-stop.sh`: within about two poll intervals the banner becomes **Node offline**, the metrics become `—`, and each node row
   says `last height N seen Ns ago (not live)`.
4. Start only some nodes (or stop one process): the banner says `3 of 4 nodes online`.

## Troubleshooting
* *Banner says "Node offline" but the nodes run*: open `http://127.0.0.1:19080/api/status` directly; check the ports in **Nodes…**; the page
  must be served over `http://` (not `file://`) and the nodes must be plain `http`.
* A node's log is `~/.qattice-devnet/logs/<name>.log`.
* On Windows, if `devnet-stop.sh` leaves a node: `tasklist | findstr chain-forge-node`, then `taskkill /PID <pid> /F`.
