'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../live/model.js');
const { LIVE, makeBlock } = require('./helpers.js');

// ── node addresses ───────────────────────────────────────────────────────────────────────────────────────────────────

test('node addresses: valid forms are accepted and normalised', () => {
  for (const [input, label] of [['127.0.0.1:19080', '127.0.0.1:19080'], ['http://localhost:5500', 'localhost:5500'], ['node-1.local:80/', 'node-1.local:80'], ['[::1]:19080', '[::1]:19080']]) {
    const r = M.parseNodeAddress(input);
    assert.equal(r.ok, true, input);
    assert.equal(r.label, label);
    assert.equal(r.base, 'http://' + label);
  }
});

test('node addresses: credentials, paths, queries, other schemes and bad ports are refused', () => {
  for (const bad of ['', 'host', 'host:0', 'host:65536', 'host:80/path', 'host:80?x=1', 'https://host:443', 'file:///etc/passwd', 'javascript:alert(1)',
    'http://user:pw@host:80', '127.0.0.1:19080/api/tx', 'a b:80', 'host:80#frag', '//host:80', 'ho st:1', 'host:-1', 'host:1e3', null, undefined, '<script>:80']) {
    assert.equal(M.parseNodeAddress(bad).ok, false, String(bad));
  }
});

test('node lists: duplicates dropped, invalid entries reported, and the documented defaults are ports 19080-19083', () => {
  const r = M.parseNodeList('127.0.0.1:19080, 127.0.0.1:19080 bad http://x:1, 127.0.0.1:19081');
  assert.deepEqual(r.nodes.map((n) => n.label), ['127.0.0.1:19080', 'x:1', '127.0.0.1:19081']);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].input, 'bad');
  assert.deepEqual(M.parseNodeList(M.DEFAULT_NODES.join(',')).nodes.map((n) => n.port), [19080, 19081, 19082, 19083]);
  const many = M.parseNodeList(Array.from({ length: 40 }, (_, i) => 'h' + i + ':80').join(','));
  assert.equal(many.nodes.length, M.MAX_NODES);
});

test('the request allowlist covers exactly the read-only endpoints and nothing else', () => {
  for (const p of ['/api/status', '/api/blocks', '/api/blocks/12', '/api/validators', '/api/validators/status', '/api/peers']) assert.equal(M.isAllowedPath(p), true, p);
  for (const p of ['/api/tx', '/api/tx/abc', '/api/identity/qcb1x', '/api/accounts/x', '/api/auth/challenge', '/api/dis/x', '/api/build', '/api/jobs/1', '/api/blocks/../tx', '/api/blocks/1/x',
    '/api/blocks/abc', '/api/peers/capacity', '/api/gc-receipt', '/api/status/x', '/api/blocks?x=1', '', '/', '/api/blocks/1234567890123456']) assert.equal(M.isAllowedPath(p), false, p);
});

// ── payload validation, against payloads captured from real nodes ────────────────────────────────────────────────────

test('real /api/status validates and drops the peer id', () => {
  const r = M.validateStatus(LIVE.status());
  assert.equal(r.ok, true);
  assert.equal(r.value.chainId, 'qcb-devnet-4node-mldsa');
  assert.equal(JSON.stringify(r.value).includes('12D3Koo'), false, 'the libp2p peer id is not kept');
});

test('real /api/blocks validates, is newest-first, and carries real hashes', () => {
  const r = M.validateBlocks(LIVE.blocks());
  assert.equal(r.ok, true);
  assert.ok(r.value.length >= 2);
  for (let i = 1; i < r.value.length; i++) assert.ok(r.value[i - 1].height > r.value[i].height);
  assert.match(r.value[0].hash, /^[0-9a-f]{64}$/);
  assert.ok(r.value[0].timestampMs > 1.7e12, 'real timestamps');
});

test('real /api/validators is reduced to id, power and PoP flag: the consensus public key is never kept', () => {
  const raw = LIVE.validators();
  assert.ok(raw[0].consensus_pubkey.length > 1000, 'the node really returns a large public key');
  const r = M.validateValidators(raw);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value[0]).sort(), ['id', 'popVerified', 'votingPower']);
  assert.equal(JSON.stringify(r.value).includes(raw[0].consensus_pubkey.slice(0, 40)), false);
});

test('real validator status and peers validate; peers keep counts only', () => {
  assert.equal(M.validateValidatorStatus(LIVE.validatorStatus()).ok, true);
  const p = M.validatePeers(LIVE.peers());
  assert.equal(p.ok, true);
  assert.deepEqual(Object.keys(p.value).sort(), ['connected', 'total']);
  const raw = LIVE.peers()[0];
  assert.equal(JSON.stringify(p).includes(raw.peer_id) || JSON.stringify(p).includes(raw.addr), false, 'no peer id or address is kept');
});

test('malformed payloads are rejected rather than displayed', () => {
  const s = LIVE.status();
  const badStatuses = [null, [], 'x', {}, Object.assign({}, s, { height: -1 }), Object.assign({}, s, { height: 1.5 }), Object.assign({}, s, { height: '5' }),
    Object.assign({}, s, { height: NaN }), Object.assign({}, s, { height: 2 ** 60 }), Object.assign({}, s, { chain_id: '' }), Object.assign({}, s, { is_running: 'yes' }),
    Object.assign({}, s, { peer_count: null }), Object.assign({}, s, { environment: 5 })];
  for (const b of badStatuses) assert.equal(M.validateStatus(b).ok, false, JSON.stringify(b));
  const blk = makeBlock(3);
  for (const [k, v] of [['height', 'x'], ['block_hash', ''], ['round', -1], ['tx_ids', 'no'], ['tx_ids', [1]], ['proposer', null], ['last_commit_signers', {}], ['timestamp_ms', -5], ['state_root', 7]]) {
    assert.equal(M.validateBlock(Object.assign({}, blk, { [k]: v })).ok, false, k);
  }
  assert.equal(M.validateBlocks([makeBlock(1), { junk: true }]).ok, false, 'one bad entry makes the list unsupported');
  assert.equal(M.validateBlocks({}).ok, false);
  assert.equal(M.validateValidators([{ id: 'a', voting_power: '1', pop_verified: true }]).ok, false);
  assert.equal(M.validateValidators({}).ok, false);
  assert.equal(M.validateValidatorStatus([{ id: 'a' }]).ok, false);
  assert.equal(M.validatePeers([{ connected: 'yes' }]).ok, false);
  assert.equal(M.validatePeers('x').ok, false);
});

// ── states ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('node states: loading, offline, unsupported, stopped, stale, online', () => {
  const T0 = 1_000_000;
  const status = M.validateStatus(LIVE.status()).value;
  const tracker = M.newTracker();
  M.track(tracker, 'a', true, 5, T0);
  assert.equal(M.nodeState({ pending: true }, undefined, T0, 30000), 'loading');
  assert.equal(M.nodeState({ reachable: false }, undefined, T0, 30000), 'offline');
  assert.equal(M.nodeState({ reachable: true, unsupported: true }, undefined, T0, 30000), 'unsupported');
  assert.equal(M.nodeState({ reachable: true, status: Object.assign({}, status, { isRunning: false }) }, tracker.nodes.a, T0, 30000), 'stopped');
  assert.equal(M.nodeState({ reachable: true, status }, tracker.nodes.a, T0 + 29_000, 30000), 'online');
  assert.equal(M.nodeState({ reachable: true, status }, tracker.nodes.a, T0 + 31_000, 30000), 'stale', 'height unchanged for longer than the stale window');
  M.track(tracker, 'a', true, 6, T0 + 31_000);
  assert.equal(M.nodeState({ reachable: true, status }, tracker.nodes.a, T0 + 32_000, 30000), 'online', 'a new height clears staleness');
  M.track(tracker, 'a', false, null, T0 + 40_000);
  assert.equal(tracker.nodes.a.lastHeight, 6, 'an unreachable poll does not erase what was last seen');
});

// ── agreement across nodes ───────────────────────────────────────────────────────────────────────────────────────────

const blocksUpTo = (h, o) => M.validateBlocks(Array.from({ length: h + 1 }, (_, i) => makeBlock(h - i, o))).value;

test('agreement: equal hashes at the highest common height agree', () => {
  const r = M.agreement([{ label: 'a', blocks: blocksUpTo(9) }, { label: 'b', blocks: blocksUpTo(7) }, { label: 'c', blocks: blocksUpTo(9) }]);
  assert.deepEqual([r.kind, r.height, r.nodes], ['agree', 7, 3]);
});

test('agreement: different hashes at the same height are a divergence', () => {
  const r = M.agreement([{ label: 'a', blocks: blocksUpTo(6) }, { label: 'b', blocks: blocksUpTo(6, { fork: 'x' }) }]);
  assert.equal(r.kind, 'diverge');
  assert.equal(r.height, 6);
  assert.notEqual(r.hashes.a, r.hashes.b);
});

test('agreement: one node, or no overlap, is reported as not checked rather than assumed good', () => {
  assert.equal(M.agreement([{ label: 'a', blocks: blocksUpTo(3) }]).kind, 'insufficient');
  assert.equal(M.agreement([]).kind, 'insufficient');
  assert.equal(M.agreement([{ label: 'a', blocks: blocksUpTo(3).filter((b) => b.height > 2) }, { label: 'b', blocks: blocksUpTo(3).filter((b) => b.height < 2) }]).kind, 'insufficient');
});

// ── the view model: what is shown, and what is never shown ───────────────────────────────────────────────────────────

function entry(label, o = {}) {
  const status = M.validateStatus(Object.assign(LIVE.status(), o.status || {})).value;
  return Object.assign({ label, reachable: true, status, blocks: o.blocks || blocksUpTo(status.height), validators: M.validateValidators(LIVE.validators()).value,
    validatorStatus: M.validateValidatorStatus(LIVE.validatorStatus()).value, peers: { total: 3, connected: 3 } }, o.extra || {});
}
function snapshot(nodes, at, tracker) {
  const t = tracker || M.newTracker();
  nodes.forEach((n) => M.track(t, n.label, n.reachable && !!n.status, n.status ? n.status.height : null, at));
  return { at, nodes, tracker: t };
}
const NOW = 1793915500000;

test('view: no node answering says exactly "Node offline" and shows no invented numbers', () => {
  const v = M.buildView(snapshot([{ label: 'a:1', reachable: false }, { label: 'b:2', reachable: false }], NOW));
  assert.equal(v.banner.text, 'Node offline');
  assert.equal(v.banner.kind, 'offline');
  assert.equal(v.anyLive, false);
  for (const m of v.metrics) if (m.key !== 'nodes') assert.equal(m.value, '—', m.key);
  assert.equal(v.blocks.length, 0);
  assert.equal(v.validators.length, 0);
  const text = JSON.stringify(v);
  for (const sample of ['1,284,337', '1284337', '2.31', '4,728', '3,862,417', '911,482', 'qattice-1', '12.6 PFLOPS', 'V-0427']) assert.equal(text.includes(sample), false, sample);
});

test('view: loading before the first answer, not offline', () => {
  const v = M.buildView(snapshot([{ label: 'a:1', pending: true, reachable: false }], NOW));
  assert.equal(v.banner.kind, 'loading');
  assert.equal(v.banner.text, 'Connecting to nodes…');
});

test('view: live values come from the node, including the height and the newest block', () => {
  const v = M.buildView(snapshot([entry('a:1', { status: { height: 9 } }), entry('b:2', { status: { height: 9 } })], NOW));
  assert.equal(v.banner.kind, 'ok');
  assert.equal(v.metrics.find((m) => m.key === 'height').value, '9');
  assert.equal(v.metrics.find((m) => m.key === 'latest').value, '#9');
  assert.equal(v.blocks[0].height, 9);
  assert.equal(v.consensus.proposer, 'qcb1bob');
  assert.equal(v.consensus.validatorCount, '4');
  assert.equal(v.consensus.agreement.kind, 'agree');
  assert.equal(v.chain.chainId, 'qcb-devnet-4node-mldsa');
  assert.equal(v.validators.length, 4);
  assert.equal(v.validators[0].status, 'Active');
});

test('view: partial availability is reported with the node count', () => {
  const v = M.buildView(snapshot([entry('a:1'), { label: 'b:2', reachable: false }, entry('c:3')], NOW));
  assert.equal(v.banner.kind, 'partial');
  assert.equal(v.banner.text, '2 of 3 nodes online');
  assert.equal(v.nodes.find((n) => n.label === 'b:2').state, 'offline');
});

test('view: nodes that answer but stop advancing are stale, not healthy', () => {
  const t = M.newTracker();
  const a = entry('a:1');
  M.track(t, 'a:1', true, a.status.height, NOW - 60_000);
  const v = M.buildView({ at: NOW, nodes: [a], tracker: t });
  assert.equal(v.banner.kind, 'stale');
  assert.equal(v.nodes[0].state, 'stale');
});

test('view: a node that was seen and then went away shows its last height as not live', () => {
  const t = M.newTracker();
  M.track(t, 'a:1', true, 9, NOW - 20_000);
  M.track(t, 'a:1', false, null, NOW);
  const v = M.buildView({ at: NOW, nodes: [{ label: 'a:1', reachable: false }], tracker: t });
  assert.equal(v.banner.text, 'Node offline');
  assert.match(v.nodes[0].note, /last height 9 seen 20s ago \(not live\)/);
  assert.equal(v.nodes[0].height, '—');
  assert.equal(v.metrics.find((m) => m.key === 'height').value, '—');
});

test('view: nodes on different chains are flagged', () => {
  const v = M.buildView(snapshot([entry('a:1'), entry('b:2', { status: { chain_id: 'other-chain' } })], NOW));
  assert.equal(v.chain.mismatch, true);
  assert.match(v.chain.chainId, /^MISMATCH: /);
});

test('view: divergence between nodes is shown', () => {
  const v = M.buildView(snapshot([entry('a:1'), entry('b:2', { blocks: blocksUpTo(9, { fork: 'f' }) })], NOW));
  assert.equal(v.consensus.agreement.kind, 'diverge');
  assert.match(v.consensus.agreement.text, /^DIVERGENCE at height 9/);
});

test('view: an endpoint the node cannot serve is "not reported", not filled in', () => {
  const v = M.buildView(snapshot([entry('a:1', { extra: { validators: null, validatorStatus: null, blocks: null } })], NOW));
  assert.equal(v.validatorsSupported, false);
  assert.equal(v.blocksSupported, false);
  assert.equal(v.metrics.find((m) => m.key === 'validators').value, '—');
  assert.equal(v.metrics.find((m) => m.key === 'latest').value, '—');
});

test('view: the consensus engine is never named, whatever the data', () => {
  const scenarios = [
    snapshot([entry('a:1'), entry('b:2')], NOW),
    snapshot([{ label: 'a:1', reachable: false }], NOW),
    snapshot([{ label: 'a:1', pending: true, reachable: false }], NOW),
    snapshot([entry('a:1'), entry('b:2', { blocks: blocksUpTo(9, { fork: 'f' }) })], NOW),
    snapshot([entry('a:1', { extra: { validators: null } })], NOW),
  ];
  for (const s of scenarios) {
    const v = M.buildView(s);
    assert.equal(/hotstuff|tendermint|pbft|bft/i.test(JSON.stringify(v)), false, 'no engine is named in the view');
    assert.equal(v.consensus.engine.reported, false);
    assert.match(v.consensus.engine.text, /Not reported/);
  }
});

test('view: unsupported panels are always listed, including post-quantum security, with reasons', () => {
  const v = M.buildView(snapshot([entry('a:1')], NOW));
  const names = v.unsupported.map((u) => u.panel);
  for (const want of ['Transactions', 'Post-Quantum Security', 'Identity (DIS)', 'Economics', 'Computation (PoCD)']) assert.ok(names.includes(want), want);
  v.unsupported.forEach((u) => assert.ok(u.reason.length > 10));
});

test('observed block interval is computed only from real timestamps', () => {
  assert.equal(M.observedBlockInterval(blocksUpTo(9)), 3000);
  assert.equal(M.observedBlockInterval(blocksUpTo(9, { baseTs: 0 }).map((b) => Object.assign({}, b, { timestampMs: 0 }))), null);
  assert.equal(M.observedBlockInterval([]), null);
});

test('age formatting', () => {
  assert.equal(M.fmtAge(4000), '4s ago');
  assert.equal(M.fmtAge(125000), '2m 5s ago');
  assert.equal(M.fmtAge(3 * 3600000 + 5 * 60000), '3h 5m ago');
  assert.equal(M.fmtAge(-1), '—');
});

// ── a chain that has not produced a block must not read as healthy (found on the first Windows run) ────────────────────

test('view: nodes that answer at height 0 with no blocks are "waiting for the first block", not healthy', () => {
  const idle = (label) => {
    const e = entry(label, { status: { height: 0 }, blocks: [] });
    e.validators = []; e.validatorStatus = [];
    return e;
  };
  const v = M.buildView(snapshot([idle('a:1'), idle('b:2'), idle('c:3'), idle('d:4')], NOW));
  assert.equal(v.banner.kind, 'waiting');
  assert.match(v.banner.text, /have not produced a block yet \(height 0\)/);
  assert.doesNotMatch(v.banner.text, /nodes online/, 'it must not claim "N of N nodes online"');
  assert.equal(v.metrics.find((m) => m.key === 'latest').value, '—');
  assert.equal(v.blocks.length, 0);
});

test('view: once any node has a block the normal states apply again', () => {
  const idle = entry('a:1', { status: { height: 0 }, blocks: [] });
  const live = entry('b:2', { status: { height: 3 } });
  const v = M.buildView(snapshot([idle, live], NOW));
  assert.notEqual(v.banner.kind, 'waiting');
});

test('view: an empty validator list is reported as empty, not as an error', () => {
  const e = entry('a:1', { status: { height: 0 }, blocks: [] });
  e.validators = [];
  const v = M.buildView(snapshot([e], NOW));
  assert.equal(v.validatorsSupported, true);
  assert.equal(v.validators.length, 0);
});

test('view: when no node has any peers the waiting banner says the nodes are not connected to each other', () => {
  const idle = (label, peers) => { const e = entry(label, { status: { height: 0, peer_count: peers }, blocks: [] }); e.validators = []; return e; };
  const alone = M.buildView(snapshot([idle('a:1', 0), idle('b:2', 0)], NOW));
  assert.equal(alone.banner.kind, 'waiting');
  assert.match(alone.banner.text, /no node has any peers/);
  assert.match(alone.banner.text, /not connected to each other/);
  const connected = M.buildView(snapshot([idle('a:1', 3), idle('b:2', 1)], NOW));
  assert.equal(connected.banner.kind, 'waiting');
  assert.doesNotMatch(connected.banner.text, /no node has any peers/, 'connected nodes are not blamed for being unconnected');
});
