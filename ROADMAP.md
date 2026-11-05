# Qattice Explorer — Roadmap

Status of the **Explorer only**. The blockchain's own roadmap lives in [`cluna80/Qattice`](https://github.com/cluna80/Qattice/blob/main/ROADMAP.md); the two are independent and neither is a substitute for the other.

**Status words are strict.** *Implemented* = code exists on a branch. *Tested* = the automated tests pass; *Windows-confirmed* = the owner ran the stated checks on the Windows machine (BossKing) and reported the result in the PR. *Merged* = in `main`. *Deployed* = publicly reachable. At the time of writing **nothing in this repository beyond the initial `index.html` is merged, and nothing is deployed.**

Last updated: 2026-11-05 · Draft; documentation only.

## Principles (carried from the assignment)
- Read-only: GET requests to an allowlisted set of `/api` paths. No transaction submission, no identity, no keys, no wallet connection.
- No sample or placeholder values presented as live data; stale and offline states are shown as such.
- Not presented as PQ-HotStuff: the devnet nodes run the Tendermint-based devnet engine, and the Explorer says only what the node reports.
- No build step and no dependencies (Node ≥ 18 for the tests).

## Where things are
| Item | State |
|---|---|
| `main` | contains only the initial `index.html` |
| [PR #1](https://github.com/cluna80/qattice-explorer/pull/1) — dashboard (`explorer/dashboard-assets`) | draft, not merged |
| `feat/restore-explorer-assets` | recovered website assets; branch only |
| [PR #2](https://github.com/cluna80/qattice-explorer/pull/2) — live read-only Explorer (`feat/explorer-live-devnet`, based on the recovered-assets branch) | draft, **not merged** |

## Completed (implemented on a branch; none merged)
| Milestone | Evidence |
|---|---|
| Approved QATT dashboard visual design | draft PR #1; `index.html`, `style.css`, `dashboard.png` |
| Recovered website assets | branch `feat/restore-explorer-assets` |
| Live read-only polling of four devnet nodes (status, blocks, validators, validator status, peers) | PR #2; responses validated against captures from real nodes |
| Online / offline / stale states (no invented numbers; "last height N seen Ns ago (not live)") | PR #2; offline tests and a real-browser online/offline check |
| Block stream and block detail from the node itself | PR #2 |
| Network-agreement check across nodes; honest banner when nodes answer but are not producing blocks or have no peers | PR #2 (added after the first Windows run exposed a misleading "4 of 4 online") |
| Automated tests | `node tests/run.js`: 59 / 59 pass in the Linux sandbox at `1f3cf35` |
| Windows check | owner-reported in PR #2 at `1f3cf35` (tests, live check, real browser online/offline); see the PR for the exact output |

## In progress
- Review and merge decision for PR #1 and PR #2: **owner decision**, nothing is merged without explicit approval.
- Documentation accuracy (this PR): the four-node startup explanation, below.

## Future (not started, not authorized)
| Milestone | Notes |
|---|---|
| Transaction indexing and search | needs a node-side or indexer API; the Explorer is read-only and has no index today |
| Account and validator pages | only from data the node actually serves |
| PQ-HotStuff observatory | **blocked** on a PQ-HotStuff network existing; the Qattice roadmap has not implemented it, so nothing may be labelled as such until then |
| Per-node data-source configuration and bounded public RPC | only after the node's public RPC posture is decided in the Qattice roadmap |
| Public deployment | requires an explicit decision, a stable public API, and a review of CORS and rate limits |
| Accessibility and mobile pass | visual and keyboard review beyond the current layout checks |

## Known limits
- The node answers CORS only on successful responses; a browser cannot read its 404 for a missing block, so a failed block-detail request never means "node offline". Reachability is decided by `/api/status` alone.
- `/api/status` has no consensus-engine field, so the Explorer cannot state which engine is running.
- `peer_count` 0 means *not connected*, even when the logs show mDNS "discovered peer" lines.

## Four-node startup failure: correction
**Finding (confirmed): a bootstrap start-order race with no retry in the node.** Each node dials its `--bootstrap` address once at startup and does not retry. If the other nodes start before the first node is listening, they never connect: the API answers, `peer_count` stays 0, and no block is produced.

Measured in the **Linux sandbox** with the same binary and genesis: all four nodes started at once connected in only 2 of 5 and 2 of 6 runs; starting the first node, waiting for its API, then the others connected in 6 of 6 (about 7 s). The first Windows run stalled the same way. The stall therefore is **not Windows-specific**.

**Earlier wrong explanation (retracted):** the first suspicion was Git Bash (MSYS) rewriting the `--bootstrap /ip4/...` argument into a Windows path. That is **not the cause** of the stall. Separately, the rewriting itself is a **real** hazard for any argument beginning with `/` when a native `.exe` is launched from Git Bash (shown on Windows with `whoami /user`), so `scripts/devnet-start.sh` keeps its guard (`MSYS_NO_PATHCONV=1`); an earlier note in `docs/LIVE-DEVNET.md` saying there was "no evidence it happens" was too strong and is corrected in this PR.

**Fix location:** the node (`cluna80/Qattice`): bounded retry with backoff plus a deterministic repeated four-node startup test. Not done. Until then the Explorer scripts start the first node first.
