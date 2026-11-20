// Both browser drivers read a page with the same probe: the cloakbrowser path (page.evaluate) and the
// chrome path (a bundle run in the page, its envelope read back) must give the same result.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PINNED_BINARY } from '../scripts/cloak-core.mjs';
import { buildBundle, probeScript, readEnvelope } from '../scripts/lib/page-script.mjs';
import { SEL_ARG, SEARCH_PROBE, VIEW_PROBE, interpretSearch, interpretView, loggedOutFrom, loggedOutMarkers } from '../scripts/linkedin-jobs.mjs';
import { DICE_SEL, DICE_SEARCH_PROBE, DICE_VIEW_PROBE, interpretDiceSearch, finishDiceSearch, diceViewVerdict, interpretDiceView } from '../scripts/dice-jobs.mjs';

async function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try { const { binaryInfo } = await import('cloakbrowser'); const b = binaryInfo(PINNED_BINARY); return b.installed ? b.binaryPath : null; } catch { return null; }
}
const CHROME = await chromiumPath();
const skip = !(CHROME && existsSync(CHROME)) && 'no Chromium (set CHROME_PATH or run npm run setup)';
const fx = (f) => pathToFileURL(fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url))).href;
const FAST = { settleMs: 0, markerWaitMs: 0 };
let browser;
before(async () => { if (skip) return; const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, headless: true }); });
after(async () => { await browser?.close(); });

// The two ways to read one fixture with one probe.
async function both(file, probe, sel) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await page.goto(fx(file));
    const viaEvaluate = await page.evaluate(probeScript(probe.main, sel, probe.helpers));
    await page.evaluate(buildBundle({ id: 'rq-p1', nonce: 'np1', main: probe.main, arg: sel, helpers: probe.helpers }));
    await page.evaluate('window.__jobba.run()');
    const env = readEnvelope(await page.evaluate(() => document.getElementById('jobba-out').textContent), { id: 'rq-p1', nonce: 'np1' });
    assert.equal(env.status, 'ok', env.error);
    return { viaEvaluate, viaBundle: env.payload };
  } finally { await page.close(); }
}
const noTime = (r) => { const { fetched_at: _f, ...rest } = r; return rest; };

test('LinkedIn search: the same cards and status through both drivers', { skip }, async () => {
  const { viaEvaluate, viaBundle } = await both('synthetic-search.html', SEARCH_PROBE, { ...SEL_ARG, ...FAST });
  const a = interpretSearch(viaEvaluate);
  assert.deepEqual(interpretSearch(viaBundle), a);
  assert.ok(a.cards.length >= 2, JSON.stringify(a).slice(0, 300));
});

test('LinkedIn view: title, company, apply type and description through both drivers', { skip }, async () => {
  const { viaEvaluate, viaBundle } = await both('synthetic-li-view.html', VIEW_PROBE, { ...SEL_ARG, ...FAST });
  const a = interpretView(viaEvaluate, '9000000123');
  assert.deepEqual(noTime(interpretView(viaBundle, '9000000123')), noTime(a));
  assert.equal(a.status, 'ok');
  assert.equal(a.title, 'Staff Platform Engineer');
  assert.equal(a.company, 'Acme Corp');
  assert.equal(a.apply.type, 'easy');
});

test('LinkedIn sign-in markers: the fixture reads signed in', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.goto(fx('synthetic-li-view.html'));
    assert.equal(loggedOutFrom(await page.evaluate(probeScript(loggedOutMarkers))), false);
    assert.equal(loggedOutFrom({ url: 'https://www.linkedin.com/checkpoint/challenge', nav: 1, login: 0 }), true);
    assert.equal(loggedOutFrom({ url: 'https://www.linkedin.com/jobs/', nav: 0, login: 2 }), true);
  } finally { await page.close(); }
});

test('Dice search and view: the same result through both drivers', { skip }, async () => {
  const s = await both('synthetic-dice-search.html', DICE_SEARCH_PROBE, { ...DICE_SEL, ...FAST });
  const sa = finishDiceSearch(interpretDiceSearch(s.viaEvaluate), false);
  assert.deepEqual(finishDiceSearch(interpretDiceSearch(s.viaBundle), false), sa);
  assert.ok(sa.cards.length >= 1 || sa.status !== 'ok', JSON.stringify(sa).slice(0, 300));
  const v = await both('synthetic-dice-view.html', DICE_VIEW_PROBE, { ...DICE_SEL, ...FAST });
  const va = interpretDiceView(v.viaEvaluate, 'dice-x', diceViewVerdict(v.viaEvaluate).verdict);
  assert.deepEqual(noTime(interpretDiceView(v.viaBundle, 'dice-x', diceViewVerdict(v.viaBundle).verdict)), noTime(va));
});
