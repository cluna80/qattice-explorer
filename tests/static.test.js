'use strict';
/* Static guards on the shipped files: the safety properties the Explorer promises must not be edited away silently. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const LIVE_FILES = ['index.html', 'style.css', 'live/model.js', 'live/poller.js', 'live/app.js'];

test('the live page and its code contain none of the sample values from the reference mockup', () => {
  for (const f of LIVE_FILES) {
    const t = read(f);
    for (const sample of ['1,284,337', '1284337', '4,728', '3,862,417', '911,482', '12.6 PFLOPS', '3,918,552', '70.3%', 'Network Healthy', 'v0.1.0-phase0', '0x8f3e']) {
      assert.equal(t.includes(sample), false, f + ' contains ' + sample);
    }
  }
});

test('the live page does not use the screenshot (it holds sample numbers) and does not name a consensus engine', () => {
  const html = read('index.html');
  assert.equal(/dashboard\.png/.test(html), false);
  for (const f of LIVE_FILES) assert.equal(/hotstuff|tendermint|pbft/i.test(read(f)), false, f);
});

test('no unsafe DOM or code-execution APIs are used', () => {
  for (const f of ['live/model.js', 'live/poller.js', 'live/app.js']) {
    const t = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setTimeout("', "setTimeout('", 'importScripts', 'XMLHttpRequest', 'WebSocket', 'sendBeacon']) {
      assert.equal(t.includes(forbidden), false, f + ' uses ' + forbidden);
    }
  }
});

test('no code path can send anything but GET', () => {
  for (const f of ['live/poller.js', 'live/app.js', 'live/model.js']) {
    const t = read(f);
    assert.equal(/method:\s*['"](POST|PUT|DELETE|PATCH)/i.test(t), false, f);
    assert.equal(/\bbody:/.test(t), false, f + ' sets a request body');
    assert.equal(/\/api\/tx\b|\/api\/identity|\/api\/auth|\/api\/dis|\/api\/accounts/.test(t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), false, f + ' references a private or write endpoint');
  }
  assert.match(read('live/poller.js'), /method: 'GET'/);
});

test('the page ships a content-security policy, loads only local scripts, and has no inline styles or handlers', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'no inline scripts');
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'no inline event handlers');
  assert.equal(/\sstyle\s*=/i.test(html), false, 'no inline style attributes');
  for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), m[1]);
  assert.equal(/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+/i.test(html.replace(/http:\/\/127\.0\.0\.1:\d+/g, '')), false, 'no external hosts referenced');
});

test('the reference mockup is kept, clearly labelled as sample data, and linked from the live page', () => {
  const ref = read('reference.html');
  assert.match(ref, /SAMPLE DATA/);
  assert.match(ref, /reference\.js/);
  assert.match(read('index.html'), /href="reference\.html"/);
  assert.ok(fs.existsSync(path.join(root, 'dashboard.png')), 'the recovered dashboard image is kept');
  assert.ok(fs.existsSync(path.join(root, 'reference.js')));
});

test('documented development defaults are the four documented API ports', () => {
  assert.deepEqual(require('../live/model.js').DEFAULT_NODES, ['127.0.0.1:19080', '127.0.0.1:19081', '127.0.0.1:19082', '127.0.0.1:19083']);
});
