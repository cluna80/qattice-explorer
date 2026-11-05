# Node API used by the Explorer (observed against Qattice `main` at `3fa3754`)

All requests are `GET`. Success responses carry `Access-Control-Allow-Origin: *` and `OPTIONS` is answered, so a page served from
`http://localhost:5500` can read nodes on other ports.

| Endpoint | Returns | Used for |
|---|---|---|
| `/api/status` | `chain_id, environment, height, peer_count, state_root, engine_version, is_running, attestation_*, insecure_dev_identity_overrides, local_peer_id` | reachability, height, chain identity. `local_peer_id` is dropped. |
| `/api/blocks` | up to 100 block summaries, newest first: `height, block_hash, round, state_root, timestamp_ms, tx_count, tx_ids, proposer, last_commit_signers` | block stream, interval, agreement |
| `/api/blocks/{height}` | one block summary, or `404 {"error":"not found"}` | newest-block top-up and block detail |
| `/api/validators` | `id, voting_power, pop_verified, consensus_pubkey` (the key is ~4 KB of hex per validator) | validator table; the key is discarded |
| `/api/validators/status` | `id, status, bonded_uqcb, jail_*, liveness_*` | validator status |
| `/api/peers` | `peer_id, addr, chain_id, genesis_hash, connected, score` | **counts only** |

## Things the page cannot know from this API
* **The consensus engine.** There is no field. The Explorer therefore does not say HotStuff, Tendermint or anything else.
* Transactions (no list endpoint), finality time, TPS, signing profile/algorithm, identity, PoCD, economics.

## Behaviour worth knowing
* **The 404 reply has no CORS header.** A browser cannot read a 404 from `/api/blocks/{height}`; it looks like a network error. The
  Explorer therefore decides reachability from `/api/status` only, and a failed block-detail request means "that block could not be
  read", never "node offline".
* `timestamp_ms` is the node's clock. Ages are computed against the viewing machine's clock, so they are meaningful on one machine
  (the development setup) and approximate across machines.
* Every node's block list is compared at the highest height all nodes share; equal block hash **and** state root = agreement.
* Heights and counts must be whole numbers within JavaScript's safe-integer range, otherwise the payload is treated as unsupported.
