#!/usr/bin/env node
'use strict';
/*
 * Optional real-browser check (needs Playwright + Chromium; the Explorer itself has no dependencies).
 *
 *   python3 -m http.server 5500 &                         # serve the Explorer
 *   node scripts/browser-check.js                          # nodes must be running; expects the height to increase
 *   node scripts/browser-check.js --expect-offline         # passes only if the page says "Node offline" and shows no height
 *   node scripts/browser-check.js --url http://localhost:5500/ --screenshot out.png --seconds 20
 *
 * It opens the page in Chromium, so the real cross-origin fetch path (and the node's CORS headers) is exercised.
 */
const { chromium } = require('playwright');

function args(argv) {
  const o = { url: 'http://localhost:5500/index.html', seconds: 20, expectOffline: false, screenshot: null, openBlock: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') o.url = argv[++i];
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--screenshot') o.screenshot = argv[++i];
    else if (a === '--expect-offline') o.expectOffline = true;
    else { console.error('unknown argument ' + a); process.exit(2); }
  }
  return o;
}

(async () => {
  const o = args(process.argv.slice(2));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (/\/api\//.test(r.url())) requests.push(r.method() + ' ' + new URL(r.url()).pathname); });
  await page.goto(o.url);
  const failures = [];
  const metric = async (key) => (await page.locator('[data-metric="' + key + '"] .value').first().textContent()).trim();
  const banner = async () => ({ text: (await page.locator('#banner').textContent()).trim(), state: await page.locator('#banner').getAttribute('data-state') });

  if (o.expectOffline) {
    await page.waitForFunction(() => document.getElementById('banner').getAttribute('data-state') === 'offline', null, { timeout: o.seconds * 1000 }).catch(() => {});
    const b = await banner();
    console.log('banner: ' + JSON.stringify(b) + '  height metric: ' + (await metric('height')));
    if (b.text !== 'Node offline') failures.push('expected "Node offline", got ' + JSON.stringify(b));
    if ((await metric('height')) !== '—') failures.push('a height is shown although no node answers');
    const body = await page.locator('body').textContent();
    for (const sample of ['1,284,337', '4,728', '256 ', 'PQ-HotStuff']) if (body.includes(sample)) failures.push('sample text on the page: ' + sample);
  } else {
    await page.waitForFunction(() => ['ok', 'partial'].includes(document.getElementById('banner').getAttribute('data-state')), null, { timeout: o.seconds * 1000 }).catch(() => {});
    const h0 = await metric('height');
    const b0 = await banner();
    console.log('first reading: banner ' + JSON.stringify(b0) + ', height ' + h0);
    if (!/^\d[\d,]*$/.test(h0)) failures.push('no live height shown (' + h0 + ')');
    const toNum = (s) => Number(s.replace(/,/g, ''));
    const deadline = Date.now() + o.seconds * 1000;
    let h1 = h0;
    while (Date.now() < deadline && toNum(h1) <= toNum(h0)) { await page.waitForTimeout(500); h1 = await metric('height'); }
    console.log('later reading: height ' + h1);
    if (!(toNum(h1) > toNum(h0))) failures.push('the displayed height did not increase (' + h0 + ' -> ' + h1 + ')');
    const newest = (await page.locator('#blocks button.link').first().textContent()).trim();
    console.log('newest block in the stream: ' + newest);
    if (toNum(newest.replace('#', '')) < toNum(h1) - 2) failures.push('the block stream is behind the height');
    // open a block: its detail comes from the node's /api/blocks/{height}
    await page.locator('#blocks button.link').first().click();
    await page.waitForFunction(() => /Block hash/.test(document.getElementById('detail-body').textContent), null, { timeout: 8000 }).catch(() => {});
    const detail = await page.locator('#detail-body').textContent();
    console.log('block detail: ' + detail.slice(0, 160).replace(/\s+/g, ' ') + '…');
    if (!/Block hash/.test(detail)) failures.push('the block detail did not load from the node');
    await page.keyboard.press('Escape');
    const agreeText = await page.locator('#consensus .agreement').textContent();
    console.log('agreement: ' + agreeText);
    const consensus = await page.locator('#consensus').textContent();
    if (/hotstuff|tendermint/i.test(consensus)) failures.push('a consensus engine is named on the page');
    if (!/Not reported by the node API/.test(consensus)) failures.push('the engine line is missing');
  }

  if (o.screenshot) { await page.screenshot({ path: o.screenshot, fullPage: true }); console.log('screenshot: ' + o.screenshot); }
  const bad = requests.filter((r) => !r.startsWith('GET '));
  if (bad.length) failures.push('non-GET requests: ' + bad.join(', '));
  const paths = [...new Set(requests.map((r) => r.split(' ')[1].replace(/\/\d+$/, '/{n}')))].sort();
  console.log('API paths requested: ' + paths.join(', '));
  if (errors.length) failures.push(...errors);
  await browser.close();
  if (failures.length) { console.error('FAIL\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('PASS');
})().catch((e) => { console.error('error: ' + (e && e.stack || e)); process.exit(1); });
