'use strict';
/* Test helpers: fixtures captured from real nodes, a mock node over real HTTP, and a minimal fake DOM. */
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const LIVE = {
  status: () => fixture('live_status.json'),
  blocks: () => fixture('live_blocks.json'),
  validators: () => fixture('live_validators.json'),
  validatorStatus: () => fixture('live_validators_status.json'),
  peers: () => fixture('live_peers.json'),
  block2: () => fixture('live_block_2.json'),
};

/** Deterministic block for a height, shaped exactly like the node's BlockSummary. */
function makeBlock(h, o = {}) {
  const hash = crypto.createHash('sha256').update('block-' + h + (o.fork || '')).digest('hex');
  return {
    height: h, block_hash: hash, round: 0, state_root: crypto.createHash('sha256').update('root-' + h + (o.fork || '')).digest('hex'),
    timestamp_ms: o.baseTs === undefined ? 1793915000000 + h * 3000 : o.baseTs + h * 3000, tx_count: 0, tx_ids: [],
    proposer: ['qcb1alice', 'qcb1bob', 'qcb1carol', 'qcb1dave'][h % 4], last_commit_signers: ['qcb1alice', 'qcb1bob', 'qcb1carol', 'qcb1dave'],
  };
}

/**
 * A mock Qattice node over real HTTP. Behaviour switches: height (advance with setHeight), fork (different block hashes),
 * mode: 'ok' | 'hang' | 'html' (HTML instead of JSON) | 'status404' (no /api/status) | 'badstatus' (JSON without the fields)
 * Records every request (method + path).
 */
async function startMockNode(opts = {}) {
  const state = Object.assign({ height: 5, chainId: 'qcb-devnet-4node-mldsa', mode: 'ok', fork: '', keep: 100, blocksMode: 'ok', detail404: false }, opts);
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    const send = (code, obj, cors = true) => {
      const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
      res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, cors ? { 'access-control-allow-origin': '*' } : {}));
      res.end(body);
    };
    if (state.mode === 'hang') return; // never answers
    if (state.mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>nope</html>'); }
    const u = req.url;
    if (u === '/api/status') {
      if (state.mode === 'status404') return send(404, { error: 'not found' }, false);
      if (state.mode === 'badstatus') return send(200, { hello: 'world' });
      return send(200, Object.assign(LIVE.status(), { chain_id: state.chainId, height: state.height, is_running: state.running !== false, peer_count: state.peers == null ? 3 : state.peers }));
    }
    if (u === '/api/blocks') {
      if (state.blocksMode === 'garbage') return send(200, { not: 'an array' });
      const list = [];
      for (let h = state.height; h >= Math.max(0, state.height - state.keep + 1); h--) {
        if (state.lag && h > state.height - state.lag) continue; // list lags the status
        list.push(makeBlock(h, { fork: state.fork, baseTs: state.baseTs }));
      }
      return send(200, list);
    }
    let m = /^\/api\/blocks\/(\d+)$/.exec(u);
    if (m) {
      const h = Number(m[1]);
      if (state.detail404 || h > state.height) return send(404, { error: 'not found' }, false);
      return send(200, makeBlock(h, { fork: state.fork, baseTs: state.baseTs }));
    }
    if (u === '/api/validators') return send(200, state.noValidators ? { x: 1 } : LIVE.validators());
    if (u === '/api/validators/status') return send(200, LIVE.validatorStatus());
    if (u === '/api/peers') return send(200, LIVE.peers());
    return send(404, { error: 'not found' }, false);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, requests, state, label: '127.0.0.1:' + port, base: 'http://127.0.0.1:' + port,
    node: { label: '127.0.0.1:' + port, base: 'http://127.0.0.1:' + port, host: '127.0.0.1', port },
    setHeight(h) { state.height = h; },
    async close() { server.closeAllConnections(); await new Promise((r) => server.close(r)); },
  };
}

/** A port with nothing listening, to test "node offline" for real (connection refused). */
async function closedPort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return { label: '127.0.0.1:' + port, base: 'http://127.0.0.1:' + port, host: '127.0.0.1', port };
}

// ── a minimal fake DOM (enough for live/app.js render functions) ───────────────────────────────────────────────────────
class FakeNode {
  constructor(tag) { this.tagName = tag; this.children = []; this._text = ''; this.className = ''; this.attrs = {}; this.listeners = {}; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  append(...n) { for (const c of n) this.children.push(typeof c === 'string' ? Object.assign(new FakeNode('#text'), { _text: c }) : c); }
  replaceChildren(...n) { this.children = []; this._text = ''; this.append(...n); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach((f) => f()); }
  findAll(pred, acc = []) { for (const c of this.children) { if (pred(c)) acc.push(c); c.findAll(pred, acc); } return acc; }
}
class FakeDoc {
  constructor(ids) { this.byId = {}; ids.forEach((id) => { this.byId[id] = new FakeNode('div'); }); }
  createElement(tag) { return new FakeNode(tag); }
  getElementById(id) { return this.byId[id] || null; }
}
const PAGE_IDS = ['banner', 'metrics', 'nodes', 'consensus', 'blocks', 'validators', 'chain', 'unsupported', 'updated', 'detail-body'];

module.exports = { fixture, LIVE, makeBlock, startMockNode, closedPort, FakeNode, FakeDoc, PAGE_IDS };
