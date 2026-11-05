'use strict';
/*
 * Qattice Explorer — live dashboard renderer and controller.
 *
 * Rendering takes the document as a parameter (so it is testable without a browser) and uses textContent only: no innerHTML,
 * no eval. Nothing on the page is a sample value: it is either a number the node API returned, a dash, or an explicit
 * "not provided by the node API" message.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./poller.js'));
  else root.QatticeApp = factory(root.QatticeLive, root.QatticeLivePoller);
})(typeof self !== 'undefined' ? self : this, function (M, P) {
  function el(doc, tag, text, cls) {
    const n = doc.createElement(tag);
    if (text != null) n.textContent = String(text);
    if (cls) n.className = cls;
    return n;
  }

  function table(doc, headers, rows) {
    const t = el(doc, 'table', null, 'grid');
    const head = el(doc, 'tr');
    headers.forEach((h) => head.append(el(doc, 'th', h)));
    t.append(head);
    rows.forEach((cells) => {
      const tr = el(doc, 'tr');
      cells.forEach((c) => {
        if (c && typeof c === 'object' && c.node) tr.append(c.node);
        else tr.append(el(doc, 'td', c));
      });
      t.append(tr);
    });
    return t;
  }

  function kv(doc, pairs) {
    const dl = el(doc, 'dl');
    pairs.forEach(([k, v]) => { dl.append(el(doc, 'dt', k)); dl.append(el(doc, 'dd', v)); });
    return dl;
  }

  function put(doc, id, ...children) {
    const target = doc.getElementById(id);
    if (!target) return null;
    target.replaceChildren(...children);
    return target;
  }

  /** Render a view model (model.buildView) into the page. `ui.onOpenBlock(height)` is called when a block is chosen. */
  function render(doc, view, ui) {
    ui = ui || {};
    const banner = doc.getElementById('banner');
    if (banner) {
      banner.textContent = view.banner.text;
      banner.className = 'banner ' + view.banner.kind;
      banner.setAttribute('data-state', view.banner.kind);
    }

    put(doc, 'metrics', ...view.metrics.map((m) => {
      const card = el(doc, 'div', null, 'metric ' + m.state);
      card.setAttribute('data-metric', m.key);
      card.append(el(doc, 'div', m.label, 'label'), el(doc, 'div', m.value, 'value'), el(doc, 'div', m.sub, 'sub'));
      return card;
    }));

    put(doc, 'nodes', table(doc, ['Node', 'State', 'Height', 'Behind', 'Peers', 'Chain', 'Environment', 'Version', 'Note'],
      view.nodes.map((n) => [n.label, { node: el(doc, 'td', n.state, 'state ' + n.state) }, n.height, n.behind === null ? '—' : String(n.behind), n.peers, n.chainId, n.environment, n.version, n.note])));

    const c = view.consensus;
    put(doc, 'consensus',
      kv(doc, [
        ['Consensus engine', c.engine.text], ['Latest block proposer', c.proposer], ['Latest block round', c.round],
        ['Commit evidence in latest block', c.commitSigners], ['Validators in set', c.validatorCount], ['Total voting power', c.totalPower],
      ]),
      el(doc, 'p', c.engineNote, 'note'),
      el(doc, 'p', c.agreement.text, 'agreement ' + c.agreement.kind));

    const blocksTarget = doc.getElementById('blocks');
    if (blocksTarget) {
      if (!view.anyLive) blocksTarget.replaceChildren(el(doc, 'p', 'No node is answering, so no blocks can be shown.', 'empty'));
      else if (!view.blocksSupported) blocksTarget.replaceChildren(el(doc, 'p', 'The node did not return a usable /api/blocks list.', 'empty'));
      else if (!view.blocks.length) blocksTarget.replaceChildren(el(doc, 'p', 'The node has not produced a block yet.', 'empty'));
      else {
        blocksTarget.replaceChildren(table(doc, ['Block', 'Hash', 'Proposer', 'Round', 'Txs', 'Age'], view.blocks.map((b) => {
          const td = el(doc, 'td');
          const btn = el(doc, 'button', b.heightText, 'link');
          btn.setAttribute('data-height', String(b.height));
          if (btn.addEventListener) btn.addEventListener('click', () => ui.onOpenBlock && ui.onOpenBlock(b.height));
          td.append(btn);
          return [{ node: td }, b.hash, b.proposer, b.round, b.txCount, b.age];
        })));
      }
    }

    const vt = doc.getElementById('validators');
    if (vt) {
      if (!view.anyLive) vt.replaceChildren(el(doc, 'p', 'No node is answering.', 'empty'));
      else if (!view.validatorsSupported) vt.replaceChildren(el(doc, 'p', 'The node did not return a usable /api/validators list.', 'empty'));
      else vt.replaceChildren(table(doc, ['Validator', 'Voting power', 'PoP verified', 'Status', 'Bonded', 'Missed'], view.validators.map((v) => [v.id, v.power, v.popVerified, v.status, v.bonded, v.missed])));
    }

    put(doc, 'chain', kv(doc, [
      ['Chain ID', view.chain.chainId], ['Environment', view.chain.environment], ['Engine version', view.chain.engineVersion],
      ['Primary node', view.primaryLabel || '—'],
    ]));

    put(doc, 'unsupported', ...view.unsupported.map((u) => {
      const card = el(doc, 'div', null, 'unsupported-card');
      card.append(el(doc, 'strong', u.panel), el(doc, 'span', 'Not provided by the node API'), el(doc, 'small', u.reason));
      return card;
    }));

    const upd = doc.getElementById('updated');
    if (upd) upd.textContent = view.anyLive ? 'Updated ' + new Date(view.generatedAt).toISOString().slice(11, 19) + ' UTC from the node API' : 'Not live';
  }

  function renderBlockDetail(doc, state) {
    const body = doc.getElementById('detail-body');
    if (!body) return;
    if (state.status !== 'ok') {
      body.replaceChildren(el(doc, 'p', 'This block could not be read from the node (' + state.reason + ').', 'empty'));
      return;
    }
    const b = state.value;
    body.replaceChildren(kv(doc, [
      ['Height', M.fmtInt(b.height)], ['Block hash', b.hash], ['Round', String(b.round)], ['State root', b.stateRoot],
      ['Timestamp', b.timestampMs > 0 ? new Date(b.timestampMs).toISOString() : 'not reported'], ['Proposer', b.proposer],
      ['Transactions', String(b.txCount)], ['Transaction ids', b.txIds.length ? b.txIds.join(', ') : 'none'],
      ['Commit evidence signers (previous block)', b.commitSigners.length ? b.commitSigners.join(', ') : 'none'],
    ]));
  }

  // ── configuration ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** Node list priority: ?nodes=… > saved setting > documented development defaults. Invalid entries are reported. */
  function readConfig(search, stored) {
    const params = new URLSearchParams(search || '');
    const wanted = params.get('nodes') || stored || M.DEFAULT_NODES.join(',');
    const parsed = M.parseNodeList(wanted);
    const nodes = parsed.nodes.length ? parsed.nodes : M.parseNodeList(M.DEFAULT_NODES.join(',')).nodes;
    const iv = Number(params.get('interval'));
    const intervalMs = Number.isFinite(iv) && iv >= 1 && iv <= 60 ? Math.round(iv * 1000) : M.POLL_MS;
    return { nodes, errors: parsed.errors, intervalMs, source: params.get('nodes') ? 'url' : (stored ? 'saved' : 'default') };
  }

  // ── browser bootstrap ─────────────────────────────────────────────────────────────────────────────────────────────

  function start(win) {
    const doc = win.document;
    const KEY = 'qattice.nodes';
    let stored = null;
    try { stored = win.localStorage.getItem(KEY); } catch (e) { /* storage blocked: use defaults */ }
    let cfg = readConfig(win.location.search, stored);
    const fetchJson = P.makeFetchJson(win.fetch.bind(win), M.REQUEST_TIMEOUT_MS);
    let tracker = M.newTracker();
    let last = null;
    let timer = null;
    let inFlight = false;

    function showConfigErrors() {
      const n = doc.getElementById('config-errors');
      if (n) n.textContent = cfg.errors.length ? 'Ignored: ' + cfg.errors.map((e) => e.input + ' (' + e.error + ')').join('; ') : '';
    }

    function openBlock(height) {
      const dlg = doc.getElementById('detail');
      const title = doc.getElementById('detail-title');
      if (title) title.textContent = 'Block #' + M.fmtInt(height);
      const body = doc.getElementById('detail-body');
      if (body) body.replaceChildren(el(doc, 'p', 'Reading the block from the node…'));
      if (dlg && dlg.showModal && !dlg.open) dlg.showModal();
      const node = cfg.nodes.find((n) => n.label === (last && last.primary)) || cfg.nodes[0];
      P.fetchBlock(fetchJson, node, height).then((r) => renderBlockDetail(doc, r.state === 'ok' ? { status: 'ok', value: r.value } : { status: 'bad', reason: r.reason }));
    }

    async function tick() {
      if (inFlight) return;
      inFlight = true;
      try {
        const snap = await P.pollOnce({ nodes: cfg.nodes, fetchJson, tracker, now: Date.now });
        const view = M.buildView(snap);
        last = { primary: view.primaryLabel };
        render(doc, view, { onOpenBlock: openBlock });
      } finally { inFlight = false; }
    }

    function begin() {
      if (timer) win.clearInterval(timer);
      tracker = M.newTracker();
      render(doc, M.buildView({ at: Date.now(), tracker, nodes: cfg.nodes.map((n) => ({ label: n.label, pending: true, reachable: false })) }), { onOpenBlock: openBlock });
      showConfigErrors();
      tick();
      timer = win.setInterval(tick, cfg.intervalMs);
    }

    const form = doc.getElementById('settings-form');
    const input = doc.getElementById('nodes-input');
    if (input) input.value = cfg.nodes.map((n) => n.label).join(', ');
    if (form) form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const parsed = M.parseNodeList(input.value);
      if (!parsed.nodes.length) { cfg.errors = parsed.errors.length ? parsed.errors : [{ input: '', error: 'enter at least one node as host:port' }]; showConfigErrors(); return; }
      cfg = Object.assign({}, cfg, { nodes: parsed.nodes, errors: parsed.errors });
      try { win.localStorage.setItem(KEY, parsed.nodes.map((n) => n.label).join(',')); } catch (e) { /* not persisted */ }
      const dlg = doc.getElementById('settings');
      if (dlg && dlg.close) dlg.close();
      begin();
    });
    const cancel = doc.getElementById('close-settings');
    if (cancel) cancel.addEventListener('click', () => { const d = doc.getElementById('settings'); if (d && d.close) d.close(); });
    const open = doc.getElementById('open-settings');
    if (open) open.addEventListener('click', () => { const d = doc.getElementById('settings'); if (d && d.showModal) d.showModal(); });

    begin();
    return { tick, config: () => cfg };
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('app')) start(window);

  return { render, renderBlockDetail, readConfig, start, el };
});
