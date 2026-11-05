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
**Cause (established by measurement): the nodes must be started in order.** The node dials its `--bootstrap` address once at startup and
apparently does not retry (this is the roadmap's open "P2P reconnection" item). If the other nodes start before alice is listening, they
never connect: the API answers, `peer_count` stays `0`, the log ends at "node ready -- waiting for transactions and blocks", and no block is
ever produced. mDNS "discovered peer" lines in the log do **not** mean a connection exists.

| How the four nodes were started (Linux sandbox, same binary, same genesis) | Connected and producing blocks |
|---|---|
| all four at once, as `tests/devnet/run_4node_devnet.sh` does (25 s window) | 2 of 5 |
| all four at once, my own harness (24 s window) | 2 of 6 (one needed 16 s) |
| alice first, wait for her API, then the others 1 s apart | **6 of 6**, in about 7 s |
| `scripts/devnet-start.sh` (staggered) | **6 of 6** reported connected |

The first BossKing run (all four started at once; `peer_count: 0` on both nodes inspected; logs full of mDNS discoveries and no connection) is
consistent with this. It was **not** shown to be Windows-specific: the same stall reproduces on Linux, where no path rewriting exists.
Git Bash rewriting the `--bootstrap /ip4/...` argument into a Windows path was my first suspicion. It is **not the cause** of the stall
(the start-order race is, and the race reproduces without it). The rewriting itself is **real**: Git Bash rewrites arguments that start with `/`
when it launches a native `.exe` (shown with `whoami /user`). An earlier version of this page said there was no evidence it happens;
that was too strong. So the guard in `devnet-start.sh` (it disables the rewriting and passes Windows-style paths via `cygpath`) is kept
as a real precaution, though it has not been exercised against this node on Windows. See `ROADMAP.md`, "Four-node startup failure: correction".

`scripts/devnet-start.sh` therefore starts alice, waits for her API, starts the others one second apart, and then waits until a node reports
`peer_count > 0`. If that does not happen within 30 s it exits `3` with a warning instead of claiming success. The Explorer says
"Nodes answer, but they have not produced a block yet (height 0); no node has any peers, so they are not connected to each other" when it sees this.
If you start the nodes some other way: start the first node, wait until `curl http://127.0.0.1:19080/api/status` answers, then start the rest.

If it still stalls, collect:
```bash
ls -la /c/Dev/cf-target2/debug/chain-forge-node.exe          # when was the binary built?
tail -n 40 ~/.qattice-devnet/logs/alice.log ; tail -n 40 ~/.qattice-devnet/logs/bob.log
curl -s http://127.0.0.1:19081/api/status ; echo             # peer_count
```
