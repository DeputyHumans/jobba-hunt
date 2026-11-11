// Inbox scan review findings: one test per finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../scripts/lib/config.mjs';
import { makeGws, MailAuthError } from '../scripts/lib/adapters/mail.mjs';
import { scanPending } from '../scripts/lib/mail-scan.mjs';
import { huntSignal, validateMailResult, recordResults, parseThread } from '../scripts/lib/mail.mjs';

const base = loadConfig('mail.json');
const cfg = { ...base, first_scan_after: '2026-11-01T00:00:00Z', hunt_senders: [...base.hunt_senders, 'staffco.example'] };
const NOW = new Date('2026-11-02T21:00:00Z');
const ME = 'jordan@example.com';
const msg = (o) => ({ id: 'x', threadId: 't', from: '', fromAddr: 'sam@staffco.example', to: '', subject: '', date: '2026-11-02T18:00:00.000Z', labels: ['INBOX'], text: '', ...o });
const gwsOf = ({ list = [], heads = {}, threads = {}, failThread = new Set() } = {}) => {
  const calls = { body: [] };
  return {
    calls,
    list: async () => list,
    headers: async (id) => heads[id],
    body: async (id) => { calls.body.push(id); return `body ${id}`; },
    thread: async (tid) => { if (failThread.has(tid)) throw new Error('404 not found'); return threads[tid] || []; },
  };
};
const ids = new Set(['C01']);
const result = (o = {}) => ({ thread_id: 'th', at: '2026-11-02T18:00:00.000Z', kind: 'reply', firm: 'Staff', sender_name: 'Sam Recruiter', reply_to: 'sam@staffco.example', subject: 'Re: Architect role', summary: 'Asks for a call.', job_id: null, match: 'none', draft: 'Hi Sam, [TIMES] works.', audit: 'ok', claims: [], cv: null, new_cv: false, action: 'Send', ...o });

test('C1: an unsent Gmail draft is not a sent reply', async () => {
  const open = [{ thread_id: 'ta', status: 'draft', since: '2026-11-02T17:00:00.000Z' }];
  const threads = { ta: [msg({ id: 'd1', fromAddr: ME, date: '2026-11-02T19:00:00.000Z', labels: ['DRAFT'], text: 'Hi Sam, I can do' }), msg({ id: 's1', fromAddr: ME, date: '2026-11-02T19:30:00.000Z', labels: ['SENT'], text: 'Hi Sam, sent' })] };
  const r = await scanPending({ gws: gwsOf({ threads }), cfg, st: {}, known: new Set(), openThreads: open, now: NOW });
  assert.deepEqual(r.sent.map((s) => s.text), ['Hi Sam, sent']);
});

test('I1: a reply sent before the draft was recorded still counts, for open and for new threads', async () => {
  const open = [{ thread_id: 'ta', status: 'draft', draft_at: '2026-11-02T20:00:00.000Z', since: '2026-11-02T17:00:00.000Z' }];
  const heads = { n1: msg({ id: 'n1', threadId: 'tn', fromAddr: 'sam@staffco.example', subject: 'Architect', date: '2026-11-02T18:00:00.000Z' }) };
  const threads = { ta: [msg({ fromAddr: ME, date: '2026-11-02T18:30:00.000Z', labels: ['SENT'], text: 'Early reply' })], tn: [heads.n1, msg({ fromAddr: ME, date: '2026-11-02T18:40:00.000Z', labels: ['SENT'], text: 'Phone reply' })] };
  const r = await scanPending({ gws: gwsOf({ list: [{ id: 'n1', threadId: 'tn' }], heads, threads }), cfg, st: {}, known: new Set(), openThreads: open, now: NOW });
  assert.deepEqual(r.sent.map((s) => [s.thread_id, s.text]).sort(), [['ta', 'Early reply'], ['tn', 'Phone reply']]);
  const out = recordResults({ results: [result({ thread_id: 'tn' })], sent: r.sent.filter((s) => s.thread_id === 'tn'), claims: ids, now: NOW });
  assert.deepEqual(out.errors, []);
  assert.equal(parseThread(out.writes.find((w) => w.path.startsWith('pipeline/mail/2')).content).status, 'sent');
});

test('I2+M1: a later result without a draft clears the old draft, and re-records add no duplicates', () => {
  const old = { ...parseThread(recordResults({ results: [result()], claims: ids, now: NOW }).writes[0].content), file: 'f.md' };
  const sent = [{ thread_id: 'th', at: '2026-11-02T19:00:00.000Z', text: 'Hi Sam' }];
  const afterSent = { ...parseThread(recordResults({ results: [], sent, threads: [old], claims: ids, now: NOW }).writes[0].content), file: 'f.md' };
  const rej = result({ at: '2026-11-02T20:00:00.000Z', kind: 'rejection', draft: null, summary: 'Position filled.' });
  const t = parseThread(recordResults({ results: [rej, rej], sent, threads: [afterSent], claims: ids, now: NOW }).writes[0].content);
  assert.equal(t.draft, null);
  assert.equal(t.sent.length, 1);
  assert.equal(t.emails.length, 2);
});

test('I3: a backlog over the per-run cap is read oldest first, and nothing is skipped', async () => {
  const all = Array.from({ length: 250 }, (_, i) => msg({ id: `m${i}`, threadId: `t${i}`, date: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }));
  const gws = gwsOf({ list: [...all].reverse().map((m) => ({ id: m.id, threadId: m.threadId })), heads: Object.fromEntries(all.map((m) => [m.id, m])) });
  const r = await scanPending({ gws, cfg: { ...cfg, max_per_run: 200 }, st: {}, known: new Set(), openThreads: [], now: NOW });
  assert.equal(r.st.last_scan_at, all[199].date);
});

test('I4: one failing thread fetch does not stop the scan', async () => {
  const open = [{ thread_id: 'gone', status: 'draft', since: '2026-11-01T00:00:00.000Z' }, { thread_id: 'ok', status: 'draft', since: '2026-11-01T00:00:00.000Z' }];
  const threads = { ok: [msg({ fromAddr: ME, date: '2026-11-02T10:00:00.000Z', labels: ['SENT'], text: 'Done' })] };
  const r = await scanPending({ gws: gwsOf({ threads, failThread: new Set(['gone']) }), cfg, st: {}, known: new Set(), openThreads: open, now: NOW });
  assert.deepEqual(r.sent.map((s) => s.thread_id), ['ok']);
  assert.deepEqual(r.thread_errors.map((e) => e.thread_id), ['gone']);
});

test('I5: a gws sign-in failure (exit 2, or an API 401) is an auth error', async () => {
  await assert.rejects(makeGws(async () => ({ code: 2, stdout: '', stderr: 'error[auth]: credentials missing' })).list('in:inbox'), MailAuthError);
  await assert.rejects(makeGws(async () => ({ code: 1, stdout: '{"error":{"code":401,"message":"Request had invalid authentication credentials."}}', stderr: '' })).list('in:inbox'), MailAuthError);
});

test('I6: client subjects stay closed, recruiter subjects from a new firm open, and ignore writes nothing', () => {
  const h = (subject, fromAddr = 'ann@umbrella.example') => msg({ subject, fromAddr });
  for (const s of ['Contract for the spring release', 'Lead time on the deploy', 'Customer interview notes']) assert.equal(huntSignal(h(s), cfg, new Set()), null, s);
  assert.equal(huntSignal(h('Remote Role :: Principal AI Transformation Architect', 'recruiter@hooli-talent.example'), cfg, new Set()), 'subject');
  const out = recordResults({ results: [result({ kind: 'ignore', draft: null })], claims: ids, now: NOW });
  assert.deepEqual([out.errors, out.writes], [[], []]);
});

test('I7: an email role never overwrites an existing opportunity file', () => {
  const opp = [{ file: '20261102-initech-principal-ai-transformation-architect.md', md: '---\njob_id: "9000000042"\nstage: applied\n---\n' }];
  const r = result({ kind: 'outreach-fit', firm: 'Hooli Staffing', opportunity: { title: 'Principal AI Transformation Architect', company: 'Initech', score: 80, gates: {}, archetype: 'x' } });
  const out = recordResults({ results: [r], opportunities: opp, claims: ids, now: NOW });
  assert.equal(out.writes.length, 0);
  assert.ok(out.errors.some((e) => e.includes('job_id')));
});

test('I8: rate figures in other forms are refused, ids and zips pass', () => {
  const r = (draft) => validateMailResult(result({ draft }), ids);
  for (const d of ['250 an hour', '250 USD', 'USD 250', 'It is 250$', '250 hourly', 'My rate is 250.', '95 dollars per hr', '120 per annum']) assert.ok(r(d).some((e) => e.includes('rate')), d);
  for (const d of ['Job ID 9130571 is the one.', 'Zip 94105 works.', 'I have 25+ years in software.']) assert.deepEqual(r(d), [], d);
});

test('M4: a security email body is never read, not even through its thread', async () => {
  const heads = { s1: msg({ id: 's1', threadId: 'ts', fromAddr: 'security-alerts@linkedin.com', subject: 'Your password was reset' }) };
  const gws = gwsOf({ list: [{ id: 's1', threadId: 'ts' }], heads, failThread: new Set(['ts']) });
  const r = await scanPending({ gws, cfg, st: {}, known: new Set(), openThreads: [], now: NOW });
  assert.equal(r.pending[0].signal, 'security');
  assert.deepEqual(gws.calls.body, []);
  assert.deepEqual(r.thread_errors, []); // the thread was never fetched
});

test('email role: role, company and CV on file; sending sets applied_at and clears the reply task, with no follow-up date', () => {
  const r = result({ thread_id: 'te', kind: 'outreach-fit', firm: 'Staffco', cv: 'workspace/data/out/cv/share/jordan-example-cv-ai-architect.pdf',
    opportunity: { title: 'AI Engineer', company: 'Hooli via Staffco', score: 58, gates: { G1: 'unclear' }, archetype: 'ai-architect', comp_seen: null, lane: 'hands-on' } });
  const first = recordResults({ results: [r], claims: ids, now: NOW });
  const oppW = first.writes.find((w) => w.path.startsWith('pipeline/opportunities/'));
  assert.match(oppW.content, /^role: "AI Engineer"$/m);
  assert.match(oppW.content, /^company: "Hooli via Staffco"$/m);
  assert.match(oppW.content, /^cv: ai-architect$/m);
  const thread = { ...parseThread(first.writes.find((w) => w.path.startsWith('pipeline/mail/2')).content), file: 'x.md' };
  const opp = { file: oppW.path.split('/').pop(), md: oppW.content };
  const sent = recordResults({ results: [], sent: [{ thread_id: 'te', at: '2026-11-02T22:27:52.000Z', text: 'Hi' }], threads: [thread], opportunities: [opp], claims: ids, now: NOW });
  const md = sent.writes.find((w) => w.path.startsWith('pipeline/opportunities/')).content;
  assert.match(md, /^applied_at: 2026-11-02T22:27:52\.000Z$/m);
  assert.match(md, /^next_action:$/m);
  assert.match(md, /^next_action_due:$/m);
  assert.doesNotMatch(md, /Watch for a reply|Follow up/);
});

test('a sent reply on a thread that became kind "reply" still clears the opportunity reply task', () => {
  const r = result({ thread_id: 'tr', kind: 'outreach-fit', firm: 'Staffco', cv: null,
    opportunity: { title: 'Senior Product Manager', company: 'Staffco', score: 43, gates: { G1: 'unclear' }, archetype: 'ai-engineering-leader', comp_seen: null, lane: 'leadership' } });
  const first = recordResults({ results: [r], claims: ids, now: NOW });
  const oppW = first.writes.find((w) => w.path.startsWith('pipeline/opportunities/'));
  assert.match(oppW.content, /^next_action: Reply on the thread/m);
  const thread = { ...parseThread(first.writes.find((w) => w.path.startsWith('pipeline/mail/2')).content), file: 'x.md', kind: 'reply' };
  const opp = { file: oppW.path.split('/').pop(), md: oppW.content };
  const sent = recordResults({ results: [], sent: [{ thread_id: 'tr', at: '2026-11-02T22:27:52.000Z', text: 'Hi' }], threads: [thread], opportunities: [opp], claims: ids, now: NOW });
  const md = sent.writes.find((w) => w.path.startsWith('pipeline/opportunities/')).content;
  assert.match(md, /^next_action:$/m);
  assert.match(md, /^next_action_due:$/m);
  assert.match(md, /^stage: inbound$/m); // a recruiter conversation, not an application
});

// Greenhouse receipts come from us.greenhouse-mail.io and company receipts from the company's own
// domain; a scan that drops both can never confirm a submit-unverified job with a receipt.
// Security-code mail stays noise: the apply runner reads it itself.
test('receipts carry a hunt signal; Greenhouse security-code mail is noise', async () => {
  const { isNoise } = await import('../scripts/lib/mail.mjs');
  const gh = msg({ fromAddr: 'notifications@us.greenhouse-mail.io', subject: 'Thank you for applying to Globex' });
  const co = msg({ fromAddr: 'no-reply@initech.example', subject: 'Thank you for applying to Initech, Inc.!' });
  const co2 = msg({ fromAddr: 'no-reply@hooli.example', subject: 'Thank you for your application to Hooli!' });
  const code = msg({ fromAddr: 'notifications@us.greenhouse-mail.io', subject: 'Security code for your application to Globex' });
  assert.equal(huntSignal(gh, cfg, new Set()), 'sender');
  assert.equal(huntSignal(co, cfg, new Set()), 'subject');
  assert.equal(huntSignal(co2, cfg, new Set()), 'subject');
  for (const m of [gh, co, co2]) assert.equal(isNoise(m, cfg), false);
  assert.equal(isNoise(code, cfg), true);
});

test('a recruiter at a company the user applied to carries a signal, and "interview confirmation" is a subject cue', async () => {
  // "We'd love to talk to you!" and "Virtual Interview Confirmation" from the company's own domain
  // carry no job word: without the company signal a booked screen never reaches the tracker.
  const { huntSignal: hs } = await import('../scripts/lib/mail.mjs');
  const c = cfg;
  const talk = msg({ fromAddr: 'sam@umbrellalabs.example', subject: "Umbrella Labs | We'd love to talk to you!" });
  const conf = msg({ fromAddr: 'sam@umbrellalabs.example', subject: 'Umbrella Labs | Jordan, Virtual Interview Confirmation' });
  const other = msg({ fromAddr: 'news@shop-two.example', subject: "We'd love to talk to you!" });
  assert.equal(hs(talk, c, new Set(), new Set(['umbrellalabs'])), 'company');
  assert.equal(hs(conf, c, new Set()), 'subject');
  assert.equal(hs(other, c, new Set(), new Set(['umbrellalabs'])), null);
  // A bare "interview" stays closed: a client's "Customer interview notes" is not hunt mail (I6).
  assert.equal(hs(msg({ fromAddr: 'ann@umbrella.example', subject: 'Customer interview notes' }), c, new Set()), null);
});

test('a new thread never takes the file of an existing one, even when the short id suffix collides', () => {
  // Two thread ids sharing their first six characters both became "...-0000bb.md", and a
  // calendar invite overwrote the interview card with its reply draft.
  const base = recordResults({ results: [result({ thread_id: '0000aaaa11112222', kind: 'receipt', draft: null, mail_status: 'no-reply' })], claims: ids, now: NOW }).writes[0];
  const fileOf = (w) => w.path.split('/').pop();
  const t1 = { ...parseThread(base.content), file: fileOf(base) };
  const second = recordResults({ results: [result({ thread_id: '0000bbbb11112222' })], threads: [t1], claims: ids, now: NOW }).writes.find((w) => w.content.includes('0000bbbb11112222'));
  const t2 = { ...parseThread(second.content), file: fileOf(second) };
  const third = recordResults({ results: [result({ thread_id: '0000bbbb33334444', kind: 'receipt', draft: null, mail_status: 'no-reply' })], threads: [t1, t2], claims: ids, now: NOW }).writes.find((w) => w.content.includes('0000bbbb33334444'));
  assert.notEqual(fileOf(second), t1.file);
  assert.notEqual(fileOf(third), t1.file);
  assert.notEqual(fileOf(third), t2.file);
});
