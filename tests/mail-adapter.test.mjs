import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGws, plainText, openMail, replayMail, withAfter, writeRequest, MailWriteRefused, MailAuthError, MailNeedsFetch, GwsAuthError } from '../scripts/lib/adapters/mail.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const msg = (id, o = {}) => ({ id, threadId: `t-${id}`, labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Sam Recruiter <sam@staffco.example>' }, { name: 'Subject', value: o.subject || 'W2 rate' }, { name: 'Date', value: o.date || 'Mon, 2 Nov 2026 10:00:00 -0800' }], body: { data: b64(o.text || 'Hi Jordan') } } });

test('gws: every call is a read; a write throws before any process starts', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args.includes('list')) return { code: 0, stdout: 'Using keyring backend: file\n' + JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }), stderr: '' };
    if (args.includes('threads')) return { code: 0, stdout: JSON.stringify({ messages: [] }), stderr: '' };
    return { code: 0, stdout: JSON.stringify(msg('m1')), stderr: '' };
  };
  const gws = makeGws(run);
  assert.equal(gws.kind, 'gws');
  assert.deepEqual(await gws.list('in:inbox'), [{ id: 'm1', threadId: 't1' }]);
  const h = await gws.headers('m1');
  assert.equal(h.fromAddr, 'sam@staffco.example');
  assert.equal(await gws.body('m1'), 'Hi Jordan');
  await gws.thread('t1');
  for (const a of calls) assert.ok(['list', 'get'].includes(a[a.indexOf('--params') - 1]), a.join(' '));
  const before = calls.length;
  assert.throws(() => gws.call(['gmail', 'users', 'messages', 'modify'], {}), MailWriteRefused);
  assert.throws(() => gws.call(['gmail', 'users', 'messages', 'send'], {}), MailWriteRefused);
  assert.equal(calls.length, before);
});

test('gws: sign-in failures are MailAuthError (exit 2, an API 401, a scope 403); a rate limit is not', async () => {
  const fails = (r) => makeGws(async () => r).list('in:inbox');
  await assert.rejects(fails({ code: 2, stdout: '', stderr: 'error[auth]: no credentials' }), (e) => e instanceof MailAuthError && e.name === 'MailAuthError');
  await assert.rejects(fails({ code: 1, stdout: 'Using keyring backend: file\n{"error":{"code":403,"message":"Request had insufficient authentication scopes.","reason":"insufficientPermissions"}}', stderr: '' }), MailAuthError);
  await assert.rejects(fails({ code: 1, stdout: '{"error":{"code":403,"message":"User rate limit exceeded","reason":"rateLimitExceeded"}}', stderr: 'error[api]: rateLimitExceeded' }), (e) => !(e instanceof MailAuthError));
  assert.equal(GwsAuthError, MailAuthError); // the earlier name still works
});

test('plainText: html-only and nested multipart; links keep their URL', () => {
  const html = { mimeType: 'text/html', body: { data: b64('<p>Hi&nbsp;Jordan</p><br>Thanks') } };
  const nested = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative', parts: [html] }] };
  assert.equal(plainText(nested), 'Hi Jordan\nThanks');
  const both = { mimeType: 'multipart/alternative', parts: [html, { mimeType: 'text/plain', body: { data: b64('Plain wins') } }] };
  assert.equal(plainText(both), 'Plain wins');
  const link = { mimeType: 'text/html', body: { data: b64('<p>Confirm: <a href="https://acme.example/verify?t=1&amp;u=2">Verify your email</a></p><a href="https://x.example/a">https://x.example/a</a><a href="#top">Top</a>') } };
  assert.equal(plainText(link), 'Confirm: Verify your email (https://acme.example/verify?t=1&u=2)\nhttps://x.example/aTop');
});

test('gws fetchRecent: one full read per message, newest first, after the given time', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(JSON.parse(args.at(-1)));
    if (args.includes('list')) return { code: 0, stdout: JSON.stringify({ messages: [{ id: 'old' }, { id: 'new' }] }), stderr: '' };
    const id = JSON.parse(args.at(-1)).id;
    return { code: 0, stdout: JSON.stringify(msg(id, { date: id === 'new' ? 'Mon, 2 Nov 2026 11:00:00 -0800' : 'Mon, 2 Nov 2026 09:00:00 -0800', text: `code ${id}` })), stderr: '' };
  };
  const out = await makeGws(run).fetchRecent({ query: 'from:greenhouse-mail.io', after: '2026-11-02T16:00:00.000Z', max: 2 });
  assert.equal(calls[0].q, `from:greenhouse-mail.io after:${Date.parse('2026-11-02T16:00:00Z') / 1000}`);
  assert.deepEqual(out.map((m) => [m.id, m.text, m.fromAddr]), [['new', 'code new', 'sam@staffco.example'], ['old', 'code old', 'sam@staffco.example']]);
  assert.ok(out.every((m) => ['id', 'threadId', 'from', 'fromAddr', 'subject', 'date', 'text'].every((k) => k in m)));
  assert.equal(withAfter('in:inbox', null), 'in:inbox');
});

test('openMail: none returns nothing at once; bridge refuses direct reads; an unknown adapter is an error', async () => {
  const none = openMail({ cfg: { adapter: 'none' } });
  assert.equal(none.kind, 'none');
  assert.deepEqual(await none.fetchRecent({ query: 'x' }), []);
  assert.deepEqual(await none.list('x'), []);
  const dir = mkdtempSync(join(tmpdir(), 'mail-bridge-'));
  const bridge = openMail({ cfg: { adapter: 'bridge' }, dir });
  assert.equal(bridge.kind, 'bridge');
  await assert.rejects(bridge.list('x'), MailNeedsFetch);
  assert.throws(() => openMail({ cfg: { adapter: 'imap' } }), /gws, bridge or none/);
  assert.equal(openMail({ cfg: { adapter: 'gws' }, run: async () => ({ code: 0, stdout: '{}', stderr: '' }) }).kind, 'gws');
});

test('bridge fetchRecent: writes a fetch request, returns the response newest first, and deletes both files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mail-bridge-'));
  let req = null;
  // The "agent": answers the first request it sees on the second poll.
  const sleep = async () => {
    const reqDir = join(dir, 'requests');
    const f = existsSync(reqDir) ? readdirSync(reqDir).find((x) => x.endsWith('.json')) : null;
    if (!f) return;
    req = JSON.parse(readFileSync(join(reqDir, f), 'utf8'));
    writeFileSync(req.respond_to, JSON.stringify({ id: req.id, messages: [
      { id: 'a', threadId: 'ta', from: 'Greenhouse <notifications@us.greenhouse-mail.io>', subject: 'Security code', date: '2026-11-02T18:00:00Z', text: 'Code: 111111' },
      { id: 'b', threadId: 'tb', from: 'notifications@us.greenhouse-mail.io', subject: 'Security code', date: '2026-11-02T18:05:00Z', text: 'Code: 222222' },
    ] }));
  };
  const mail = openMail({ cfg: { adapter: 'bridge', bridge: { wait_seconds: 5 } }, dir, sleep, pollMs: 1 });
  const out = await mail.fetchRecent({ query: 'from:greenhouse-mail.io', after: '2026-11-02T17:55:00.000Z', max: 5, purpose: 'security-code', job_id: '9000000001' });
  assert.deepEqual([req.kind, req.query, req.after, req.max, req.purpose, req.job_id], ['fetch', 'from:greenhouse-mail.io', '2026-11-02T17:55:00.000Z', 5, 'security-code', '9000000001']);
  assert.deepEqual(out.map((m) => [m.id, m.fromAddr, m.text]), [['b', 'notifications@us.greenhouse-mail.io', 'Code: 222222'], ['a', 'notifications@us.greenhouse-mail.io', 'Code: 111111']]);
  assert.equal(out.timedOut, undefined);
  assert.deepEqual([...readdirSync(join(dir, 'requests')), ...readdirSync(join(dir, 'responses'))], []);
});

test('bridge fetchRecent: no response before wait_seconds returns [] marked timedOut, and the stale request is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mail-bridge-'));
  const mail = openMail({ cfg: { adapter: 'bridge' }, dir, sleep: async () => {}, pollMs: 1 });
  const out = await mail.fetchRecent({ query: 'x', wait_seconds: 0 });
  assert.deepEqual([...out], []);
  assert.equal(out.timedOut, true);
  assert.deepEqual(readdirSync(join(dir, 'requests')), []);
});

test('replayMail: headers from a response; a missing body or thread reads empty and is recorded as needed', async () => {
  const r = replayMail({ messages: [{ id: 'm1', threadId: 't1', from: 'Sam Recruiter <SAM@staffco.example>', subject: 'Role', date: '2026-11-02T18:00:00Z' }], bodies: { m2: 'text 2' } });
  assert.deepEqual(await r.list(), [{ id: 'm1', threadId: 't1' }]);
  assert.equal((await r.headers('m1')).fromAddr, 'sam@staffco.example');
  assert.equal(await r.body('m1'), '');
  assert.equal(await r.body('m2'), 'text 2');
  assert.deepEqual(await r.thread('t1'), []);
  assert.deepEqual([[...r.needs.bodies], [...r.needs.threads]], [['m1'], ['t1']]);
  const req = writeRequest({ kind: 'headers', query: 'q' }, { dir: mkdtempSync(join(tmpdir(), 'mail-bridge-')) });
  assert.ok(req.request.endsWith(`requests/${req.id}.json`) && req.response.endsWith(`responses/${req.id}.json`));
});
