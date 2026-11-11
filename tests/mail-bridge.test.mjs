// The bridge handshake end to end: `npm run mail -- pending` against a throwaway workspace whose
// config/mail.json picks the bridge adapter. The test plays the agent: it reads each request
// file and writes the response the way a mail connector's read tools would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts', 'mail-scan.mjs');

function workspace(mail) {
  const home = mkdtempSync(join(tmpdir(), 'jobba-mail-ws-'));
  cpSync(join(ROOT, 'tests', 'fixtures', 'workspace', 'profile'), join(home, 'profile'), { recursive: true });
  mkdirSync(join(home, 'config'), { recursive: true });
  writeFileSync(join(home, 'config', 'mail.json'), JSON.stringify({ first_scan_after: '2026-11-01T00:00:00Z', hunt_senders: ['linkedin.com', 'dice.com', 'greenhouse-mail.io', 'staffco.example'], ...mail }));
  return { home, data: join(home, 'data') };
}
const run = (ws, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, 'pending', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, JOBBA_HOME: ws.home, JOBBA_DATA_DIR: ws.data } });
  return { code: r.status, out: JSON.parse(r.stdout.trim().split('\n').at(-1)), stderr: r.stderr };
};
const request = (ws, id) => JSON.parse(readFileSync(join(ws.data, 'mail', 'requests', `${id}.json`), 'utf8'));

test('none: pending reports the adapter and does nothing', () => {
  const ws = workspace({ adapter: 'none' });
  const r = run(ws);
  assert.equal(r.code, 0);
  assert.deepEqual([r.out.success, r.out.adapter, r.out.count, r.out.file], [true, 'none', 0, null]);
  assert.ok(!existsSync(join(ws.data, 'mail')));
});

test('bridge: headers first, bodies of signal mail only, then the usual pending file', () => {
  const ws = workspace({ adapter: 'bridge' });
  // 1. A headers request, exit 6.
  const one = run(ws);
  assert.equal(one.code, 6, one.stderr);
  assert.deepEqual([one.out.status, one.out.adapter, one.out.phase], ['needs_fetch', 'bridge', 'headers']);
  assert.match(one.out.next, /^npm run mail -- pending --headers /);
  const hreq = request(ws, one.out.id);
  assert.equal(hreq.kind, 'headers');
  assert.match(hreq.query, /^\(in:inbox OR category:promotions\) after:\d+$/);
  assert.match(hreq.instructions, /Never open a message body/);
  writeFileSync(hreq.respond_to, JSON.stringify({ id: hreq.id, messages: [
    { id: 'm-signal', threadId: 't-signal', from: 'Sam Recruiter <sam@staffco.example>', subject: 'Platform Lead, contract', date: '2026-11-02T18:10:00Z', labels: ['INBOX'] },
    { id: 'm-friend', threadId: 't-friend', from: 'Friend <friend@mail.example>', subject: 'Dinner?', date: '2026-11-02T18:00:00Z', labels: ['INBOX'] },
    { id: 'm-security', threadId: 't-security', from: 'LinkedIn <security-alerts@linkedin.com>', subject: 'Your password was changed', date: '2026-11-02T18:20:00Z', labels: ['INBOX'] },
  ] }));
  // 2. Signals from headers alone: one body (never the friend's, never the security notice's), exit 6.
  const two = run(ws, '--headers', hreq.respond_to);
  assert.equal(two.code, 6, two.stderr);
  assert.equal(two.out.phase, 'bodies');
  const breq = request(ws, two.out.id);
  assert.deepEqual([breq.kind, breq.ids, breq.threads], ['bodies', ['m-signal'], ['t-signal']]);
  writeFileSync(breq.respond_to, JSON.stringify({ id: breq.id, bodies: { 'm-signal': 'Hi Jordan, are you open to a 6-month contract?' }, threads: { 't-signal': [
    { id: 'm-signal', from: 'sam@staffco.example', date: '2026-11-02T18:10:00Z', labels: ['INBOX'], text: 'Hi Jordan' },
    { id: 'm-reply', from: 'jordan@example.com', date: '2026-11-02T19:00:00Z', labels: ['SENT'], text: 'Hi Sam, yes.\n\nJordan Example\nPrincipal Engineer' },
  ] } }));
  // 3. The pending file, as with gws; the exchange files are gone.
  const three = run(ws, '--bodies', breq.respond_to);
  assert.equal(three.code, 0, three.stderr);
  assert.deepEqual([three.out.adapter, three.out.count, three.out.sent, three.out.state_saved], ['bridge', 2, 1, false]);
  const pendingFile = readdirSync(join(ws.data, 'mail')).find((f) => /^pending-\d{8}-\d{4}\.json$/.test(f));
  const pending = JSON.parse(readFileSync(join(ws.data, 'mail', pendingFile), 'utf8'));
  assert.deepEqual(pending.pending.map((p) => [p.id, p.signal, p.text]), [['m-signal', 'sender', 'Hi Jordan, are you open to a 6-month contract?'], ['m-security', 'security', '']]);
  assert.deepEqual(pending.sent, [{ thread_id: 't-signal', at: '2026-11-02T19:00:00.000Z', text: 'Hi Sam, yes.' }]);
  assert.ok(!JSON.stringify(pending).includes('friend@mail.example'));
  assert.deepEqual([...readdirSync(join(ws.data, 'mail', 'requests')), ...readdirSync(join(ws.data, 'mail', 'responses'))], []);
});

test('bridge: with no signal in the headers the scan ends at step 2 and saves its state', () => {
  const ws = workspace({ adapter: 'bridge' });
  const one = run(ws);
  const hreq = request(ws, one.out.id);
  writeFileSync(hreq.respond_to, JSON.stringify({ id: hreq.id, messages: [{ id: 'm1', threadId: 't1', from: 'friend@mail.example', subject: 'Lunch', date: '2026-11-02T18:00:00Z' }] }));
  const two = run(ws, '--headers', hreq.respond_to);
  assert.equal(two.code, 0, two.stderr);
  assert.deepEqual([two.out.count, two.out.file, two.out.state_saved], [0, null, true]);
  assert.equal(JSON.parse(readFileSync(join(ws.data, 'mail', 'state.json'), 'utf8')).last_scan_at, '2026-11-02T18:00:00.000Z');
});

test('bridge: a bodies response missing a requested body fails and saves nothing', () => {
  const ws = workspace({ adapter: 'bridge' });
  const hreq = request(ws, run(ws).out.id);
  writeFileSync(hreq.respond_to, JSON.stringify({ id: hreq.id, messages: [{ id: 'm1', threadId: 't1', from: 'sam@staffco.example', subject: 'Role', date: '2026-11-02T18:00:00Z' }] }));
  const breq = request(ws, run(ws, '--headers', hreq.respond_to).out.id);
  writeFileSync(breq.respond_to, JSON.stringify({ id: breq.id, bodies: {}, threads: { t1: [] } }));
  const three = run(ws, '--bodies', breq.respond_to);
  assert.equal(three.code, 1);
  assert.deepEqual(three.out.missing, { bodies: ['m1'], threads: [] });
  assert.ok(!existsSync(join(ws.data, 'mail', 'state.json')));
});
