// The chrome driver's page scripts: a bundle the agent uploads and runs, and the result envelope it
// copies back from get_page_text, checked by the hash the page computed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildBundle, dashHash, envelopeText, readEnvelope, LOADER_JS } from '../scripts/lib/page-script.mjs';

// What the page does, reproduced in Node: the envelope the bundle writes for a payload.
function pageEnvelope({ id, nonce, href, payload, status = 'ok' }) {
  const hash = dashHash(JSON.stringify(payload));
  return envelopeText({ v: 1, id, nonce, href, at: new Date().toISOString(), status, error: null, sha256: hash, payload });
}

test('dashHash is SHA-256 hex in 8-character groups, the form the tools let through', () => {
  const plain = createHash('sha256').update('abc').digest('hex');
  assert.equal(dashHash('abc'), plain.match(/.{8}/g).join('-'));
  assert.equal(dashHash('abc'), 'ba7816bf-8f01cfea-414140de-5dae2223-b00361a3-96177a9c-b410ff61-f20015ad');
});

test('the envelope text is ASCII with no run of spaces, and reads back to the same payload', () => {
  const payload = { title: 'Staff Engineer — Platform', description: 'Line one\nLine  two with   spaces • bullet', n: 3.25 };
  const text = pageEnvelope({ id: 'rq-1', nonce: 'n1', href: 'https://www.linkedin.com/jobs/view/1/', payload });
  assert.match(text, /^JOBBA-ENVELOPE \{.*\} JOBBA-END$/s);
  assert.doesNotMatch(text, /[^\x20-\x7e]/, 'ASCII only');
  assert.doesNotMatch(text, / {2}/, 'no run of spaces');
  const env = readEnvelope(`some page text before\n${text}\nand after`, { id: 'rq-1', nonce: 'n1', host: 'linkedin.com' });
  assert.deepEqual(env.payload, payload);
});

test('readEnvelope refuses a changed character, a wrong id or nonce, another host, and a missing envelope', () => {
  const payload = { description: 'A synthetic description of a role at Acme Corp.' };
  const text = pageEnvelope({ id: 'rq-2', nonce: 'n2', href: 'https://www.linkedin.com/jobs/view/2/', payload });
  const ok = { id: 'rq-2', nonce: 'n2', host: 'linkedin.com' };
  assert.throws(() => readEnvelope(text.replace('Acme', 'Acne'), ok), /hash/);
  assert.throws(() => readEnvelope(text, { ...ok, id: 'rq-3' }), /id/);
  assert.throws(() => readEnvelope(text, { ...ok, nonce: 'other' }), /nonce/);
  assert.throws(() => readEnvelope(text, { ...ok, host: 'dice.com' }), /host/);
  assert.throws(() => readEnvelope('no envelope here', ok), /no JOBBA-ENVELOPE/);
  assert.throws(() => readEnvelope(text.slice(0, -40), ok), /no JOBBA-ENVELOPE|JSON/);
});

test('a page error comes back as status error with its message, never as data', () => {
  const text = envelopeText({ v: 1, id: 'rq-4', nonce: 'n4', href: 'https://www.dice.com/x', at: new Date().toISOString(), status: 'error', error: 'boom', sha256: dashHash('null'), payload: null });
  const env = readEnvelope(text, { id: 'rq-4', nonce: 'n4', host: 'dice.com' });
  assert.equal(env.status, 'error');
  assert.equal(env.error, 'boom');
});

test('buildBundle defines window.__jobba with the helpers and main inlined, and parses as a script', () => {
  function helperOne(x) { return x + 1; }
  async function mainFn(arg) { return { got: helperOne(arg.n) }; }
  const src = buildBundle({ id: 'rq-5', nonce: 'n5', main: mainFn, arg: { n: 41 }, helpers: [helperOne] });
  assert.match(src, /window\.__jobba = /);
  assert.match(src, /function helperOne/);
  assert.match(src, /"rq-5"/);
  assert.doesNotThrow(() => new Function(src));
  assert.doesNotThrow(() => new Function(LOADER_JS));
  assert.match(LOADER_JS, /jobba-loader/);
});

// In a real Chromium: the page's hash and escaping must match Node's, with a real collector inside.
test('a bundle runs a real collector in Chromium and its envelope reads back in Node', async (t) => {
  const { existsSync } = await import('node:fs');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const { PINNED_BINARY } = await import('../scripts/cloak-core.mjs');
  const { collectCards, SEL_ARG } = await import('../scripts/linkedin-jobs.mjs');
  let exe = process.env.CHROME_PATH || null;
  if (!exe) { try { const { binaryInfo } = await import('cloakbrowser'); const b = binaryInfo(PINNED_BINARY); exe = b.installed ? b.binaryPath : null; } catch { exe = null; } }
  if (!exe || !existsSync(exe)) { t.skip('no Chromium (set CHROME_PATH or run npm run setup)'); return; }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, (r) => r.abort());
    await page.goto(pathToFileURL(fileURLToPath(new URL('./fixtures/synthetic-search.html', import.meta.url))).href);
    async function searchProbe(sel) { const snap = collectCards(sel); return { cards: snap.cards, count: snap.countText, note: 'Résumé — “quotes” and  two spaces' }; }
    const src = buildBundle({ id: 'rq-b1', nonce: 'nb1', main: searchProbe, arg: SEL_ARG, helpers: [collectCards] });
    assert.equal(await page.evaluate(src), 'loaded rq-b1');
    assert.match(await page.evaluate('window.__jobba.run()'), /^JOBBA ok rq-b1: \d+ characters/);
    const text = await page.evaluate(() => document.getElementById('jobba-out').textContent);
    const env = readEnvelope(text, { id: 'rq-b1', nonce: 'nb1' });
    assert.equal(env.status, 'ok');
    assert.ok(env.payload.cards.length >= 2, JSON.stringify(env.payload).slice(0, 200));
    assert.equal(env.payload.note, 'Résumé — “quotes” and  two spaces');
    await page.evaluate('window.__jobba.clear()');
    assert.equal(await page.evaluate(() => document.getElementById('jobba-out')), null);
  } finally { await browser.close(); }
});
