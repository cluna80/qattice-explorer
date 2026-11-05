# Qattice Explorer

A read-only, live view of a Qattice devnet, taken from the nodes' HTTP API. **Nothing on the live page is a sample value**: every number is either returned by a node, or shown as `—`, or marked *Not provided by the node API*.

* `index.html` is the live Explorer (no build step, no dependencies; any static file server works).
* `reference.html` is the earlier mockup (screenshot + clickable zones). It holds **sample data** and says so in a banner; it is kept as an appearance reference only. `dashboard.png` belongs to it.

## Run it
```bash
# 1. a Qattice devnet must be running on the API ports (see docs/LIVE-DEVNET.md for a persistent four-node setup)
# 2. serve the Explorer
python3 -m http.server 5500          # Windows Git Bash: python -m http.server 5500
# 3. open http://localhost:5500/
```
Default nodes are `127.0.0.1:19080` – `19083`. Change them with the **Nodes…** button (saved in this browser), or per visit with
`http://localhost:5500/?nodes=127.0.0.1:20001,127.0.0.1:20002`; `?interval=5` sets the poll interval (1–60 s, default 2 s).

## What it shows, and what it deliberately does not
| Panel | Source | Notes |
|---|---|---|
| Banner, Nodes Online, Network Overview | `GET /api/status` per node | `online` / `stale` (answers, but no new block for 30 s) / `offline` (no answer) / `unsupported` (not a recognisable status) / `stopped` / `loading` |
| Chain Height, Latest Block, Block Stream, block detail | `/api/blocks`, `/api/blocks/{height}` | the newest block is read from the node itself even if the list lags |
| Validators | `/api/validators`, `/api/validators/status` | id, voting power, PoP flag, status, bond, missed %; the consensus public key is never kept or shown |
| Consensus Observatory | blocks + validators | **the consensus engine is not shown: the node API does not report it**, so none is named. Shows the latest block's proposer/round/commit evidence and whether the nodes agree on the same block hash and state root at a common height (or *DIVERGENCE*) |
| Observed Block Interval | block timestamps | computed by the Explorer from real timestamps |
| Transactions, Analytics, Post-Quantum Security, Identity, PoCD, Economics | — | *Not provided by the node API* (listed, never filled in) |

When no node answers the page says **Node offline**, shows `—` for every metric, and may show a node's last height only as *"(not live)"*.

## Safety properties (enforced by tests)
* Only `GET`, to six allowlisted paths. It never submits transactions and never reads identity, account, auth or admin endpoints.
* No credentials, no redirects, no request bodies; strict validation of every payload; unrecognised data is *unsupported*, not displayed.
* Peer ids and peer addresses are never stored or shown (counts only); the node's `local_peer_id` is dropped.
* All node-provided text is rendered with `textContent`; the page ships a content-security policy and no inline scripts, styles or handlers.

## Tests
```bash
node tests/run.js                                   # 54 offline tests (Node >= 18; no dependencies)
node scripts/live-check.js                          # against REAL nodes: height must advance, nodes must agree
node scripts/live-check.js --expect-offline         # passes only if no node answers and the Explorer says "Node offline"
node scripts/browser-check.js --screenshot out.png  # optional: real Chromium (needs Playwright), exercises real CORS
```
Fixtures in `tests/fixtures/live_*.json` are real responses captured from four running nodes (Qattice `main` at `3fa3754`).

## Known gaps
See `docs/NODE-API.md`. Screenshots in `docs/screenshots/` come from a Linux sandbox run, not from the owner's machine.
