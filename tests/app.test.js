'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../live/model.js');
const A = require('../live/app.js');
const { LIVE, makeBlock, FakeDoc, PAGE_IDS } = require('./helpers.js');

const NOW = 1793915500000;
const blocksUpTo = (h) => M.validateBlocks(Array.from({ length: h + 1 }, (_, i) => makeBlock(h - i))).value;
function liveEntry(label, over = {}) {
  const status = M.validateStatus(Object.assign(LIVE.status(), over)).value;
  return { label, reachable: true, status, blocks: blocksUpTo(status.height), validators: M.validateValidators(LIVE.validators()).value,
    validatorStatus: M.validateValidatorStatus(LIVE.validatorStatus()).value, peers: { total: 3, connected: 3 } };
}
function view(nodes, tracker) {
  const t = tracker || M.newTracker();
  nodes.forEach((n) => M.track(t, n.label, n.reachable && !!n.status, n.status ? n.status.height : null, NOW));
  return M.buildView({ at: NOW, nodes, tracker: t });
}
const pageText = (doc) => PAGE_IDS.map((id) => doc.getElementById(id).textContent).join('\n');

test('offline page: "Node offline" is the banner, and nothing sample-valued is on the page', () => {
  const doc = new FakeDoc(PAGE_IDS);
  A.render(doc, view([{ label: '127.0.0.1:19080', reachable: false }]));
  const banner = doc.getElementById('banner');
  assert.equal(banner.textContent, 'Node offline');
  assert.equal(banner.getAttribute('data-state'), 'offline');
  const text = pageText(doc);
  for (const sample of ['1,284,337', '2.31', '4,728', '256', '3,862,417', '911,482', 'qattice-1', 'V-0427', '12.6 PFLOPS', 'Network Healthy']) assert.equal(text.includes(sample), false, sample);
  assert.match(doc.getElementById('blocks').textContent, /No node is answering/);
  assert.equal(doc.getElementById('updated').textContent, 'Not live');
});

test('live page: height, nodes, blocks, validators and the unsupported list are rendered from the data', () => {
  const doc = new FakeDoc(PAGE_IDS);
  let opened = null;
  A.render(doc, view([liveEntry('127.0.0.1:19080'), liveEntry('127.0.0.1:19081')]), { onOpenBlock: (h) => { opened = h; } });
  assert.equal(doc.getElementById('banner').textContent, '2 of 2 nodes online');
  const height = doc.getElementById('metrics').findAll((n) => n.getAttribute && n.getAttribute('data-metric') === 'height')[0];
  assert.match(height.textContent, /Chain Height9/);
  assert.match(doc.getElementById('nodes').textContent, /127\.0\.0\.1:19081online/);
  assert.match(doc.getElementById('consensus').textContent, /Consensus engineNot reported by the node API/);
  assert.match(doc.getElementById('consensus').textContent, /2 nodes report the same block hash and state root at height 9/);
  assert.match(doc.getElementById('validators').textContent, /qcb1alice/);
  assert.match(doc.getElementById('unsupported').textContent, /Post-Quantum SecurityNot provided by the node API/);
  assert.match(doc.getElementById('chain').textContent, /Chain IDqcb-devnet-4node-mldsa/);
  const buttons = doc.getElementById('blocks').findAll((n) => n.tagName === 'button');
  assert.ok(buttons.length >= 5);
  assert.equal(buttons[0].getAttribute('data-height'), '9', 'the newest block is first');
  buttons[0].click();
  assert.equal(opened, 9, 'choosing a block asks the controller to read it from the node');
});

test('the page never names a consensus engine', () => {
  const doc = new FakeDoc(PAGE_IDS);
  A.render(doc, view([liveEntry('a:1'), liveEntry('b:2')]));
  assert.equal(/hotstuff|tendermint|pbft/i.test(pageText(doc)), false);
});

test('hostile strings from a node are rendered as text, never as markup', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const doc = new FakeDoc(PAGE_IDS);
  const e = liveEntry('a:1', { chain_id: evil });
  e.blocks = e.blocks.map((b, i) => (i === 0 ? Object.assign({}, b, { proposer: evil }) : b));
  e.validators = [{ id: evil, votingPower: 1, popVerified: true }];
  A.render(doc, view([e]));
  const tags = new Set();
  for (const id of PAGE_IDS) doc.getElementById(id).findAll((n) => { tags.add(n.tagName); return false; });
  for (const forbidden of ['img', 'script', 'iframe', 'a', 'style']) assert.equal(tags.has(forbidden), false, forbidden);
  assert.ok(pageText(doc).includes(evil), 'the string is shown literally, as inert text');
});

test('a divergence is rendered with its own class so it cannot be missed', () => {
  const doc = new FakeDoc(PAGE_IDS);
  const a = liveEntry('a:1');
  const b = liveEntry('b:2');
  b.blocks = M.validateBlocks(Array.from({ length: 10 }, (_, i) => makeBlock(9 - i, { fork: 'x' }))).value;
  A.render(doc, view([a, b]));
  const ag = doc.getElementById('consensus').findAll((n) => /agreement/.test(n.className))[0];
  assert.match(ag.className, /diverge/);
  assert.match(ag.textContent, /^DIVERGENCE/);
});

test('block detail: shows the node\'s fields, or says the block could not be read', () => {
  const doc = new FakeDoc(PAGE_IDS);
  const b = M.validateBlock(makeBlock(6)).value;
  A.renderBlockDetail(doc, { status: 'ok', value: b });
  const t = doc.getElementById('detail-body').textContent;
  assert.ok(t.includes(b.hash) && t.includes(b.stateRoot) && t.includes(b.proposer));
  A.renderBlockDetail(doc, { status: 'bad', reason: 'HTTP 404' });
  assert.match(doc.getElementById('detail-body').textContent, /could not be read from the node \(HTTP 404\)/);
});

test('configuration: URL beats saved beats defaults; invalid entries are reported; interval is clamped', () => {
  const d = A.readConfig('', null);
  assert.deepEqual(d.nodes.map((n) => n.label), M.DEFAULT_NODES);
  assert.equal(d.source, 'default');
  const s = A.readConfig('', '10.0.0.5:19080');
  assert.deepEqual(s.nodes.map((n) => n.label), ['10.0.0.5:19080']);
  const u = A.readConfig('?nodes=127.0.0.1:20001,evil/path:1', '10.0.0.5:19080');
  assert.deepEqual(u.nodes.map((n) => n.label), ['127.0.0.1:20001']);
  assert.equal(u.errors.length, 1);
  assert.equal(u.source, 'url');
  const allBad = A.readConfig('?nodes=nope', null);
  assert.deepEqual(allBad.nodes.map((n) => n.label), M.DEFAULT_NODES, 'falls back to the documented defaults, and says what was ignored');
  assert.equal(allBad.errors.length, 1);
  assert.equal(A.readConfig('?interval=5', null).intervalMs, 5000);
  for (const bad of ['0', '0.2', '61', 'abc', '-3']) assert.equal(A.readConfig('?interval=' + bad, null).intervalMs, M.POLL_MS, bad);
});
