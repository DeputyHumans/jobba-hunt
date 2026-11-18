import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { huntSignal, validateMailResult, renderThread, renderIndex, parseThread, recordResults, cvShare } from '../scripts/lib/mail.mjs';

// The shipped mail.json defaults, plus the values a user's onboarding adds: a staffing firm
// they hear from, and their own domain under never_open.
const base = loadConfig('mail.json');
const cfg = { ...base, first_scan_after: '2026-11-01T00:00:00Z', hunt_senders: [...base.hunt_senders, 'staffco.example'], never_open: { ...base.never_open, domains: ['jordan.example.com'] } };
const h = (o) => ({ id: 'm1', threadId: 't1', from: '', fromAddr: 'x@gmail.example', to: '', subject: '', date: '2026-11-02T18:00:00.000Z', labels: ['INBOX'], ...o });

test('huntSignal: never-open beats every signal', () => {
  const known = new Set(['t1']);
  assert.equal(huntSignal(h({ fromAddr: 'partner@jordan.example.com', subject: 'Contract architect role' }), cfg, known), null);
  assert.equal(huntSignal(h({ fromAddr: 'sam@staffco.example', subject: 'Contract architect role' }), cfg, new Set()), 'sender');
  assert.equal(huntSignal(h({ subject: 'Lunch Friday?' }), cfg, new Set()), null);
});

test('validateMailResult: rate figures refused', () => {
  const r = (draft) => ({ thread_id: 't1', kind: 'reply', draft, claims: ['C01'] });
  const ids = new Set(['C01']);
  for (const d of ['My rate is $150/hr.', 'I can do 150 per hour.', 'Around $120k.', 'Target 120,000 USD.']) {
    assert.ok(validateMailResult(r(d), ids).some((e) => e.includes('rate')), d);
  }
  assert.deepEqual(validateMailResult(r('My rate is [RATE] on 1099. I have 15+ years in software.'), ids), []);
  assert.ok(validateMailResult(r('Hi; thanks'), ids).some((e) => e.includes('semicolon')));
});

const NOW2 = new Date('2026-11-02T21:00:00Z');
const OPP_FILE = '20261030-staffco-gen-ai-architect.md';
const DICE_ID = 'dice-11111111-1111-4111-8111-111111111101';
const thread = (o = {}) => ({
  thread_id: 't9', status: 'draft', kind: 'reply', firm: 'Staffco', sender_name: 'Sam Recruiter', reply_to: 'sam@staffco.example', subject: 'Re: Gen AI Architect: rate?',
  job_id: DICE_ID, opportunity: OPP_FILE, cv: 'workspace/data/out/cv/share/jordan-example-cv-ai-architect.pdf', new_cv: false,
  action: 'Send the reply with your rate', draft_at: '2026-11-02T20:00:00.000Z', notified: false, claims: ['C01'], audit: 'claims only',
  emails: [{ at: '2026-11-02T19:00:00.000Z', from_name: 'Sam Recruiter', summary: 'Asks the W2 rate and visa status.' }],
  draft: 'Hi Sam,\n\nMy rate is [RATE] on 1099.\n\nBest,\nJordan', sent: [], ...o,
});
const OPP = `---\ntitle: Gen AI Architect @ Staffco\nrelated_docs:\n  - ../../fit-profile.md\nstage: applied\njob_id: "${DICE_ID}"\n---\n\n# Gen AI Architect\n\n## Stage log\n| Date | Stage | Note |\n|---|---|---|\n| 2026-10-30 | applied | Dice Easy Apply |\n`;
const claimIds = new Set(['C01', 'C02']);

test('renderThread/parseThread round-trip', () => {
  const t = thread({ sent: [{ at: '2026-11-02T20:30:00.000Z', text: 'Hi Sam,\nDone.' }] });
  assert.deepEqual(parseThread(renderThread(t, { now: NOW2 })), t);
});

test('thread and index files: the owner and the dates come from the profile, or from the caller', () => {
  const md = renderThread(thread(), { now: NOW2 });
  assert.match(md, /^owner: Jordan Example$/m);
  assert.match(md, /^tags: \[job-hunt, mail, reply\]$/m);
  assert.match(md, /^created: 2026-11-02$/m);
  // 03:30 UTC on 3 Nov is still 2 Nov on the fixture's Chicago clock, and 3 Nov in UTC.
  const late = thread({ emails: [{ at: '2026-11-03T03:30:00.000Z', from_name: 'Sam', summary: 's' }] });
  assert.match(renderThread(late, { now: NOW2 }), /^created: 2026-11-02$/m);
  assert.match(renderThread(late, { now: NOW2, tz: 'UTC', owner: 'Someone Else' }), /^created: 2026-11-03$\n[\s\S]*^owner: Someone Else$/m);
  const idx = renderIndex([{ ...thread(), file: 'a.md' }], { now: NOW2, created: '2026-10-01' });
  assert.match(idx, /^created: 2026-10-01$/m);
  assert.match(renderIndex([], { now: NOW2 }), /^created: 2026-11-02$/m); // a new index takes today
});

test('record: reply on an applied role', () => {
  const r = { thread_id: 't9', at: '2026-11-02T19:00:00.000Z', kind: 'reply', firm: 'Staffco', sender_name: 'Sam Recruiter', reply_to: 'sam@staffco.example', subject: 'Re: Gen AI Architect', summary: 'Asks the W2 rate.', job_id: DICE_ID, match: 'sure', draft: 'Hi Sam, my rate is [RATE].', audit: 'ok', claims: ['C01'], cv: null, new_cv: false, action: 'Fill [RATE] and send' };
  const out = recordResults({ results: [r], opportunities: [{ file: OPP_FILE, md: OPP }], claims: claimIds, now: NOW2 });
  assert.deepEqual(out.errors, []);
  const byPath = Object.fromEntries(out.writes.map((w) => [w.path, w.content]));
  const tf = byPath[`pipeline/mail/${OPP_FILE}`];
  assert.match(tf, /^mail_status: draft$/m);
  const opp = byPath[`pipeline/opportunities/${OPP_FILE}`];
  assert.match(opp, new RegExp(`^ {2}- \\.\\./mail/${OPP_FILE.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(opp, /\| 2026-11-02 \| mail \| reply: Asks the W2 rate\./);
  assert.match(byPath['pipeline/mail/README.md'], new RegExp(OPP_FILE.replace(/\./g, '\\.')));
});

test('record: new email on a sent thread reopens it', () => {
  const old = { ...thread({ status: 'sent', sent: [{ at: '2026-11-02T20:30:00.000Z', text: 'Hi Sam' }] }), file: OPP_FILE };
  const r = { thread_id: 't9', at: '2026-11-02T20:50:00.000Z', kind: 'reply', firm: 'Staffco', sender_name: 'Sam Recruiter', reply_to: 'sam@staffco.example', subject: 'Re: Gen AI Architect', summary: 'Sends the W2 range.', job_id: DICE_ID, match: 'sure', draft: 'Thanks Sam.', audit: 'ok', claims: [], cv: null, new_cv: false, action: 'Decide on W2' };
  const out = recordResults({ results: [r], threads: [old], claims: claimIds, now: NOW2 });
  const t = parseThread(out.writes.find((w) => w.path.endsWith(old.file)).content);
  assert.equal(t.status, 'draft');
  assert.equal(t.sent.length, 1);
  assert.deepEqual(t.emails.map((e) => e.summary), ['Asks the W2 rate and visa status.', 'Sends the W2 range.']);
});

test('record: sent results close the card, and the stage log names the user', () => {
  const old = { ...thread(), file: OPP_FILE };
  const out = recordResults({ results: [], sent: [{ thread_id: 't9', at: '2026-11-02T20:40:00.000Z', text: 'Hi Sam, $150/hr on 1099.' }], threads: [old], opportunities: [{ file: OPP_FILE, md: OPP }], claims: claimIds, now: NOW2 });
  assert.deepEqual(out.errors, []);
  const t = parseThread(out.writes.find((w) => w.path === `pipeline/mail/${old.file}`).content);
  assert.equal(t.status, 'sent');
  assert.equal(t.sent[0].text, 'Hi Sam, $150/hr on 1099.');
  assert.match(out.writes.find((w) => w.path.startsWith('pipeline/opportunities/')).content, /\| 2026-11-02 \| reply sent \| Jordan Example replied on the thread/);
});

test('fixture pipeline: every mail thread parses and the index lists it and every outbound file', () => {
  const dir = new URL('./fixtures/workspace/pipeline/mail/', import.meta.url);
  const readme = readFileSync(new URL('README.md', dir), 'utf8');
  const files = readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'README.md');
  assert.ok(files.length >= 3);
  for (const f of files) {
    const t = parseThread(readFileSync(new URL(f, dir), 'utf8'));
    assert.ok(t.thread_id, f);
    assert.ok(['draft', 'sent', 'no-reply', 'closed'].includes(t.status), `${f}: ${t.status}`);
    assert.ok(readme.includes(`](${f})`), `${f} missing from README`);
  }
  for (const f of readdirSync(new URL('outbound/', dir))) assert.ok(readme.includes(`](outbound/${f})`), `outbound/${f} missing from README`);
});

test('record: two firms on one role get two thread files', () => {
  const OPP2 = OPP.replace(`job_id: "${DICE_ID}"`, 'job_id: "9000000042"');
  const opp = [{ file: '20261102-initech-principal-ai-transformation-architect.md', md: OPP2 }];
  const r = (id, firm) => ({ thread_id: id, at: '2026-11-02T20:00:00.000Z', kind: 'reply', firm, sender_name: 'X', reply_to: 'someone@initech.example', subject: 'Principal AI Transformation Architect', summary: 's', job_id: '9000000042', match: 'probable', draft: 'Hi.', audit: 'ok', claims: [], cv: null, new_cv: false, action: 'a' });
  const out = recordResults({ results: [r('t1', 'Initech Talent'), r('t2', 'Hooli Staffing')], opportunities: opp, claims: claimIds, now: NOW2 });
  const files = out.writes.filter((w) => w.path.startsWith('pipeline/mail/2')).map((w) => w.path);
  assert.deepEqual(files, ['pipeline/mail/20261102-initech-principal-ai-transformation-architect.md', 'pipeline/mail/20261102-initech-principal-ai-transformation-architect--hooli-staffing.md']);
});

test('record: match is stored on the thread; a probable match says so in the stage log; an unknown value is refused', () => {
  const OPP2 = OPP.replace(`job_id: "${DICE_ID}"`, 'job_id: "9000000042"');
  const opp = [{ file: '20261102-initech-principal-ai-transformation-architect.md', md: OPP2 }];
  const r = { thread_id: 'tp', at: '2026-11-02T20:00:00.000Z', kind: 'reply', firm: 'Initech Talent', sender_name: 'X', reply_to: null, subject: 'Principal AI Transformation Architect', summary: 's', job_id: '9000000042', match: 'probable', draft: 'Hi.', audit: 'ok', claims: [], cv: null, new_cv: false, action: 'a' };
  const out = recordResults({ results: [r], opportunities: opp, claims: claimIds, now: NOW2 });
  const thread = out.writes.find((w) => w.path.startsWith('pipeline/mail/2'));
  assert.equal(parseThread(thread.content).match, 'probable');
  const stage = out.writes.find((w) => w.path.startsWith('pipeline/opportunities/'));
  assert.match(stage.content, /probable match/);
  assert.ok(validateMailResult({ ...r, match: 'maybe' }, claimIds).some((e) => /match/.test(e)));
});

test('record: a Dice contact row joins the table, above any closing note', () => {
  const contacts = '# Contacts\n\n| Date | Firm | Role | Structure | Location | Gates | Response | Source |\n|---|---|---|---|---|---|---|---|\n| 2026-10-29 | Initech Staffing | None | n/a | n/a | n/a | None | inferred Dice |\n\n**Pass count to date:** 0 of 1.\n';
  const r = { thread_id: 'tz', at: '2026-11-02T20:00:00.000Z', kind: 'blast', firm: 'Staffco', sender_name: 'S', reply_to: null, subject: 'Role', summary: 's', job_id: null, match: 'none', draft: null, audit: null, claims: [], cv: null, new_cv: false, action: '', dice_contact: { role: 'AI Engineer', structure: 'W2', location: 'Springfield', gates: 'G3 unclear' } };
  const md = recordResults({ results: [r], contactsMd: contacts, claims: claimIds, now: NOW2 }).writes.find((w) => w.path.endsWith('recruiter-contacts.md')).content;
  assert.ok(md.indexOf('| 2026-11-02 | Staffco |') < md.indexOf('**Pass count'));
});

test('cvShare: the share name from any prefix, else the bare file name', () => {
  assert.equal(cvShare('workspace/data/out/cv/share/jordan-example-cv-ai-architect.pdf'), 'ai-architect');
  assert.equal(cvShare('x/candidate-cv-platform-lead.docx'), 'platform-lead');
  assert.equal(cvShare('notes.pdf'), 'notes');
  assert.equal(cvShare(null), '');
});
