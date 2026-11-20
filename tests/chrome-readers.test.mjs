// The readers under the chrome driver, end to end through `npm run browser`, with the test as the
// agent: it answers each page request with the envelope a page would write (canned payloads, no
// browser), and acknowledges it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dashHash, envelopeText } from '../scripts/lib/page-script.mjs';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2)); };
function workspace({ session = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jobba-chrome-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  const data = join(home, 'data');
  mkdirSync(join(data, 'state'), { recursive: true });
  const prefs = JSON.parse(readFileSync(join(home, 'profile', 'preferences.json'), 'utf8'));
  prefs.schedule = { ...prefs.schedule, days: [0, 1, 2, 3, 4, 5, 6], tick_start: '00:00', tick_end: '23:59' };
  writeJson(join(home, 'profile', 'preferences.json'), prefs);
  const t = JSON.parse(readFileSync(join(CODE_ROOT, 'templates', 'workspace', 'config', 'searches.json'), 'utf8'));
  writeJson(join(home, 'config', 'searches.json'), { ...t, verified: true, verified_at: '2026-11-01T00:00:00Z', verified_by: 'test', pacing: { search_gap_ms: [0, 0], view_gap_ms: [0, 0], settle_ms: [0, 0] }, tick: { ...t.tick, views_per_tick: 1 } });
  writeJson(join(home, 'config', 'browser.json'), { driver: 'chrome' });
  if (session) writeJson(join(data, 'state', 'browser-sessions.json'), { chrome: { linkedin: { logged_in: true, checked_at: '2026-11-20T08:00:00Z' } } });
  return { home, data };
}
const env = (ws) => ({ ...process.env, JOBBA_HOME: ws.home, JOBBA_DATA_DIR: ws.data, JOBBA_LIMITS_LOG: join(ws.data, 'state', 'limits-log.json'), JOBBA_NO_BROWSER: '1', JOBBA_BRIDGE_FAKE_AGENT: '1' });
const run = (ws, file, ...args) => {
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', file), ...args], { encoding: 'utf8', env: env(ws), timeout: 120000 });
  return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop() || '{}'), err: r.stderr };
};
const envelope = (req, payload) => envelopeText({ v: 1, id: req.id, nonce: req.nonce, href: req.url || 'https://www.linkedin.com/jobs/', at: new Date().toISOString(), status: 'ok', error: null, sha256: dashHash(JSON.stringify(payload)), payload });

const CARD = 'Fractional CTO\nAcme Corp\nUnited States (Remote)\nContract';
const searchPayload = (url) => ({ url, loggedOut: false, merged: [['9000000501', CARD]], snap: { countText: '1 result', mainText: 'Fractional CTO Acme Corp', outsideText: '', usedListItems: true } });
const viewPayload = (url) => ({ url, loggedOut: false, v: { title: 'Fractional CTO', company: 'Acme Corp', company_url: 'https://www.linkedin.com/company/acme-corp/', top_card_text: 'Fractional CTO\nAcme Corp\nUnited States (Remote) · 1 day ago · 12 applicants\nContract · Executive', description_text: 'Acme Corp needs a fractional CTO two days a week to lead a platform team of eight, set the architecture and hire two senior engineers. Synthetic text for tests only.', main_text: 'About the job', apply_label: 'Easy Apply to Fractional CTO at Acme Corp', apply_href: null } });

// Plays the agent until the command finishes; `answer(req)` gives the payload or { failed }.
function serve(ws, first, answer) {
  const served = [];
  let ev = first;
  while (ev.code === 0 && ev.json.event === 'request') {
    const req = ev.json.request;
    served.push(req);
    const a = answer(req);
    if (a?.failed) ev = run(ws, 'browser.mjs', 'done', '--id', req.id, '--failed', a.failed, '--next', '--timeout', '60');
    else {
      writeFileSync(req.respond_to, `Title: x\nURL: ${req.url}\nSource element: <article>\n---\n${envelope(req, a)}\n`);
      ev = run(ws, 'browser.mjs', 'done', '--id', req.id, '--url', req.url || 'https://www.linkedin.com/feed/', '--next', '--timeout', '60');
    }
  }
  return { served, end: ev };
}
const linkedinAnswer = (req) => (/\/jobs\/view\//.test(req.url || '') ? viewPayload(req.url) : /\/feed\//.test(req.url || '') ? { url: req.url, nav: 1, login: 0 } : searchPayload(req.url));

test('chrome tick: refused until the Chrome sign-in is confirmed, and refused outside the bridge', () => {
  const unconfirmed = run(workspace({ session: false }), 'tick.mjs');
  assert.equal(unconfirmed.code, 2, unconfirmed.err);
  assert.equal(unconfirmed.json.cap, 'chrome-session-unconfirmed');
  const direct = run(workspace(), 'tick.mjs');
  assert.equal(direct.code, 2, direct.err);
  assert.equal(direct.json.cap, 'chrome-needs-bridge');
});

test('chrome tick through the bridge: one search and one view, the role stored, exit 0', () => {
  const ws = workspace();
  const first = run(ws, 'browser.mjs', 'start', 'tick', '--timeout', '60');
  assert.equal(first.code, 0, first.err + JSON.stringify(first.json));
  const { served, end } = serve(ws, first, linkedinAnswer);
  assert.equal(end.code, 10, JSON.stringify(end.json));
  assert.equal(end.json.exit, 0, JSON.stringify(end.json.result));
  assert.ok(served.every((r) => r.kind === 'load' && r.steps.some((s) => s.tool === 'file_upload')));
  assert.ok(served.some((r) => /\/jobs\/view\/9000000501\//.test(r.url)), served.map((r) => r.url).join(' '));
  const state = JSON.parse(readFileSync(join(ws.data, 'state', 'jobs.json'), 'utf8'));
  assert.equal(state.jobs['9000000501'].detail?.title, 'Fractional CTO');
  assert.equal(state.halt_until ?? null, null);
});

test('chrome tick: a browser that stops answering ends the tick with exit 3 and no halt', () => {
  const ws = workspace();
  const first = run(ws, 'browser.mjs', 'start', 'tick', '--timeout', '60');
  const { end } = serve(ws, first, () => ({ failed: 'No browsers are connected' }));
  assert.equal(end.code, 10);
  assert.equal(end.json.exit, 3, JSON.stringify(end.json.result));
  assert.equal(end.json.result.browser, 'unavailable');
  const state = JSON.parse(readFileSync(join(ws.data, 'state', 'jobs.json'), 'utf8'));
  assert.equal(state.halt_until ?? null, null, 'a lost browser never halts LinkedIn');
});

test('chrome whoami records the session; login under chrome opens nothing and says where to sign in', () => {
  const ws = workspace({ session: false });
  const login = run(ws, 'linkedin-jobs.mjs', 'login');
  assert.equal(login.code, 0);
  assert.equal(login.json.manual, true);
  assert.match(login.json.note, /your own Chrome/);
  const first = run(ws, 'browser.mjs', 'start', 'jobs', '--', 'whoami', '--timeout', '60');
  assert.equal(first.code, 0, first.err + JSON.stringify(first.json));
  assert.match(first.json.request.url, /linkedin\.com\/feed\//);
  const { end } = serve(ws, first, linkedinAnswer);
  assert.equal(end.json.exit, 0, JSON.stringify(end.json.result));
  assert.equal(end.json.result.loggedIn, true);
  const sessions = JSON.parse(readFileSync(join(ws.data, 'state', 'browser-sessions.json'), 'utf8'));
  assert.equal(sessions.chrome.linkedin.logged_in, true);
  assert.ok(existsSync(join(ws.data, 'bridge')));
});
