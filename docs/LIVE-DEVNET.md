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

## Height stays at 0 (the API answers, but no block is produced)
This was seen on the first BossKing run: all four nodes answered `/api/status` with `height 0`, `/api/blocks` was empty and `/api/validators`
returned no validators for more than 20 seconds, while the same start in a Linux sandbox reached height 4 within about 12 seconds. The Explorer
reports this as *"Nodes answer, but they have not produced a block yet (height 0)"* and `live-check.js` fails with a message saying so.
The API being up only proves the process started; consensus needs the four nodes to find each other and vote. **Cause not yet established.**
Collect, in this order:
```bash
ls -la /c/Dev/cf-target2/debug/chain-forge-node.exe                 # when was this binary built? is it from the commit you meant?
tail -n 40 ~/.qattice-devnet/logs/alice.log                          # the bootstrap node: any error, panic, or "waiting for peers"?
tail -n 40 ~/.qattice-devnet/logs/bob.log
curl -s http://127.0.0.1:19080/api/status; echo                      # peer_count: 0 or 1 means the nodes did not connect
curl -s http://127.0.0.1:19081/api/status; echo
```
**Baseline comparison (decisive):** stop this devnet (`scripts/devnet-stop.sh`) and run the repository's own script on the same binary:
`cd /c/Dev/qattice-main-wt && BIN=/c/Dev/cf-target2/debug/chain-forge-node.exe ./tests/devnet/run_4node_devnet.sh --timeout 90 --target-height 3`.
If that also stalls, the cause is the node build or the Windows environment, not these scripts. If it reaches height 3, the difference is in how
`devnet-start.sh` launches the nodes.
Unverified suspects, to check against the logs (not conclusions): the binary is not the freshly built `main` one; the Windows firewall prompt for
the new executable is waiting for an answer; Git Bash converting the `--bootstrap /ip4/...` argument (which starts with `/`) into a Windows path
(`MSYS_NO_PATHCONV=1` disables that conversion; the repository's own script has the same argument); startup order or timing on this machine.

