#!/usr/bin/env node
'use strict';
/*
 * Live check: drives the Explorer's own poller and model against REAL nodes and verifies the acceptance milestone.
 *
 *   node scripts/live-check.js                                  # nodes 127.0.0.1:19080-19083, 30 s, expects >= 2 new blocks
 *   node scripts/live-check.js --nodes 127.0.0.1:19080 --seconds 20 --min-new-blocks 3
 *   node scripts/live-check.js --expect-offline                 # passes only if NO node answers and the Explorer says "Node offline"
 *
 * Exit 0 = pass, 1 = fail, 2 = usage. Read-only: it uses the same GET-only, allowlisted fetch layer as the page.
 */
const M = require('../live/model.js');
const P = require('../live/poller.js');

function args(argv) {
  const o = { nodes: M.DEFAULT_NODES.join(','), seconds: 30, minNew: 2, expectOffline: false, intervalMs: 1000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--nodes') o.nodes = argv[++i];
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--min-new-blocks') o.minNew = Number(argv[++i]);
    else if (a === '--interval-ms') o.intervalMs = Number(argv[++i]);
    else if (a === '--expect-offline') o.expectOffline = true;
    else { console.error('unknown argument: ' + a); process.exit(2); }
  }
  if (!Number.isFinite(o.seconds) || o.seconds < 1 || !Number.isFinite(o.minNew) || o.minNew < 0) { console.error('bad --seconds / --min-new-blocks'); process.exit(2); }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const parsed = M.parseNodeList(o.nodes);
  if (!parsed.nodes.length) { console.error('no valid nodes: ' + JSON.stringify(parsed.errors)); process.exit(2); }
  const fetchJson = P.makeFetchJson(fetch, M.REQUEST_TIMEOUT_MS);
  const tracker = M.newTracker();
  const first = {};
  let last = null;
  const end = Date.now() + o.seconds * 1000;
  let rounds = 0;
  console.log('Polling ' + parsed.nodes.map((n) => n.label).join(', ') + ' for ' + o.seconds + ' s');
  while (Date.now() < end || rounds === 0) {
    const snap = await P.pollOnce({ nodes: parsed.nodes, fetchJson, tracker, now: Date.now });
    rounds += 1;
    last = { snap, view: M.buildView(snap) };
    for (const n of snap.nodes) if (n.status && first[n.label] === undefined) first[n.label] = n.status.height;
    const hs = snap.nodes.map((n) => (n.status ? n.status.height : '-')).join(' ');
    console.log('  t+' + String(Math.round((Date.now() - (end - o.seconds * 1000)) / 1000)).padStart(2) + 's  heights: ' + hs + '   banner: ' + last.view.banner.text);
    if (o.expectOffline) break;
    await new Promise((r) => setTimeout(r, o.intervalMs));
  }

  const v = last.view;
  const failures = [];
  if (o.expectOffline) {
    if (v.banner.text !== 'Node offline') failures.push('expected the banner "Node offline", got "' + v.banner.text + '"');
    if (v.anyLive) failures.push('a node answered but offline was expected');
  } else {
    const answering = last.snap.nodes.filter((n) => n.status);
    if (!answering.length) failures.push('no node answered');
    const grew = answering.map((n) => ({ label: n.label, from: first[n.label], to: n.status.height }));
    for (const g of grew) if (g.to - g.from < o.minNew) failures.push(g.label + ' advanced only ' + (g.to - g.from) + ' block(s) (' + g.from + ' -> ' + g.to + '), needed ' + o.minNew);
    if (answering.length && answering.every((n) => n.status.height === 0)) {
      failures.push('every node answers but none has produced a block (height 0): the API is up while consensus has not started. Check the node logs and the peer counts above (0 or 1 peers means the nodes did not connect); see docs/LIVE-DEVNET.md, "Height stays at 0".');
    }
    if (answering.length >= 2 && v.consensus.agreement.kind !== 'agree') failures.push('nodes do not agree: ' + v.consensus.agreement.text);
    if (v.blocks[0] && v.blocks[0].height < Math.max(...answering.map((n) => n.status.height)) - 2) failures.push('newest displayed block is far behind the node height');
    console.log('\nPeers per node (as each node reports): ' + answering.map((n) => n.label + '=' + n.status.peerCount).join(', '));
    console.log('Height progression: ' + grew.map((g) => g.label + ' ' + g.from + '->' + g.to).join(', '));
    console.log('Newest block shown: ' + (v.blocks[0] ? v.blocks[0].heightText + ' hash ' + v.blocks[0].hash + ' proposer ' + v.blocks[0].proposer : 'none'));
    console.log('Agreement: ' + v.consensus.agreement.text);
    console.log('Chain: ' + v.chain.chainId + ' / ' + v.chain.environment + ' / ' + v.chain.engineVersion);
    console.log('Validators: ' + v.validators.length + ' (' + v.validators.map((x) => x.id + '=' + x.power).join(', ') + ')');
    console.log('Consensus engine: ' + v.consensus.engine.text);
  }
  if (failures.length) { console.error('\nFAIL\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('\nPASS');
}
main().catch((e) => { console.error('error: ' + (e && e.stack || e)); process.exit(1); });
