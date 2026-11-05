'use strict';
/*
 * Qattice Explorer — read-only node poller.
 *
 * Every request is a GET to an allowlisted /api path (model.isAllowedPath). The fetch implementation is injected, so the same code
 * runs in the browser (window.fetch) and in the Node tests (global fetch against a mock node).
 *
 * Browser note: the node sends `Access-Control-Allow-Origin: *` on successful responses but NOT on its 404 reply, so a browser
 * cannot read a 404 from `/api/blocks/{height}`; it surfaces as a network error. A failed block-detail request therefore never
 * means "node offline" by itself: reachability is decided by /api/status alone.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.QatticeLivePoller = factory(root.QatticeLive);
})(typeof self !== 'undefined' ? self : this, function (M) {
  function makeFetchJson(fetchImpl, timeoutMs) {
    return async function fetchJson(url) {
      let path;
      try { path = new URL(url).pathname; } catch (e) { throw Object.assign(new Error('bad url'), { kind: 'refused' }); }
      if (!M.isAllowedPath(path)) throw Object.assign(new Error('path not allowed: ' + path), { kind: 'refused' });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs || M.REQUEST_TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, {
          method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: ctl.signal,
          headers: { accept: 'application/json' },
        });
        try { return { httpStatus: res.status, json: await res.json(), badJson: false }; }
        catch (e) { return { httpStatus: res.status, json: undefined, badJson: true }; }
      } catch (e) {
        throw Object.assign(new Error('network'), { kind: 'network', cause: e });
      } finally {
        clearTimeout(timer);
      }
    };
  }

  /** ok | unsupported (answered, but not usable) | unavailable (no answer at all) */
  async function readEndpoint(fetchJson, base, path, validate) {
    let r;
    try { r = await fetchJson(base + path); }
    catch (e) { return e && e.kind === 'refused' ? { state: 'unsupported', reason: e.message } : { state: 'unavailable', reason: 'no answer' }; }
    if (r.httpStatus !== 200) return { state: 'unsupported', reason: 'HTTP ' + r.httpStatus };
    if (r.badJson) return { state: 'unsupported', reason: 'not JSON' };
    const v = validate(r.json);
    return v.ok ? { state: 'ok', value: v.value } : { state: 'unsupported', reason: v.reason };
  }

  async function pollNode(node, tracker, slow, fetchJson) {
    const entry = { label: node.label, pending: false, reachable: false, endpoints: {} };
    const cache = (tracker.cache = tracker.cache || {});
    const status = await readEndpoint(fetchJson, node.base, '/api/status', M.validateStatus);
    if (status.state === 'unavailable') { entry.error = 'no answer'; return entry; }
    entry.reachable = true;
    if (status.state === 'unsupported') { entry.unsupported = true; entry.error = 'unrecognised /api/status: ' + status.reason; return entry; }
    entry.status = status.value;

    const blocks = await readEndpoint(fetchJson, node.base, '/api/blocks', M.validateBlocks);
    entry.endpoints.blocks = blocks.state;
    if (blocks.state === 'ok') {
      entry.blocks = blocks.value;
      // The list can lag the status by a block; read the newest block directly so a new height is shown from the node itself.
      if (!entry.blocks.length || entry.blocks[0].height < status.value.height) {
        const d = await readEndpoint(fetchJson, node.base, '/api/blocks/' + status.value.height, (j) => M.validateBlock(j));
        entry.endpoints.blockDetail = d.state;
        if (d.state === 'ok' && !entry.blocks.some((b) => b.height === d.value.height)) entry.blocks = [d.value].concat(entry.blocks);
      }
    } else {
      entry.error = 'blocks: ' + blocks.reason;
    }

    const c = (cache[node.label] = cache[node.label] || {});
    if (slow || !('validators' in c)) {
      const [v, vs, p] = await Promise.all([
        readEndpoint(fetchJson, node.base, '/api/validators', M.validateValidators),
        readEndpoint(fetchJson, node.base, '/api/validators/status', M.validateValidatorStatus),
        readEndpoint(fetchJson, node.base, '/api/peers', M.validatePeers),
      ]);
      c.validators = v.state === 'ok' ? v.value : null; c.validatorsState = v.state;
      c.validatorStatus = vs.state === 'ok' ? vs.value : null; c.validatorStatusState = vs.state;
      c.peers = p.state === 'ok' ? p.value : null; c.peersState = p.state;
    }
    entry.validators = c.validators; entry.validatorStatus = c.validatorStatus; entry.peers = c.peers;
    entry.endpoints.validators = c.validatorsState; entry.endpoints.validatorStatus = c.validatorStatusState; entry.endpoints.peers = c.peersState;
    return entry;
  }

  /** One polling round over all nodes. Returns a snapshot for model.buildView. */
  async function pollOnce(opts) {
    const now = opts.now || Date.now;
    const tracker = opts.tracker || M.newTracker();
    const slow = tracker.pollCount % M.SLOW_EVERY === 0;
    tracker.pollCount += 1;
    const entries = await Promise.all(opts.nodes.map((n) => pollNode(n, tracker, slow, opts.fetchJson)));
    const at = now();
    for (const e of entries) M.track(tracker, e.label, e.reachable && !!e.status && !e.unsupported, e.status ? e.status.height : null, at);
    return { at, nodes: entries, tracker };
  }

  /** The newest-first block detail for one height from one node (used when a block is opened). */
  async function fetchBlock(fetchJson, node, height) {
    if (!Number.isSafeInteger(height) || height < 0) return { state: 'unsupported', reason: 'bad height' };
    return readEndpoint(fetchJson, node.base, '/api/blocks/' + height, (j) => M.validateBlock(j));
  }

  return { makeFetchJson, readEndpoint, pollNode, pollOnce, fetchBlock };
});
