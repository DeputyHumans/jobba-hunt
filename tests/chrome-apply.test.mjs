// The apply runner under the chrome driver: the page-side filler in a real Chromium, then the whole
// run through `npm run browser` with the test as the agent (canned page payloads, no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PINNED_BINARY } from '../scripts/cloak-core.mjs';
import { markRoot, collectForm } from '../scripts/lib/apply-dom.mjs';
import { planFill } from '../scripts/lib/apply-forms.mjs';
import { chromeFill } from '../scripts/lib/chrome-fill.mjs';
import { dashHash, envelopeText, probeScript } from '../scripts/lib/page-script.mjs';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

const bank = JSON.parse(readFileSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace', 'profile', 'answers.json'), 'utf8'));

async function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try { const { binaryInfo } = await import('cloakbrowser'); const b = binaryInfo(PINNED_BINARY); return b.installed ? b.binaryPath : null; } catch { return null; }
}
const CHROME = await chromiumPath();
const skip = !(CHROME && existsSync(CHROME)) && 'no Chromium (set CHROME_PATH or run npm run setup)';

test('chromeFill fills the native controls planFill asks for, and leaves the rest to the agent', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, (r) => r.abort());
    await page.goto(pathToFileURL(fileURLToPath(new URL('./fixtures/synthetic-greenhouse-2026.html', import.meta.url))).href);
    const read = () => page.evaluate(probeScript(async function readForm() { markRoot('page'); return collectForm(); }, null, [markRoot, collectForm]));
    const ctx = { cv: '/tmp/cv.pdf', coverNote: null, coverNoteFile: null, coverPdf: null, jobAnswers: null };
    const before = planFill((await read()).fields, bank, ctx);
    const native = before.actions.filter((a) => ['fill', 'select', 'check', 'uncheck', 'radio'].includes(a.action));
    assert.ok(native.length >= 3, JSON.stringify(before.actions.map((a) => a.action)));
    const res = await page.evaluate(probeScript(async function fillIt(actions) { return chromeFill(actions); }, before.actions, [chromeFill]));
    assert.ok(res.filter((r) => r.ok).length >= 3, JSON.stringify(res));
    for (const r of res) if (!r.ok) assert.ok(r.agent || r.why, JSON.stringify(r));
    const after = planFill((await read()).fields, bank, ctx);
    const left = new Set(after.actions.map((a) => a.key));
    for (const r of res.filter((x) => x.ok)) assert.ok(!left.has(r.key), `${r.key} still planned after the fill`);
  } finally { await browser.close(); }
});

// ---------- the whole run, with canned pages ----------
const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2)); };
function workspace({ verified = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jobba-chrome-apply-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  const data = join(home, 'data');
  writeJson(join(home, 'config', 'browser.json'), { driver: 'chrome' });
  if (verified) writeJson(join(home, 'config', 'apply.json'), { verified_chrome: { easy: true } });
  writeJson(join(data, 'state', 'browser-sessions.json'), { chrome: { linkedin: { logged_in: true, checked_at: '2026-11-20T08:00:00Z' } } });
  const id = '9000000301';
  mkdirSync(join(data, 'applications', id), { recursive: true });
  writeFileSync(join(data, 'applications', id, 'cv.pdf'), '%PDF synthetic');
  const job = { job_id: id, title: 'Staff Platform Engineer', company: 'Acme Corp', status: 'shortlisted', detail: { fetched_at: '2026-11-01T10:00:00Z', description_text: 'A synthetic posting.', apply: { type: 'easy' } },
    triage: { score: 90, tier: 'A', lane: 'leadership', gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, decision: 'pursue' },
    application: { status: 'approved', approved_at: '2026-11-01T10:00:00Z', attempts: [], cv: `$JOBBA_DATA_DIR/applications/${id}/cv.pdf` } };
  writeJson(join(data, 'state', 'jobs.json'), { _schema: 2, query_runs: {}, sources: {}, jobs: { [id]: job } });
  return { home, data, id };
}
const env = (ws) => ({ ...process.env, JOBBA_HOME: ws.home, JOBBA_DATA_DIR: ws.data, JOBBA_LIMITS_LOG: join(ws.data, 'state', 'limits-log.json'), JOBBA_NO_BROWSER: '1', JOBBA_BRIDGE_FAKE_AGENT: '1' });
const run = (ws, ...args) => {
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', 'browser.mjs'), ...args], { encoding: 'utf8', env: env(ws), timeout: 120000 });
  return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop() || '{}'), err: r.stderr };
};
const envelope = (req, payload) => envelopeText({ v: 1, id: req.id, nonce: req.nonce, href: req.url || 'https://www.linkedin.com/jobs/view/9000000301/', at: new Date().toISOString(), status: 'ok', error: null, sha256: dashHash(JSON.stringify(payload)), payload });

const field = (key, label, value = '') => ({ key, kind: 'text', label, required: true, options: [], value });
function agent(ws) {
  let filled = false;
  const seen = [];
  const answer = (req) => {
    const script = req.script && existsSync(req.script) ? readFileSync(req.script, 'utf8') : '';
    seen.push({ kind: req.kind, act: req.act?.action || null, probe: (script.match(/const __main = async function (\w+)/) || [])[1] || null });
    if (req.kind === 'act') {
      if (req.act.action === 'submit') {
        const a = JSON.parse(readFileSync(join(ws.data, 'state', 'jobs.json'), 'utf8')).jobs[ws.id].application;
        seen.at(-1).pendingBeforeSubmit = !!a.submit_pending && existsSync(join(ws.data, 'applications', ws.id)) ;
      }
      return { ack: true };
    }
    const probe = seen.at(-1).probe;
    if (probe === 'linkedinViewProbe') return { url: req.url, loggedOut: false, v: { title: 'Staff Platform Engineer', company: 'Acme Corp', company_url: 'https://www.linkedin.com/company/acme-corp/', top_card_text: 'Staff Platform Engineer\nAcme Corp\nRemote', description_text: 'A synthetic posting at Acme Corp for a staff platform engineer who runs CI/CD and Kubernetes for 200 engineers.', main_text: '', apply_label: 'Easy Apply to Staff Platform Engineer at Acme Corp', apply_href: null } };
    if (probe === 'formProbe') return { fields: [field('f0', 'First name', filled ? 'Jordan' : ''), field('f1', 'Last name', filled ? 'Example' : '')], buttons: ['Submit application'], disabled_buttons: [], hasPassword: false, frames: [], text: '', page_text: '', url: 'https://www.linkedin.com/jobs/view/9000000301/', phenom: false };
    if (probe === 'fillProbe') { filled = true; return [{ key: 'f0', ok: true }, { key: 'f1', ok: true }]; }
    if (probe === 'afterSubmitProbe') return { url: 'https://www.linkedin.com/jobs/view/9000000301/', text: 'Your application was sent to Acme Corp' };
    throw new Error(`unexpected request ${probe}`);
  };
  return { seen, answer };
}
function serve(ws, first, answer) {
  let ev = first;
  while (ev.code === 0 && ev.json.event === 'request') {
    const req = ev.json.request;
    const a = answer(req);
    if (req.kind !== 'act') writeFileSync(req.respond_to, `---\n${envelope(req, a)}\n`);
    ev = run(ws, 'done', '--id', req.id, '--url', 'https://www.linkedin.com/jobs/view/9000000301/', '--next', '--timeout', '60');
  }
  return ev;
}

test('chrome apply, dry run: the job page, Easy Apply, one filled step, stopped before Submit and discarded', () => {
  const ws = workspace();
  const a = agent(ws);
  const end = serve(ws, run(ws, 'start', 'apply', '--', '--job', ws.id, '--dry-run', '--timeout', '60'), a.answer);
  assert.equal(end.code, 10, JSON.stringify(end.json));
  assert.equal(end.json.exit, 0, JSON.stringify(end.json.result));
  assert.equal(end.json.result.outcome, 'dry-run-complete');
  assert.equal(end.json.result.driver, 'chrome');
  assert.deepEqual(a.seen.map((s) => s.probe || s.act), ['linkedinViewProbe', 'click', 'formProbe', 'fillProbe', 'formProbe', 'screenshot', 'screenshot', 'discard']);
  assert.ok(!a.seen.some((s) => s.act === 'submit'), 'a dry run never asks for Submit');
});

test('chrome apply, real submit: refused on an unverified channel; on a verified one the marker is on disk before Submit, and the runner reads the confirmation', () => {
  const un = workspace();
  const refused = serve(un, run(un, 'start', 'apply', '--', '--job', un.id, '--timeout', '60'), agent(un).answer);
  assert.equal(refused.json.exit, 2, JSON.stringify(refused.json.result));
  assert.match(refused.json.result.detail, /not verified for the chrome driver/);
  const ws = workspace({ verified: true });
  const a = agent(ws);
  const end = serve(ws, run(ws, 'start', 'apply', '--', '--job', ws.id, '--timeout', '60'), a.answer);
  const logText = () => { try { return readFileSync(join(ws.data, 'bridge', 'runs', `${end.json.run_id}.log`), 'utf8').slice(-1500); } catch { return ''; } };
  assert.equal(end.json.exit, 0, logText());
  assert.equal(end.json.result.outcome, 'submitted');
  const sub = a.seen.find((s) => s.act === 'submit');
  assert.ok(sub && sub.pendingBeforeSubmit, 'submit_pending was written before the Submit request was served');
  const app = JSON.parse(readFileSync(join(ws.data, 'state', 'jobs.json'), 'utf8')).jobs[ws.id].application;
  assert.equal(app.status, 'submitted');
  assert.equal(app.submit_pending, undefined);
  const result = JSON.parse(readFileSync(join(ws.data, 'applications', ws.id, readdirSorted(join(ws.data, 'applications', ws.id)).find((d) => d.endsWith('-submit')), 'result.json'), 'utf8'));
  assert.equal(result.driver, 'chrome');
});

function readdirSorted(d) { return spawnSync('ls', [d], { encoding: 'utf8' }).stdout.trim().split('\n').sort(); }
