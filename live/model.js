'use strict';
/*
 * Qattice Explorer — live data model (pure functions, no DOM, no network).
 *
 * Loaded by the browser as a classic script (window.QatticeLive) and by the Node tests (require). Everything here is
 * deterministic so it can be tested against fixtures captured from real nodes.
 *
 * Rules this module enforces:
 *   - Only values the node API actually returned are ever shown as live. Anything missing, malformed or not provided is
 *     reported as "unsupported", never filled in with a sample.
 *   - The consensus engine is not reported by the node API, so it is never named here.
 *   - Private/administrative data is never requested: the allowlist below is the complete set of paths the Explorer may read.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QatticeLive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_NODES = ['127.0.0.1:19080', '127.0.0.1:19081', '127.0.0.1:19082', '127.0.0.1:19083'];
  const POLL_MS = 2000;
  const STALE_AFTER_MS = 30000;
  const REQUEST_TIMEOUT_MS = 3000;
  const SLOW_EVERY = 5; // validators / validator status / peers are re-read every Nth poll
  const MAX_NODES = 16;

  /** The complete list of node paths the Explorer may request (all GET, read-only). */
  const ALLOWED_PATH = /^\/api\/(status|blocks|blocks\/\d{1,15}|validators|validators\/status|peers)$/;
  const isAllowedPath = (p) => typeof p === 'string' && ALLOWED_PATH.test(p);

  // ── node addresses ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** `host:port` or `http://host:port` only: no credentials, path, query or other scheme. */
  function parseNodeAddress(input) {
    const m = /^(?:http:\/\/)?([A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:]{2,45}\]):(\d{1,5})\/?$/.exec(String(input == null ? '' : input).trim());
    if (!m) return { ok: false, error: 'expected host:port (plain http, no path or credentials)' };
    const port = Number(m[2]);
    if (port < 1 || port > 65535) return { ok: false, error: 'port must be 1-65535' };
    const host = m[1];
    return { ok: true, host, port, base: 'http://' + host + ':' + port, label: host + ':' + port };
  }

  /** Comma/space separated list. Invalid entries are reported, valid ones kept; duplicates dropped. */
  function parseNodeList(text) {
    const nodes = [];
    const errors = [];
    const seen = new Set();
    for (const raw of String(text == null ? '' : text).split(/[\s,]+/).filter(Boolean)) {
      const r = parseNodeAddress(raw);
      if (!r.ok) { errors.push({ input: raw, error: r.error }); continue; }
      if (seen.has(r.label)) continue;
      seen.add(r.label);
      if (nodes.length >= MAX_NODES) { errors.push({ input: raw, error: 'at most ' + MAX_NODES + ' nodes' }); continue; }
      nodes.push(r);
    }
    return { nodes, errors };
  }

  // ── validation of API payloads ──────────────────────────────────────────────────────────────────────────────────────

  const isU = (v) => Number.isSafeInteger(v) && v >= 0;
  const isStr = (v) => typeof v === 'string';
  const bad = (reason) => ({ ok: false, reason });
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** /api/status. Note: `local_peer_id` is deliberately dropped; the Explorer never needs it. */
  function validateStatus(x) {
    if (!isObj(x)) return bad('status is not an object');
    if (!isStr(x.chain_id) || !x.chain_id) return bad('chain_id missing');
    if (!isU(x.height)) return bad('height missing or not a whole number');
    if (!isU(x.peer_count)) return bad('peer_count missing');
    if (typeof x.is_running !== 'boolean') return bad('is_running missing');
    if (!isStr(x.environment)) return bad('environment missing');
    if (!isStr(x.engine_version)) return bad('engine_version missing');
    if (x.state_root != null && !isStr(x.state_root)) return bad('state_root malformed');
    return { ok: true, value: {
      chainId: x.chain_id, environment: x.environment, height: x.height, peerCount: x.peer_count,
      stateRoot: x.state_root == null ? null : x.state_root, engineVersion: x.engine_version, isRunning: x.is_running,
    } };
  }

  function validateBlock(b) {
    if (!isObj(b)) return bad('block is not an object');
    if (!isU(b.height)) return bad('block height malformed');
    if (!isStr(b.block_hash) || !b.block_hash) return bad('block_hash missing');
    if (!isU(b.round)) return bad('round malformed');
    if (!isStr(b.state_root)) return bad('state_root malformed');
    if (!isU(b.timestamp_ms)) return bad('timestamp_ms malformed');
    if (!isU(b.tx_count)) return bad('tx_count malformed');
    if (!Array.isArray(b.tx_ids) || !b.tx_ids.every(isStr)) return bad('tx_ids malformed');
    if (!isStr(b.proposer)) return bad('proposer malformed');
    if (!Array.isArray(b.last_commit_signers) || !b.last_commit_signers.every(isStr)) return bad('last_commit_signers malformed');
    return { ok: true, value: {
      height: b.height, hash: b.block_hash, round: b.round, stateRoot: b.state_root, timestampMs: b.timestamp_ms,
      txCount: b.tx_count, txIds: b.tx_ids.slice(0, 200), proposer: b.proposer, commitSigners: b.last_commit_signers.slice(),
    } };
  }

  /** /api/blocks: an array of block summaries. One malformed entry makes the whole payload unsupported. */
  function validateBlocks(arr) {
    if (!Array.isArray(arr)) return bad('blocks is not an array');
    const out = [];
    for (const item of arr) {
      const r = validateBlock(item);
      if (!r.ok) return bad(r.reason);
      out.push(r.value);
    }
    out.sort((a, b) => b.height - a.height);
    return { ok: true, value: out };
  }

  function validateValidators(arr) {
    if (!Array.isArray(arr)) return bad('validators is not an array');
    const out = [];
    for (const v of arr) {
      if (!isObj(v) || !isStr(v.id) || !isU(v.voting_power) || typeof v.pop_verified !== 'boolean') return bad('validator entry malformed');
      out.push({ id: v.id, votingPower: v.voting_power, popVerified: v.pop_verified });
    }
    return { ok: true, value: out };
  }

  function validateValidatorStatus(arr) {
    if (!Array.isArray(arr)) return bad('validator status is not an array');
    const out = [];
    for (const v of arr) {
      if (!isObj(v) || !isStr(v.id) || !isStr(v.status) || !isU(v.bonded_uqcb) || !isU(v.jail_count) ||
          !isU(v.liveness_observed) || !isU(v.liveness_missed_pct)) return bad('validator status entry malformed');
      out.push({ id: v.id, status: v.status, bondedUqcb: v.bonded_uqcb, jailCount: v.jail_count, missedPct: v.liveness_missed_pct, observed: v.liveness_observed });
    }
    return { ok: true, value: out };
  }

  /** /api/peers: only counts are kept. Peer ids and multiaddrs are never stored or shown. */
  function validatePeers(arr) {
    if (!Array.isArray(arr)) return bad('peers is not an array');
    let connected = 0;
    for (const p of arr) {
      if (!isObj(p) || typeof p.connected !== 'boolean') return bad('peer entry malformed');
      if (p.connected) connected += 1;
    }
    return { ok: true, value: { total: arr.length, connected } };
  }

  // ── staleness tracking and node state ───────────────────────────────────────────────────────────────────────────────

  function newTracker() { return { pollCount: 0, nodes: {} }; }

  /** Remember when each node's height last changed, so a node that answers but stopped producing is "stale". */
  function track(tracker, label, reachable, height, now) {
    const t = tracker.nodes[label] || (tracker.nodes[label] = { lastOkAt: null, lastHeight: null, lastChangeAt: null });
    if (reachable) {
      if (t.lastHeight === null || height !== t.lastHeight) t.lastChangeAt = now;
      t.lastOkAt = now;
      t.lastHeight = height;
    }
    return t;
  }

  /**
   * loading     no response yet
   * offline     no HTTP answer (connection refused, timeout, network error)
   * unsupported it answered, but not with a recognisable /api/status
   * stopped     it says is_running = false
   * stale       it answers but its height has not changed for staleAfterMs
   * online      answering and advancing
   */
  function nodeState(entry, t, now, staleAfterMs) {
    if (entry.pending) return 'loading';
    if (!entry.reachable) return 'offline';
    if (entry.unsupported) return 'unsupported';
    if (entry.status && entry.status.isRunning === false) return 'stopped';
    if (t && t.lastChangeAt !== null && now - t.lastChangeAt > staleAfterMs) return 'stale';
    return 'online';
  }

  // ── agreement across nodes ──────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Compare block hashes at the highest height that every reachable node reports. Equal hashes at one height are real
   * evidence the nodes finalised the same block; different hashes are a divergence.
   */
  function agreement(nodes) {
    const withBlocks = nodes.filter((n) => n.blocks && n.blocks.length);
    if (withBlocks.length < 2) return { kind: 'insufficient', reason: 'needs at least two nodes reporting blocks' };
    const maps = withBlocks.map((n) => ({ label: n.label, byHeight: new Map(n.blocks.map((b) => [b.height, b])) }));
    let common = null;
    for (const m of maps) {
      const hs = new Set(m.byHeight.keys());
      common = common === null ? hs : new Set([...common].filter((h) => hs.has(h)));
    }
    if (!common || common.size === 0) return { kind: 'insufficient', reason: 'no block height is reported by every node yet' };
    const height = Math.max(...common);
    const hashes = {};
    const roots = {};
    for (const m of maps) { const b = m.byHeight.get(height); hashes[m.label] = b.hash; roots[m.label] = b.stateRoot; }
    const same = (o) => new Set(Object.values(o)).size === 1;
    if (same(hashes) && same(roots)) return { kind: 'agree', height, nodes: maps.length };
    return { kind: 'diverge', height, nodes: maps.length, hashes };
  }

  // ── view model ──────────────────────────────────────────────────────────────────────────────────────────────────────

  const DASH = '—';
  const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : DASH);
  const short = (s, n = 10) => (typeof s === 'string' && s.length > n * 2 + 1 ? s.slice(0, n) + '…' + s.slice(-6) : (s || DASH));

  function fmtAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return DASH;
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's ago';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ago';
  }

  /** Mean gap between consecutive block timestamps (needs real, increasing timestamps). */
  function observedBlockInterval(blocks) {
    const ts = blocks.map((b) => b.timestampMs).filter((t) => t > 0);
    if (ts.length < 2) return null;
    const gaps = [];
    for (let i = 0; i < Math.min(ts.length - 1, 10); i++) { const g = ts[i] - ts[i + 1]; if (g >= 0) gaps.push(g); }
    return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  }

  const UNSUPPORTED_PANELS = [
    { panel: 'Transactions', reason: 'The node API has no transaction list; only per-block transaction counts and ids are shown.' },
    { panel: 'Analytics (finality, TPS)', reason: 'The node API does not report finality time or throughput.' },
    { panel: 'Post-Quantum Security', reason: 'The node API does not report signing profile or algorithm, so none is claimed.' },
    { panel: 'Identity (DIS)', reason: 'Identity records are not read by this Explorer (private by design).' },
    { panel: 'Computation (PoCD)', reason: 'Not provided by the node API.' },
    { panel: 'Economics', reason: 'Not provided by the node API.' },
  ];

  /**
   * snapshot: { at, nodes: [ { label, pending?, reachable, unsupported?, error?, status?, blocks?, validators?,
   *             validatorStatus?, peers?, endpoints? } ], tracker }
   * Returns plain strings/arrays only; the renderer uses textContent for all of it.
   */
  function buildView(snapshot, opts) {
    const o = Object.assign({ staleAfterMs: STALE_AFTER_MS }, opts || {});
    const now = snapshot.at;
    const rows = snapshot.nodes.map((n) => {
      const t = snapshot.tracker && snapshot.tracker.nodes[n.label];
      const state = nodeState(n, t, now, o.staleAfterMs);
      return Object.assign({}, n, { state, t });
    });

    const live = rows.filter((r) => r.reachable && r.status && !r.unsupported);
    const answering = live.filter((r) => r.state === 'online' || r.state === 'stale' || r.state === 'stopped');
    const online = rows.filter((r) => r.state === 'online');
    const pending = rows.length > 0 && rows.every((r) => r.state === 'loading');
    const primary = answering.slice().sort((a, b) => b.status.height - a.status.height)[0] || null;

    let banner;
    if (rows.length === 0) banner = { kind: 'offline', text: 'No nodes configured' };
    else if (pending) banner = { kind: 'loading', text: 'Connecting to nodes…' };
    else if (!answering.length) banner = { kind: 'offline', text: 'Node offline' };
    else if (online.length === 0) banner = { kind: 'stale', text: 'Nodes answer but no new blocks are arriving (stale)' };
    else if (online.length < rows.length) banner = { kind: 'partial', text: online.length + ' of ' + rows.length + ' nodes online' };
    else banner = { kind: 'ok', text: rows.length + ' of ' + rows.length + ' nodes online' };

    const chainIds = [...new Set(answering.map((r) => r.status.chainId))];
    const envs = [...new Set(answering.map((r) => r.status.environment))];
    const versions = [...new Set(answering.map((r) => r.status.engineVersion))];
    const chain = {
      chainId: chainIds.length === 1 ? chainIds[0] : (chainIds.length ? 'MISMATCH: ' + chainIds.join(' / ') : DASH),
      environment: envs.length === 1 ? envs[0] : (envs.length ? 'mixed: ' + envs.join(' / ') : DASH),
      engineVersion: versions.length === 1 ? versions[0] : (versions.length ? 'mixed: ' + versions.join(' / ') : DASH),
      mismatch: chainIds.length > 1,
    };

    const best = primary ? primary.status.height : null;
    const nodeRows = rows.map((r) => ({
      label: r.label, state: r.state,
      height: r.status && r.reachable ? fmtInt(r.status.height) : DASH,
      behind: r.status && r.reachable && best !== null ? Math.max(0, best - r.status.height) : null,
      peers: r.status && r.reachable ? String(r.status.peerCount) : DASH,
      chainId: r.status && r.reachable ? r.status.chainId : DASH,
      environment: r.status && r.reachable ? r.status.environment : DASH,
      version: r.status && r.reachable ? r.status.engineVersion : DASH,
      note: r.state === 'offline' ? (r.t && r.t.lastHeight !== null ? 'last height ' + fmtInt(r.t.lastHeight) + ' seen ' + fmtAge(now - r.t.lastOkAt) + ' (not live)' : 'no answer')
        : r.state === 'unsupported' ? (r.error || 'unrecognised /api/status')
        : r.state === 'stale' ? 'height unchanged for ' + fmtAge(now - r.t.lastChangeAt).replace(' ago', '')
        : r.state === 'stopped' ? 'node reports is_running = false' : '',
    }));

    const blocks = primary && primary.blocks ? primary.blocks : [];
    const latest = blocks[0] || null;
    const interval = observedBlockInterval(blocks);
    const validators = primary && primary.validators ? primary.validators : null;
    const vstatus = primary && primary.validatorStatus ? primary.validatorStatus : null;
    const totalPower = validators ? validators.reduce((a, v) => a + v.votingPower, 0) : null;
    const agree = agreement(answering);

    const metrics = [
      { key: 'height', label: 'Chain Height', value: primary ? fmtInt(best) : DASH, sub: primary ? 'from ' + primary.label : 'no node answering', state: primary ? 'live' : 'offline' },
      { key: 'latest', label: 'Latest Block', value: latest ? '#' + fmtInt(latest.height) : DASH,
        sub: latest ? (latest.timestampMs > 0 ? fmtAge(now - latest.timestampMs) : 'timestamp not reported') : (primary ? 'block list unavailable' : DASH), state: latest ? 'live' : 'unsupported' },
      { key: 'interval', label: 'Observed Block Interval', value: interval === null ? DASH : (interval / 1000).toFixed(2) + ' s',
        sub: interval === null ? 'needs timestamped blocks' : 'mean of the last ' + Math.min(blocks.length - 1, 10) + ' gaps', state: interval === null ? 'unsupported' : 'live' },
      { key: 'validators', label: 'Validators in Set', value: validators ? String(validators.length) : DASH,
        sub: validators ? 'total voting power ' + fmtInt(totalPower) : (primary ? 'not reported' : DASH), state: validators ? 'live' : (primary ? 'unsupported' : 'offline') },
      { key: 'nodes', label: 'Nodes Online', value: rows.length ? online.length + ' / ' + rows.length : DASH, sub: 'reachable and advancing', state: online.length === rows.length && rows.length ? 'live' : (online.length ? 'partial' : 'offline') },
      { key: 'peers', label: 'Peers (primary node)', value: primary ? String(primary.status.peerCount) : DASH, sub: 'as reported by the node', state: primary ? 'live' : 'offline' },
    ];

    const consensus = {
      engine: { reported: false, text: 'Not reported by the node API' },
      engineNote: 'The node API exposes no consensus-engine field, so the Explorer does not name one.',
      proposer: latest ? latest.proposer : DASH,
      round: latest ? String(latest.round) : DASH,
      commitSigners: latest ? latest.commitSigners.length + (validators ? ' of ' + validators.length : '') : DASH,
      validatorCount: validators ? String(validators.length) : DASH,
      totalPower: totalPower === null ? DASH : fmtInt(totalPower),
      agreement: agree.kind === 'agree' ? { kind: 'agree', text: agree.nodes + ' nodes report the same block hash and state root at height ' + fmtInt(agree.height) }
        : agree.kind === 'diverge' ? { kind: 'diverge', text: 'DIVERGENCE at height ' + fmtInt(agree.height) + ': nodes report different blocks', hashes: agree.hashes }
        : { kind: 'insufficient', text: 'Agreement not yet checked: ' + agree.reason },
    };

    const blockRows = blocks.slice(0, 10).map((b) => ({
      height: b.height, heightText: '#' + fmtInt(b.height), hash: short(b.hash), proposer: b.proposer, round: String(b.round),
      txCount: String(b.txCount), age: b.timestampMs > 0 ? fmtAge(now - b.timestampMs) : DASH, stateRoot: short(b.stateRoot),
    }));

    const validatorRows = validators ? validators.map((v) => {
      const s = vstatus ? vstatus.find((x) => x.id === v.id) : null;
      return {
        id: v.id, power: fmtInt(v.votingPower), popVerified: v.popVerified ? 'yes' : 'no',
        status: s ? s.status : (vstatus ? 'not in status list' : 'status not reported'),
        bonded: s ? fmtInt(s.bondedUqcb) + ' uqcb' : DASH, missed: s ? s.missedPct + '%' : DASH,
      };
    }) : [];

    return {
      banner, chain, metrics, nodes: nodeRows, consensus, blocks: blockRows, validators: validatorRows,
      validatorsSupported: !!validators, blocksSupported: !!(primary && primary.blocks),
      unsupported: UNSUPPORTED_PANELS, generatedAt: now, primaryLabel: primary ? primary.label : null,
      anyLive: !!primary,
    };
  }

  return {
    DEFAULT_NODES, POLL_MS, STALE_AFTER_MS, REQUEST_TIMEOUT_MS, SLOW_EVERY, MAX_NODES, isAllowedPath,
    parseNodeAddress, parseNodeList, validateStatus, validateBlock, validateBlocks, validateValidators,
    validateValidatorStatus, validatePeers, newTracker, track, nodeState, agreement, buildView, fmtAge, fmtInt, short,
    observedBlockInterval, UNSUPPORTED_PANELS,
  };
});
