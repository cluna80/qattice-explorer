'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../live/model.js');
const P = require('../live/poller.js');
const { startMockNode, closedPort, makeBlock } = require('./helpers.js');

const fj = (ms = 1500) => P.makeFetchJson(fetch, ms); // the real fetch, over real HTTP

async function round(nodes, tracker, now) {
  const snap = await P.pollOnce({ nodes: nodes.map((n) => n.node || n), fetchJson: fj(), tracker, now: () => now });
  return { snap, view: M.buildView(snap) };
}

test('ACCEPTANCE: when the node produces a new block, the Explorer fetches the new height and shows that block', async () => {
  const node = await startMockNode({ height: 5 });
  try {
    const tracker = M.newTracker();
    const T = 1793915100000;
    let { view } = await round([node], tracker, T);
    assert.equal(view.banner.kind, 'ok');
    assert.equal(view.metrics.find((m) => m.key === 'height').value, '5');
    assert.equal(view.blocks[0].height, 5);

    node.setHeight(6); // the chain produces a genuine new block
    ({ view } = await round([node], tracker, T + 3000));
    assert.equal(view.metrics.find((m) => m.key === 'height').value, '6', 'the new height is read from the node');
    assert.equal(view.blocks[0].height, 6, 'and the new block is displayed');
    assert.equal(view.blocks[0].hash, M.short(makeBlock(6).block_hash), 'with the hash the node reported');
    assert.equal(view.blocks[0].proposer, makeBlock(6).proposer);
  } finally { await node.close(); }
});

test('when the block list lags the status, the newest block is read directly from /api/blocks/{height}', async () => {
  const node = await startMockNode({ height: 8, lag: 1 });
  try {
    const { view } = await round([node], M.newTracker(), 1793915100000);
    assert.equal(view.blocks[0].height, 8, 'the lagging list is topped up with the node\'s own block 8');
    assert.ok(node.requests.some((r) => r.path === '/api/blocks/8'));
  } finally { await node.close(); }
});

test('ACCEPTANCE: with no node running (connection refused) the Explorer says "Node offline"', async () => {
  const dead = await closedPort();
  const { view } = await round([dead], M.newTracker(), 1793915100000);
  assert.equal(view.banner.text, 'Node offline');
  assert.equal(view.nodes[0].state, 'offline');
  assert.equal(view.blocks.length, 0);
  assert.equal(view.metrics.find((m) => m.key === 'height').value, '—');
});

test('a node that accepts the connection but never answers is offline after the timeout, not hung', async () => {
  const node = await startMockNode({ mode: 'hang' });
  try {
    const t0 = Date.now();
    const snap = await P.pollOnce({ nodes: [node.node], fetchJson: fj(400), tracker: M.newTracker(), now: () => 1793915100000 });
    assert.ok(Date.now() - t0 < 3000, 'bounded by the timeout');
    assert.equal(snap.nodes[0].reachable, false);
    assert.equal(M.buildView(snap).banner.text, 'Node offline');
  } finally { await node.close(); }
});

test('something answering with HTML or an unrecognised status is "unsupported", never shown as chain data', async () => {
  for (const mode of ['html', 'badstatus', 'status404']) {
    const node = await startMockNode({ mode });
    try {
      const { snap, view } = await round([node], M.newTracker(), 1793915100000);
      assert.equal(snap.nodes[0].reachable, true, 'it answered, so it is reachable, just not usable');
      assert.equal(view.nodes[0].state, 'unsupported', mode);
      assert.equal(view.blocks.length, 0, mode);
      assert.equal(view.metrics.find((m) => m.key === 'height').value, '—', mode);
    } finally { await node.close(); }
  }
});

test('a garbage /api/blocks leaves the node online but marks blocks unsupported', async () => {
  const node = await startMockNode({ blocksMode: 'garbage' });
  try {
    const { view, snap } = await round([node], M.newTracker(), 1793915100000);
    assert.equal(view.nodes[0].state, 'online');
    assert.equal(view.blocksSupported, false);
    assert.equal(snap.nodes[0].endpoints.blocks, 'unsupported');
  } finally { await node.close(); }
});

test('a failing block-detail request (the node\'s CORS-less 404) is not mistaken for the node being offline', async () => {
  const node = await startMockNode({ height: 8, lag: 1, detail404: true });
  try {
    const { view, snap } = await round([node], M.newTracker(), 1793915100000);
    assert.equal(view.nodes[0].state, 'online', 'reachability is decided by /api/status');
    assert.equal(snap.nodes[0].endpoints.blockDetail, 'unsupported');
    assert.equal(view.blocks[0].height, 7, 'only blocks the node actually returned are shown');
  } finally { await node.close(); }
});

test('four nodes with one down: partial, and the three agree on the block', async () => {
  const live = await Promise.all([startMockNode({ height: 6 }), startMockNode({ height: 6 }), startMockNode({ height: 6 })]);
  const dead = await closedPort();
  try {
    const { view } = await round([...live, dead], M.newTracker(), 1793915100000);
    assert.equal(view.banner.text, '3 of 4 nodes online');
    assert.equal(view.consensus.agreement.kind, 'agree');
    assert.equal(view.consensus.agreement.text.startsWith('3 nodes report the same block hash'), true);
  } finally { await Promise.all(live.map((n) => n.close())); }
});

test('nodes that disagree are reported as a divergence', async () => {
  const a = await startMockNode({ height: 6 });
  const b = await startMockNode({ height: 6, fork: 'evil' });
  try {
    const { view } = await round([a, b], M.newTracker(), 1793915100000);
    assert.equal(view.consensus.agreement.kind, 'diverge');
  } finally { await a.close(); await b.close(); }
});

test('a node that answers but stops producing blocks becomes stale after the window', async () => {
  const node = await startMockNode({ height: 6 });
  try {
    const tracker = M.newTracker();
    const T = 1793915100000;
    await round([node], tracker, T);
    let { view } = await round([node], tracker, T + M.STALE_AFTER_MS - 1000);
    assert.equal(view.banner.kind, 'ok');
    ({ view } = await round([node], tracker, T + M.STALE_AFTER_MS + 1000));
    assert.equal(view.banner.kind, 'stale');
    node.setHeight(7);
    ({ view } = await round([node], tracker, T + M.STALE_AFTER_MS + 4000));
    assert.equal(view.banner.kind, 'ok', 'a new block clears the stale state');
  } finally { await node.close(); }
});

test('a node going away mid-run flips to offline and keeps its last height only as "not live"', async () => {
  const node = await startMockNode({ height: 6 });
  const tracker = M.newTracker();
  const T = 1793915100000;
  await round([node], tracker, T);
  await node.close();
  const { view } = await round([{ node: node.node }], tracker, T + 5000);
  assert.equal(view.banner.text, 'Node offline');
  assert.match(view.nodes[0].note, /last height 6 seen 5s ago \(not live\)/);
});

test('READ-ONLY: only GET requests, only allowlisted paths, and the slow endpoints are polled less often', async () => {
  const node = await startMockNode({ height: 6 });
  try {
    const tracker = M.newTracker();
    for (let i = 0; i < M.SLOW_EVERY + 1; i++) await round([node], tracker, 1793915100000 + i * 1000);
    assert.ok(node.requests.length > 0);
    for (const r of node.requests) {
      assert.equal(r.method, 'GET');
      assert.equal(M.isAllowedPath(r.path), true, r.path);
    }
    const count = (p) => node.requests.filter((r) => r.path === p).length;
    assert.equal(count('/api/status'), M.SLOW_EVERY + 1);
    assert.equal(count('/api/blocks'), M.SLOW_EVERY + 1);
    assert.equal(count('/api/validators'), 2, 'polled on the first round and again after SLOW_EVERY rounds');
    assert.equal(count('/api/peers'), 2);
    assert.equal(node.requests.some((r) => /tx|identity|accounts|auth|build|jobs|dis/.test(r.path)), false, 'nothing private or administrative is requested');
  } finally { await node.close(); }
});

test('the fetch layer refuses paths outside the allowlist before any network access', async () => {
  const node = await startMockNode();
  try {
    const f = fj();
    for (const p of ['/api/tx', '/api/identity/qcb1alice', '/api/accounts/x', '/api/auth/challenge', '/api/blocks/1/../../tx']) {
      await assert.rejects(f(node.base + p), (e) => e.kind === 'refused', p);
    }
    assert.equal(node.requests.length, 0, 'no request was sent');
  } finally { await node.close(); }
});

test('requests carry no credentials and do not follow redirects', async () => {
  const seen = [];
  const f = P.makeFetchJson(async (url, init) => { seen.push(init); return { status: 200, json: async () => ({}) }; }, 500);
  await f('http://127.0.0.1:1/api/status');
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].credentials, 'omit');
  assert.equal(seen[0].redirect, 'error');
  assert.equal(seen[0].cache, 'no-store');
  assert.equal(seen[0].body, undefined);
});
