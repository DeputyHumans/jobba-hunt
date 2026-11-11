import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComp, parseFrontmatter, parseInterviews, buildTracker, renderTrackerHtml, publishTracker, BANNED, bannedWords, runLabels, capRows, zoneLabel, watchEvents, HEADINGS } from '../scripts/lib/tracker.mjs';

// Every model here is built on the US Pacific clock with an 08:00-18:00 business day, injected,
// so the time assertions do not depend on the fixture profile (America/Chicago, 07:00-18:00).
const ZONE = { tz: 'America/Los_Angeles', hours: { open: 480, close: 1080 } };
const build = (o) => buildTracker({ ...ZONE, ...o });

const NOW = new Date('2026-10-27T23:30:00Z'); // Tue 16:30 PDT
const T = '2026-10-27T20:00:00.000Z';
const gates = (g4 = 'pass', g1 = 'pass') => ({ G1: g1, G2: 'pass', G3: 'pass', G4: g4 });
const job = (id, o) => ({
  job_id: id, url: `https://www.linkedin.com/jobs/view/${id}/`, title: `Role ${id}`, company: `Co ${id}`, location: 'United States (Remote)',
  first_seen: T, seen_count: 1, matched_queries: ['q'], scopes: ['fractional'], repost_of: null,
  prefilter: { verdict: 'keep', reasons: [], flags: [] }, detail: { fetched_at: T, employment_type: 'Contract', workplace: 'Remote', apply: { type: 'easy' }, comp_text: null },
  status: 'triaged', triage: null, ...o,
});
const tri = (o) => ({ score: 70, gates: gates(), dims: {}, why_fit: [], gaps: [], red_flags: [], comp_seen: null, hours_seen: null, archetype: 'mvp-build', tier: 'B', scored_at: T, decision: null, decided_at: null, note: null, ...o });

const state = {
  _schema: 2, last_successful_sweep: T, query_runs: {}, ticks_since_canary: 0, last_tick: null, suspect_streak: 0, halt_until: null,
  jobs: {
    9000000001: job('9000000001', {
      title: 'Fractional CTO', company: 'Acme Corp', status: 'applied',
      triage: tri({ tier: 'A', score: 80, why_fit: ['C19', 'C14'], gaps: ['Next.js not claimed'], red_flags: ['No hours stated'], decision: 'pursue' }),
      application: { status: 'submitted', submitted_at: '2026-10-27T20:47:00.000Z', cv: 'workspace/data/out/cv/share/jordan-example-cv-fractional-cto.pdf',
        attempts: [{ at: T, mode: 'submit', outcome: 'submitted', channel: 'easy', detail: null, filled: [{ label: 'Desired hourly rate', value: '250' }] }] },
    }),
    9000000002: job('9000000002', {
      title: 'Fractional CTO (Client-Facing)', company: 'Globex', status: 'applied',
      triage: tri({ score: 79, comp_seen: 'USD $150~$200/hour', hours_seen: 'typically 5~10 hours/week', why_fit: ['C38, C03: dev-shop side, 1,000+ engineers'], decision: 'pursue', archetype: 'dev-shop-audit' }),
      application: { status: 'submitted', submitted_at: '2026-10-27T20:49:00.000Z', cv: 'workspace/data/out/cv/share/jordan-example-cv-fractional-cto-delivery.pdf', attempts: [{ at: T, mode: 'submit', outcome: 'submitted', channel: 'easy' }] },
    }),
    9000000003: job('9000000003', {
      title: 'Interim IT Director', company: 'Initech',
      triage: tri({ tier: 'reject', score: 47, gates: gates('fail'), comp_seen: '$1,000-$1,200 per day DOE', red_flags: ["G4 fail, hard gate on insurance: 'Proven technology leadership experience within insurance to be considered for the role'", 'Unnamed client'] }),
    }),
    9000000004: job('9000000004', { title: 'Fractional Head of AI', company: 'Hooli Talent', triage: tri({ tier: 'C', score: 61, comp_seen: '$150/hr - $280/hr', red_flags: ["recruiter talent pool, not a live req: 'Apply today to express your interest'"] }) }),
    9000000005: job('9000000005', { title: 'Fractional CTO (older)', company: 'Globex', status: 'skipped', triage: tri({ score: 72, decision: 'skip', note: 'skip, apply to the newer posting' }) }),
    9000000006: job('9000000006', { title: 'Founding CTO', company: 'Umbrella Labs', status: 'watching', triage: tri({ score: 66, decision: 'watch', note: 'maybe later' }) }),
    9000000007: job('9000000007', { title: 'Head of Engineering', company: 'Soylent Systems', triage: tri({ tier: 'B', score: 74 }) }),
    9000000008: job('9000000008', {
      title: 'Fractional Head of Product', company: 'Globex Finance', status: 'shortlisted',
      triage: tri({ tier: 'B', score: 76, decision: 'pursue' }),
      application: { status: 'approved', approved_at: T, cv: 'x.pdf', attempts: [{ at: T, mode: 'submit', outcome: 'needs_answers', channel: 'easy',
        detail: [{ key: 'f0', label: 'Have you worked in financial services previously?*', options: ['Yes', 'No'], reason: 'no-answer' },
          { key: 'f1', label: 'Email*', options: ['jordan.alt@example.net', 'jordan@oldjob.example'], reason: 'no-matching-option' }] }] },
    }),
    9000000009: job('9000000009', { title: 'CTO', company: 'Initech Portal', status: 'shortlisted', triage: tri({ tier: 'A', score: 82, decision: 'pursue' }),
      application: { status: 'approved', approved_at: T, cv: 'x.pdf', ats_url: 'https://acme.wd5.myworkdayjobs.com/x', attempts: [{ at: T, mode: 'submit', outcome: 'manual', channel: 'workday', detail: 'Workday portal' }] } }),
    9000000010: job('9000000010', { title: 'VP Engineering', company: 'Hooli', status: 'applied', triage: tri({ tier: 'B', score: 70, decision: 'pursue' }),
      application: { status: 'submit-unverified', submitted_at: T, cv: 'x.pdf', attempts: [{ at: T, mode: 'submit', outcome: 'submit-unverified', channel: 'easy' }] } }),
    9000000011: job('9000000011', { title: 'Interim CTO', company: 'PE Co', status: 'dropped', triage: null, detail: null, prefilter: { verdict: 'drop', reasons: ['onsite'], flags: [] } }),
    9000000012: job('9000000012', { title: 'Co-Founder & CTO', company: 'Equity Co', status: 'dropped', triage: null, detail: null, prefilter: { verdict: 'drop', reasons: ['title-excluded'], flags: [] } }),
    9000000013: job('9000000013', { title: 'Interim CTO', company: 'Health Co', triage: tri({ tier: 'reject', score: 30, gates: gates('fail'), comp_seen: '$174.9K/yr - $279.9K/yr', red_flags: ["G4 fail: 'Must have knowledge of ITIL service management concepts.'"] }) }),
  },
};
const opportunities = [{ job_id: '9000000001', stage: 'applied', next_action: 'Follow up if no reply', next_action_due: '2026-11-03', applied_on: '2026-10-27' },
  { job_id: '9000000002', stage: 'screening', next_action: 'Prepare for call', next_action_due: '2026-10-29', applied_on: '2026-10-27' }];
const usage = {
  linkedin_jobs: { ticks_per_day: { count: 7, max: 20 }, searches_per_day: { count: 13, max: 24 }, job_views_per_day: { count: 21, max: 100 }, sweeps_per_day: { count: 2, max: 1 } },
  linkedin_apply: { applications_per_day: { count: 3, max: 3 }, apply_page_loads_per_day: { count: 14, max: 10 } },
  ats_apply: { applications_per_day: { count: 0, max: 3 } },
};
const runs = [
  { kind: 'sweep', at: '2026-10-27T14:11:58Z', label: 'Full sweep', summary: { searches: 5, new: 31, views: 12 }, aborted: null },
  { kind: 'tick', at: '2026-10-27T23:24:04Z', label: 'interim-part-time', summary: { searches: 1, new: 0, views: 1 }, aborted: null },
];
const claims = { C19: 'Hands-on: builds MVPs himself and codes in Claude Code and Codex.', C14: 'Builds and runs three AI products in production.' };
const variants = [{ slug: 'mvp-build', share: 'fractional-cto' }, { slug: 'dev-shop-audit', share: 'fractional-cto-delivery' }, { slug: 'life-sciences', share: 'fractional-cto-life-sciences' }];
const overrides = [{ at: '2026-10-27T20:54:00Z', cap: 'sweeps_per_day', reason: 'run another sweep now' }];
const model = () => build({ state, opportunities, usage, runs, claims, variants, overrides, now: NOW });
const assets = { sansWoff2: Buffer.from('sans'), monoWoff2: Buffer.from('mono'), title: 'Job hunt · Applications', wordmark: 'Jordan Example', kicker: 'Job hunt', accent: '#2F5D8A', tiers: { a: 80, b: 65 } };

test('comp parsing: hourly, daily and annual ranges; non-numeric text is null', () => {
  assert.deepEqual(parseComp('USD $150~$200/hour'), { unit: 'hour', min: 150, max: 200 });
  assert.deepEqual(parseComp('$150/hr - $280/hr'), { unit: 'hour', min: 150, max: 280 });
  assert.deepEqual(parseComp('$174.9K/yr - $279.9K/yr'), { unit: 'year', min: 174900, max: 279900 });
  assert.deepEqual(parseComp('$1,000-$1,200 per day DOE'), { unit: 'day', min: 1000, max: 1200 });
  assert.deepEqual(parseComp('$105/hr'), { unit: 'hour', min: 105, max: 105 });
  assert.deepEqual(parseComp('Up to $90+/hr'), { unit: 'hour', min: 90, max: 90, open: true });
  assert.equal(parseComp('Competitive combination of cash compensation and equity participation.'), null);
  assert.equal(parseComp(null), null);
});

test('opportunity frontmatter parses keys, quoted values and empty values', () => {
  const fm = parseFrontmatter('---\ntitle: X\nstage: applied\njob_id: "9000000077"\napplied_on: 2026-10-27\noffer_folder:\n---\n# body');
  assert.equal(fm.stage, 'applied');
  assert.equal(fm.job_id, '9000000077');
  assert.equal(fm.offer_folder, '');
});

test('applications: submitted and submitted-by-hand only, newest first, with stage, heard, CV share name and why', () => {
  const m = model();
  assert.deepEqual(m.applications.map((a) => a.id), ['9000000002', '9000000001']);
  const fan = m.applications.find((a) => a.id === '9000000001');
  assert.equal(fan.stage, 'applied');
  assert.deepEqual([fan.heard.kind, fan.next_due], ['none', undefined]);
  assert.equal(fan.cv, 'fractional-cto');
  assert.equal(fan.channel, 'Easy Apply');
  assert.match(fan.why, /Hands-on: builds MVPs himself/); // bare claim IDs resolved through the claim bank
  const studio = m.applications.find((a) => a.id === '9000000002');
  assert.equal(studio.stage, 'screening');
  assert.equal(studio.comp, 'USD $150~$200/hour');
  assert.equal(studio.hours, 'typically 5~10 hours/week');
  assert.match(studio.why, /dev-shop side/);
});

test('needs you: undecided A/B, needs_answers (labels only), manual hand-off with its link, unverified submit', () => {
  const m = model();
  const kinds = Object.fromEntries(m.needs.map((n) => [n.id, n.kind]));
  assert.deepEqual(kinds, { 9000000007: 'decision', 9000000008: 'needs_answers', 9000000009: 'manual', 9000000010: 'unverified' });
  const na = m.needs.find((n) => n.id === '9000000008');
  assert.deepEqual(na.questions, ['Have you worked in financial services previously?', 'Email']);
  assert.equal(m.needs.find((n) => n.id === '9000000009').link, 'https://acme.wd5.myworkdayjobs.com/x');
});

test('not a fit: failing gate and the quoted JD line; tier C logged with its reason', () => {
  const m = model();
  const ins = m.not_a_fit.find((r) => r.id === '9000000003');
  assert.deepEqual(ins.gates, ['G4']);
  assert.equal(ins.reason, 'Proven technology leadership experience within insurance to be considered for the role');
  assert.equal(ins.comp, '$1,000-$1,200 per day DOE');
  assert.deepEqual(m.logged.map((r) => r.id), ['9000000004']);
  assert.match(m.logged[0].reason, /^Recruiter talent pool/); // first letter capitalized for display
});

test('passed on: skip and watch with the note', () => {
  const m = model();
  assert.deepEqual(m.passed.map((p) => [p.id, p.decision, p.note]), [['9000000005', 'skip', 'skip, apply to the newer posting'], ['9000000006', 'watch', 'maybe later']]);
});

test('filtered before review: counts by prefilter reason, with the roles', () => {
  const m = model();
  assert.deepEqual(m.filtered.by_reason, [{ reason: 'On-site', count: 1 }, { reason: 'Title out of scope', count: 1 }]);
  assert.equal(m.filtered.items.length, 2);
});

test('status figures and the funnel for today', () => {
  const m = model();
  assert.equal(m.status.applied_total, 2);
  assert.equal(m.status.applied_week, 2);
  assert.equal(m.status.needs_you, 4);
  assert.equal(m.status.replies, 1);
  assert.equal(m.status.silent, 0);
  assert.equal(m.status.next_followup, undefined);
  const f = Object.fromEntries(m.funnel.today.map((s) => [s.key, s.count]));
  assert.deepEqual(f, { seen: 13, kept: 11, viewed: 11, triaged: 11, ab: 8, applied: 2 });
});

test('market read: hourly and annual ranges, day rates counted, structure and apply mix', () => {
  const m = model();
  assert.deepEqual(m.market.hourly, { n: 2, min: 150, max: 280, median: 195 }); // median of range midpoints
  assert.deepEqual(m.market.annual, { n: 1, min: 174900, max: 279900, median: 227400 });
  assert.equal(m.market.daily.n, 1);
  assert.equal(m.market.structure.Contract, 11);
  assert.equal(m.market.apply.easy, 11);
});

test('loop health and CV inventory', () => {
  const m = model();
  assert.equal(m.health.last.label, 'interim-part-time');
  assert.equal(m.health.runs_today, 2);
  assert.deepEqual(m.health.caps.find((c) => c.key === 'job_views_per_day'), { key: 'job_views_per_day', label: 'Job views', used: 21, max: 100 });
  assert.equal(m.health.overrides.length, 1);
  assert.deepEqual(m.cvs.find((c) => c.share === 'fractional-cto').sent_to, ['Acme Corp']);
});

test('summary prose: built from the data, no dashes, no banned words, sentence case headings', () => {
  const m = model();
  const prose = [...m.summary, ...m.headings, ...m.empty_states].join('\n');
  assert.match(m.summary.join(' '), /2 applications out/);
  assert.doesNotMatch(prose, /[–—]/);
  for (const w of BANNED) assert.doesNotMatch(prose, new RegExp(`\\b${w}\\b`, 'i'), w);
  for (const h of m.headings) assert.equal(h[0], h[0].toUpperCase(), h);
});

test('render: one self-contained HTML document, no script, brand tokens, square corners, every role linked with an anchor id', () => {
  const html = renderTrackerHtml(model(), assets);
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /@font-face[^}]*data:font\/woff2;base64,/);
  for (const t of ['#F4F4F2', '#1B1E23', '#50565F', '#D2D5DA', '#2F5D8A', '#2F6B4F', '#A3302A', 'var(--accent)']) assert.ok(html.includes(t), t);
  for (const m of html.matchAll(/border-radius:\s*(\d+)px/g)) assert.ok(Number(m[1]) <= 2, m[0]);
  for (const id of Object.keys(state.jobs)) assert.ok(html.includes(`https://www.linkedin.com/jobs/view/${id}/`), id);
  assert.ok(html.includes('id="job-9000000001"'));
  assert.match(html, /<header class="masthead"><span class="wordmark">Jordan Example<\/span>/);
  assert.match(html, /<title>Job hunt · Applications<\/title>/);
});

test('privacy: no answer-bank values, account emails, phone or standing rate reach the document', () => {
  const html = renderTrackerHtml(model(), assets);
  for (const s of ['jordan.alt@example.net', 'jordan@oldjob.example', '555-0100', '240000', 'Desired hourly rate']) assert.ok(!html.includes(s), s);
});

test('publish: first run creates, unchanged is a no-op, open comments stop the update, update uses --base', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === 'publish') return { code: 0, stdout: JSON.stringify({ docId: 'doc1', versionId: 'v1', url: 'https://bikeshed.now/d/doc1' }), stderr: '' };
    if (args[0] === 'comments') return { code: 0, stdout: JSON.stringify({ threads: [] }), stderr: '' };
    if (args[0] === 'update') return { code: 0, stdout: JSON.stringify({ versionId: 'v2', url: 'https://bikeshed.now/d/doc1' }), stderr: '' };
    return { code: 1, stdout: '', stderr: 'error: unknown' };
  };
  const first = await publishTracker({ html: '<a>', file: '/tmp/t.html', cfg: { folder_id: 'f1' }, st: {}, run, title: 'T' });
  assert.equal(first.status, 'created');
  assert.deepEqual(calls[0], ['publish', '/tmp/t.html', '--title', 'T', '--folder', 'f1', '--json']);
  assert.equal(first.cfg.doc_id, 'doc1');
  assert.equal(first.st.version, 'v1');
  const same = await publishTracker({ html: '<a>', file: '/tmp/t.html', cfg: first.cfg, st: first.st, run, title: 'T' });
  assert.equal(same.status, 'unchanged');
  const next = await publishTracker({ html: '<b>', file: '/tmp/t.html', cfg: first.cfg, st: first.st, run, title: 'T' });
  assert.equal(next.status, 'updated');
  assert.equal(next.st.version, 'v2');
  assert.deepEqual(calls.at(-1), ['update', 'doc1', '/tmp/t.html', '--base', 'v1', '--json']);
});

test('publish: open comments return them with no update; refusals and sign-in failures are classified', async () => {
  const withComments = async (args) => (args[0] === 'comments'
    ? { code: 0, stdout: JSON.stringify({ threads: [{ threadId: 't1', section: 'job-9000000007', quote: 'Head of Engineering', comments: [{ body: 'skip this one' }] }] }), stderr: '' }
    : assert.fail(`no ${args[0]} expected`));
  const c = await publishTracker({ html: '<c>', file: '/f', cfg: { doc_id: 'doc1' }, st: { version: 'v2', hash: 'old' }, run: withComments, title: 'T' });
  assert.equal(c.status, 'comments');
  assert.equal(c.threads[0].threadId, 't1');
  const refused = async (args) => (args[0] === 'comments' ? { code: 0, stdout: '{"threads":[]}', stderr: '' } : { code: 1, stdout: '', stderr: 'error: The document is open in the editor.' });
  assert.equal((await publishTracker({ html: '<d>', file: '/f', cfg: { doc_id: 'doc1' }, st: { version: 'v2' }, run: refused, title: 'T' })).status, 'refused');
  const auth = async () => ({ code: 1, stdout: '', stderr: 'error: That token was not accepted. Run `bikeshed login` again.' });
  assert.equal((await publishTracker({ html: '<e>', file: '/f', cfg: { doc_id: 'doc1' }, st: { version: 'v2' }, run: auth, title: 'T' })).status, 'auth');
});

test('publish: never at the bikeshed root; a first publish without a folder is refused before any call', async () => {
  const run = async () => assert.fail('no call expected');
  const r = await publishTracker({ html: '<a>', file: '/f', cfg: {}, st: {}, run, title: 'T' });
  assert.equal(r.status, 'no-folder');
});

test('funnel: a role viewed and dropped afterwards (hybrid found on the page) still counts as kept by the card prefilter', () => {
  const s = structuredClone(state);
  s.jobs['9000000014'] = job('9000000014', { triage: null, status: 'dropped', prefilter: { verdict: 'drop', reasons: ['hybrid-check-travel'], flags: [] } });
  const f = Object.fromEntries(build({ state: s, now: NOW }).funnel.today.map((x) => [x.key, x.count]));
  assert.ok(f.kept >= f.viewed, `kept ${f.kept} < viewed ${f.viewed}`);
});

test('summary: zero new roles reads as "no new roles"', () => {
  const m = build({ state, opportunities, runs, now: NOW });
  assert.ok(m.summary.some((x) => /found no new roles\./.test(x)), m.summary.join(' | '));
});

test('why it fits never uses a retired claim: retired bare IDs are skipped, and so is a reason that cites one', () => {
  const s = structuredClone(state);
  s.jobs['9000000001'].triage.why_fit = ['C20', 'C19', 'C14'];
  s.jobs['9000000002'].triage.why_fit = ['C09, C20, C44: carried it through bank pilots', 'C27, C28: bank vendor-risk reviews'];
  const retiredClaims = { ...claims, C20: '**Retired 2026-10-27 (marked false).** Was: carried a platform' };
  const m = build({ state: s, opportunities, claims: retiredClaims, retired: new Set(['C20']), now: NOW });
  const why = Object.fromEntries(m.applications.map((a) => [a.id, a.why]));
  assert.doesNotMatch(why['9000000001'], /Retired|carried a platform/);
  assert.match(why['9000000001'], /Hands-on: builds MVPs himself/);
  assert.equal(why['9000000002'], 'bank vendor-risk reviews');
});

test('outcomes: every role lands in exactly one bucket, and the buckets sum to the job count', () => {
  const m = model();
  const n = Object.fromEntries(m.outcomes.map((o) => [o.key, o.count]));
  assert.deepEqual(n, { applied: 2, waiting: 4, pending: 0, passed: 2, below: 1, notfit: 2, filtered: 2 });
  assert.equal(m.outcomes.reduce((s, o) => s + o.count, 0), Object.keys(state.jobs).length);
});

test('strip plot: every scored role once, and no two marks in one lane closer than 4 points', () => {
  const m = model();
  const scored = Object.values(state.jobs).filter((j) => j.triage).map((j) => j.job_id).sort();
  assert.deepEqual(m.scored.map((s) => s.id).sort(), scored);
  const lanes = {};
  for (const s of m.scored) (lanes[s.lane] ||= []).push(s.score);
  for (const xs of Object.values(lanes)) xs.forEach((x, i) => i && assert.ok(x - xs[i - 1] >= 4, `${xs}`));
  assert.equal(m.scored.find((s) => s.id === '9000000003').outcome, 'notfit');
});

test('activity: 14 local days ending today, today matching the funnel; funnel rows carry the share kept', () => {
  const m = model();
  assert.equal(m.activity.length, 14);
  assert.equal(m.activity.at(-1).day, '2026-10-27');
  const today = Object.fromEntries(m.funnel.today.map((s) => [s.key, s.count]));
  assert.equal(m.activity.at(-1).seen, today.seen);
  assert.equal(m.activity.at(-1).scored, today.triaged);
  assert.equal(m.activity.at(-1).applied, today.applied);
  const rows = Object.fromEntries(m.funnel.rows.map((r) => [r.key, r]));
  assert.equal(rows.seen.pct_prev, null);
  assert.equal(rows.applied.pct_prev, Math.round((100 * rows.applied.week) / rows.ab.week));
});

test('CV links: a CV with a bikeshed render links to it in the card and the inventory; one without stays plain text', () => {
  const url = 'https://bikeshed.now/d/cv-render-example';
  const withUrl = variants.map((v) => (v.slug === 'mvp-build' ? { ...v, url } : v));
  const m = build({ state, opportunities, runs, claims, variants: withUrl, now: NOW });
  assert.equal(m.applications.find((a) => a.id === '9000000001').cv_url, url);
  assert.equal(m.applications.find((a) => a.id === '9000000002').cv_url, null);
  const html = renderTrackerHtml(m, assets);
  assert.equal(html.split(`href="${url}"`).length - 1, 2); // Acme Corp's card and the inventory row
  assert.match(html, /<span class="mono">fractional-cto-delivery<\/span>/); // no render, no link
  assert.match(html, /<a href="#job-9000000001">Acme Corp<\/a>/);
});

test('cv_note from the opportunity shows as a flag on the application card', () => {
  const note = 'Sent CV predates the 27 Oct rebuild. Send the rebuilt PDF before any call.';
  const opps = opportunities.map((o) => (o.job_id === '9000000001' ? { ...o, cv_note: note } : o));
  const m = build({ state, opportunities: opps, runs, claims, variants, now: NOW });
  assert.equal(m.applications.find((a) => a.id === '9000000001').cv_note, note);
  assert.ok(renderTrackerHtml(m, assets).includes(`<p class="flag">${note}</p>`));
});

test('charts: each carries an aria-label with its numbers, no script, no SVG plot, labels without dashes or banned words', () => {
  const html = renderTrackerHtml(model(), assets);
  const figures = [...html.matchAll(/<figure class="chart ([\w-]+)"[^>]*>/g)];
  assert.deepEqual([...new Set(figures.map((f) => f[1]))].sort(), ['activity', 'bars', 'caps', 'comp', 'funnel', 'outcome', 'pulse', 'strip']);
  for (const kind of ['bars', 'caps', 'funnel', 'activity', 'pulse', 'strip']) {
    for (const f of figures.filter((x) => x[1] === kind)) assert.match(f[0], /aria-label="[^"]*\d/, kind);
  }
  assert.match(html, /role="img" aria-label="Where all 13 roles stand: 2 applied, 4 waiting on you/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal((html.match(/<svg/g) || []).length, 0); // no logo by default
  const labels = [...html.matchAll(/(?:aria-label|title)="([^"]*)"/g)].map((x) => x[1]).join('\n')
    + [...html.matchAll(/<p class="label">([^<]*)</g)].map((x) => x[1]).join('\n');
  assert.doesNotMatch(labels.replace(/[^\n]*Role \d+[^\n]*/g, ''), /[–—]/);
  for (const w of BANNED) assert.doesNotMatch(labels, new RegExp(`\\b${w}\\b`, 'i'), w);
});

test('charts: the strip plot links every dot to its posting; comp ranges and the timeline plot their data', () => {
  const html = renderTrackerHtml(model(), assets);
  assert.match(html, /<a class="dot o-applied" href="https:\/\/www\.linkedin\.com\/jobs\/view\/9000000001\/"[^>]*style="left:80%;/);
  assert.match(html, /<a class="dot o-notfit ring" href="https:\/\/www\.linkedin\.com\/jobs\/view\/9000000003\/"/);
  assert.match(html, /<span class="num">\$150 to \$200<\/span>/); // Globex, hourly
  assert.match(html, /<span class="num">\$174\.9K to \$279\.9K<\/span>/);
  assert.match(html, /class="pl-dot last" style="left:[\d.]+%" title="16:24 interim-part-time: 0 new roles · 1 view · guards clear"/);
  assert.match(html, /<td data-label="Stage"><span class="badge stage-screening">Screen<\/span><\/td>/);
});

test('Dice: source badge with the lane, Dice channel and evidence, Dice caps, short timeline marks, Dice halt', () => {
  const G = '11111111-1111-4111-8111-111111111111';
  const s = structuredClone(state);
  s.sources = { dice: { halt_until: '2026-10-28T11:00:00.000Z' } };
  s.jobs[`dice-${G}`] = job(`dice-${G}`, {
    source: 'dice', url: `https://www.dice.com/job-detail/${G}`, title: 'Lead Full Stack Engineer', company: 'Example Staffing LLC', status: 'applied',
    detail: { fetched_at: T, employment_type: 'Contract Corp To Corp', contract_types: ['c2c'], workplace: 'Remote', apply: { type: 'dice-easy' }, comp_text: '$70/hr' },
    triage: tri({ tier: 'A', score: 84, lane: 'hands-on', decision: 'pursue', archetype: 'lead-engineer-ai' }),
    application: { status: 'submitted', submitted_at: '2026-10-27T21:00:00.000Z', cv: 'workspace/data/out/cv/share/jordan-example-cv-lead-engineer-ai.pdf', attempts: [{ at: T, mode: 'submit', outcome: 'submitted', channel: 'dice-easy' }] },
  });
  const u = { ...usage, dice_jobs: { ticks_per_day: { count: 2, max: 20 }, searches_per_day: { count: 2, max: 24 }, job_views_per_day: { count: 6, max: 60 } }, dice_apply: { applications_per_day: { count: 1, max: 3 } } };
  const r = [...runs, { kind: 'tick', source: 'dice', at: '2026-10-27T23:27:00Z', label: 'Dice: canary', summary: { searches: 1, new: 4, views: 3 }, aborted: null }];
  const m = build({ state: s, opportunities, usage: u, runs: r, claims, variants, overrides, now: NOW });
  const a = m.applications.find((x) => x.id === `dice-${G}`);
  assert.equal(a.channel, 'Dice Easy Apply');
  assert.equal(a.evidence, 'Dice confirmation captured');
  assert.equal(a.source, 'dice');
  assert.ok(m.health.caps.some((c) => c.key === 'dice_views' && c.used === 6 && c.max === 60));
  assert.equal(m.health.dice_halt_until, '2026-10-28T11:00:00.000Z');
  assert.equal(m.health.timeline.runs.find((x) => x.source === 'dice').new, 4);
  // LinkedIn's structure mix leaves Dice's contract badges out.
  assert.equal(m.market.structure['Contract Corp To Corp'], undefined);
  const html = renderTrackerHtml(m, assets);
  assert.match(html, /<span class="badge src">Dice, hands-on<\/span>/);
  assert.match(html, /class="pl-dot hit last" style="left:[\d.]+%" title="16:27 Dice: canary: 4 new roles · 3 views · guards clear"[^>]*><span>4<\/span>/);
  assert.match(html, /Last check <span class="num">16:27<\/span> PT\. LinkedIn: interim-part-time, 0 new roles · 1 view · guards clear\. Dice: canary, 4 new roles · 3 views · guards clear\./);
  assert.match(html, /Dice halted until/);
  // LinkedIn cards carry no source badge.
  assert.doesNotMatch(html.slice(html.indexOf('id="job-9000000001"'), html.indexOf('id="job-9000000002"')), /badge src/);
});

test('loop pulse: lanes per source, the last firing, business-hour gaps, applications, and a newest-first log', () => {
  const m = model();
  const p = m.pulse;
  assert.deepEqual(p.runs.map((r) => [r.time, r.source]), [['07:11', 'linkedin'], ['16:24', 'linkedin']]);
  assert.deepEqual(p.last_firing.map((r) => r.time), ['16:24']);
  // Render time never enters the page: a later publish of the same data is byte-identical.
  const later = build({ state, opportunities, usage, runs, claims, variants, overrides, now: new Date(NOW.getTime() + 40 * 60 * 1000) });
  assert.equal(renderTrackerHtml(later, assets), renderTrackerHtml(m, assets));
  // 08:00 to 16:24 had no check: a gap, shown so a stalled loop is visible.
  assert.deepEqual(p.gaps, [{ from: 480, to: 984 }]);
  assert.deepEqual(p.apps.map((a) => [a.time, a.company]), [['13:47', 'Acme Corp'], ['13:49', 'Globex']]);
  const html = renderTrackerHtml(m, assets);
  assert.match(html, /<span class="pl-gap-label">no checks<br>08:00 to 16:24<\/span>/);
  assert.match(html, /<li class="gap"><time class="num">08:00<\/time><span class="badge gap">No check<\/span>/);
  assert.equal((html.match(/class="pl-gap"/g) || []).length, p.gaps.length); // drawn once, under all lanes
  assert.match(html, /<span class="pl-tag" style="left:[\d.]+%">last 16:24<\/span>/);
  assert.match(html, /class="pl-app" style="left:[\d.]+%" title="13:49 Applied: Fractional CTO \(Client-Facing\) @ Globex \(Easy Apply\)"/);
  const log = html.slice(html.indexOf('<ol class="pulse-log"'), html.indexOf('</ol>', html.indexOf('<ol class="pulse-log"')));
  assert.deepEqual([...log.matchAll(/<time class="num">([\d:]+)<\/time>/g)].map((x) => x[1]), ['16:24', '13:49', '13:47', '08:00', '07:11']); // the gap row sits at its start
  assert.match(log, /<li class="last"><time class="num">16:24<\/time>/);
  assert.match(html, /<section id="pulse"><div class="section-head"><span class="index">04<\/span><h2>Loop pulse<\/h2>/);
  // The funnel sits right under Status, the score strip and daily activity stay under Pipeline.
  const order = [...html.matchAll(/<section (?:class="hero" )?id="([\w-]+)"/g)].map((x) => x[1]);
  assert.deepEqual(order.slice(0, 4), ['status', 'funnel', 'summary', 'pulse']);
  const pipe = html.slice(html.indexOf('<section id="pipeline">'), html.indexOf('</section>', html.indexOf('<section id="pipeline">')));
  assert.ok(!pipe.includes('class="chart funnel"') && html.includes('<section id="funnel"><div class="section-head"><span class="index">02</span><h2>Funnel</h2>'));
});

test('loop pulse: business hours come from the tick schedule, so an earlier start shows earlier gaps', () => {
  const m = build({ state, opportunities, usage, runs, claims, variants, overrides, hours: { open: 300, close: 1080 }, now: NOW });
  assert.deepEqual(m.pulse.gaps, [{ from: 300, to: 431 }, { from: 431, to: 984 }]);
  assert.equal(m.pulse.start_h, 4);
  const html = renderTrackerHtml(m, assets);
  assert.match(html, /<span class="pl-gap-label">no checks<br>05:00 to 07:11<\/span>/);
  const x = (min) => +((100 * (min - 4 * 60)) / ((m.pulse.end_h - 4) * 60)).toFixed(2);
  assert.ok(html.includes(`<span class="pl-hours" style="left:${x(300)}%;width:${x(1080) - x(300)}%">`));
  // The injected 08:00-18:00 window.
  assert.deepEqual(model().pulse.gaps, [{ from: 480, to: 984 }]);
});

test('inbound recruiter role: an applied opportunity with no search record becomes a card, counted, with no dead link', () => {
  const inbound = { job_id: 'email-aaaa0000bbbb1111', role: 'Senior Architect, Enterprise Architecture', company: 'Staffco (staffing, client not named)',
    cv: 'enterprise-platform-architect', stage: 'applied', applied_on: '2026-10-30', applied_at: '2026-10-30T16:37:04Z', next_action: 'Expect the recruiter reply', next_action_due: '2026-11-04' };
  const base = model();
  const m = build({ state, opportunities: [...opportunities, inbound], usage, runs, claims, variants, overrides, now: NOW });
  assert.equal(m.status.applied_total, base.status.applied_total + 1);
  const card = m.applications.find((a) => a.id === inbound.job_id);
  assert.equal(card.source, 'email');
  assert.equal(card.channel, 'Recruiter email');
  assert.equal(card.title, inbound.role);
  const html = renderTrackerHtml(m, assets);
  assert.ok(html.includes('Recruiter email</span>'));
  assert.ok(!html.includes('href=""'));
  // An opportunity without an application date stays off the cards.
  const draft = build({ state, opportunities: [...opportunities, { ...inbound, applied_on: '', applied_at: '' }], usage, runs, claims, variants, overrides, now: NOW });
  assert.equal(draft.status.applied_total, base.status.applied_total);
});

test('next check names its day; only a check due today gets a mark on the clocks', () => {
  const at = (nextCheck) => build({ state, opportunities, usage, runs, claims, variants, overrides, nextCheck, now: NOW });
  const today = at('17:00');
  assert.equal(today.health.next_check, 'Tue 27 Oct, 17:00');
  assert.equal(today.pulse.next_min, 1020);
  assert.equal(at('2026-10-27 17:00').pulse.next_min, 1020);
  const monday = at('2026-11-02 08:00');
  assert.equal(monday.health.next_check, 'Mon 2 Nov, 08:00');
  assert.equal(monday.pulse.next_min, null);
  assert.equal(monday.health.timeline.next_min, null);
  const html = renderTrackerHtml(monday, assets);
  assert.match(html, /Next check about <span class="num">Mon 2 Nov, 08:00<\/span> PT\./);
  assert.ok(!html.includes('class="pl-next"'));
  assert.equal(at('soon').health.next_check, null);
});

test('not-a-fit table is collapsed by default under the gates chart', () => {
  const html = renderTrackerHtml(model(), assets);
  const sec = html.slice(html.indexOf('<section id="not-a-fit">'), html.indexOf('</section>', html.indexOf('<section id="not-a-fit">')));
  const n = model().not_a_fit.length;
  assert.ok(n > 0);
  assert.match(sec, new RegExp(`<details class="list"><summary>All ${n} roles that failed a gate</summary>`));
  assert.ok(!sec.includes('<details class="list" open'));
  assert.ok(sec.indexOf('Gates failed') < sec.indexOf('<details class="list">'));
});

test('waiting items are named and linked: card to Needs you, summary names to rows, hand-offs say which CV', () => {
  const m = model();
  assert.match(m.needs_summary, /^Waiting on you: /);
  for (const n of m.needs) assert.ok(m.needs_summary.includes(n.company || n.title), n.id);
  const html = renderTrackerHtml(m, assets);
  assert.match(html, /<a class="metric" href="#needs"><span class="readout">4<\/span><span class="metric-label">Waiting on you<\/span><\/a>/);
  const line = html.slice(html.indexOf('<a href="#needs">Waiting on you</a>'), html.indexOf('</li>', html.indexOf('<a href="#needs">Waiting on you</a>')));
  for (const n of m.needs) assert.ok(line.includes(`<a href="#job-${n.id}">`), n.id);
  for (const n of m.needs) assert.ok(html.includes(`<tr id="job-${n.id}">`), n.id);
  const manual = m.needs.find((n) => n.kind === 'manual');
  assert.match(html, new RegExp(`Open the form</a> and submit it by hand with the CV ${manual.cv}`));
});

test("pulse: the log is collapsed under the chart; dots, lanes, next mark and application diamonds carry instant hover tips", () => {
  const m = build({ state, opportunities, usage, runs, claims, variants, overrides, nextCheck: "17:00", now: NOW });
  const html = renderTrackerHtml(m, assets);
  const sec = html.slice(html.indexOf('<section id="pulse">'), html.indexOf("</section>", html.indexOf('<section id="pulse">')));
  const n = m.pulse.runs.length + m.pulse.apps.length;
  assert.match(sec, new RegExp(`<details class="list pulse-list"><summary>Every check and application today \\(${n}\\), newest first</summary><ol class="pulse-log"`));
  assert.ok(sec.indexOf('<figure class="chart pulse"') < sec.indexOf('<details class="list pulse-list">'));
  assert.match(sec, /class="pl-dot[^"]*"[^>]*data-tip="16:24 PT · LinkedIn · [^"]+"/);
  assert.match(sec, /class="pl-name" style="grid-row:1" title="LinkedIn today: [^"]+" data-tip=/);
  assert.match(sec, /class="pl-next"[^>]*data-tip="Next check about Tue 27 Oct, 17:00 PT"/);
  assert.match(sec, /<a class="pl-app" style="left:[\d.]+%" title="13:49 Applied: [^"]+" href="#job-9000000002" data-tip="13:49 PT · Applied: [^"]+Click for the card"><i><\/i><\/a>/);
});

test("a cover letter sent with an application links from its card; an unpublished one says so", () => {
  const s = JSON.parse(JSON.stringify(state));
  s.jobs["9000000001"].application.cover_pdf = "workspace/data/applications/9000000001/letter.pdf";
  s.jobs["9000000002"].application.cover_pdf = "workspace/data/applications/9000000002/letter.pdf";
  const m = build({ state: s, opportunities, usage, runs, claims, variants, overrides, letters: { 9000000001: "https://bikeshed.now/d/letter-acme" }, now: NOW });
  const html = renderTrackerHtml(m, assets);
  const row = (id) => html.slice(html.indexOf(`<tr id="job-${id}"`), html.indexOf("</tr>", html.indexOf(`<tr id="job-${id}"`)));
  assert.match(row("9000000001"), /Letter: <a class="mono" href="https:\/\/bikeshed.now\/d\/letter-acme"[^>]*>Open the letter ↗<\/a>/);
  assert.match(row("9000000002"), /Letter: Sent, not published yet/);
  const plain = build({ state, opportunities, usage, runs, claims, variants, overrides, now: NOW });
  assert.ok(!renderTrackerHtml(plain, assets).includes("Letter: "));
});

test('needs you: an approved role later skipped is no card (nothing sent, then "Skip": it must not stay Queued)', () => {
  const st = structuredClone(state);
  st.jobs['9000000099'] = job('9000000099', { status: 'skipped', triage: tri({ tier: 'A', score: 88, decision: 'skip', decided_at: T, note: 'Skip' }),
    application: { status: 'approved', approved_at: T, cv: 'workspace/data/out/cv/share/jordan-example-cv-mvp-build.pdf', attempts: [{ at: T, mode: 'submit', outcome: 'submit-unverified', channel: 'ashby', detail: 'no confirmation' }] } });
  const m = build({ state: st, opportunities, usage, runs, claims, variants, overrides, now: NOW });
  assert.equal(m.needs.find((n) => n.id === '9000000099'), undefined);
});

// Inbox scan cards (docs/inbox-scan-design.md).
const mailThread = (o = {}) => ({
  thread_id: 'th1', file: '20261027-acme-fractional-cto.md', status: 'draft', kind: 'reply', firm: 'Acme Corp', sender_name: 'Dana', reply_to: 'dana@acme.example', subject: 'Next steps for Fractional CTO',
  job_id: '9000000001', opportunity: null, cv: 'workspace/data/out/cv/share/jordan-example-cv-fractional-cto.pdf', new_cv: false, action: 'Fill [TIMES] and send', draft_at: T, notified: false, claims: [], audit: null,
  emails: [{ at: T, from_name: 'Dana', summary: 'Asks for two call slots this week.' }], draft: 'Hi Dana,\n\nI can talk [TIMES].\n\nJordan', sent: [], ...o,
});
const withMail = (mail) => build({ state, opportunities, usage, runs, claims, variants, overrides, mail, now: NOW });

test('mail: a draft thread becomes a Reply card', () => {
  const html = renderTrackerHtml(withMail([mailThread()]), assets);
  const row = html.slice(html.indexOf('<tr id="mail-th1">'), html.indexOf('</tr>', html.indexOf('<tr id="mail-th1">')));
  assert.ok(row.length > 0, 'row missing');
  for (const s of ['Acme Corp', 'Next steps for Fractional CTO', 'Asks for two call slots this week.', 'href="#job-9000000001"', 'CV: <span class="mono">fractional-cto</span>', 'Reply']) assert.ok(row.includes(s), s);
  assert.match(row, /<details class="draft"><summary>Draft reply<\/summary><pre>Hi Dana,\n\nI can talk \[TIMES\]\.\n\nJordan<\/pre><\/details>/);
  assert.ok(!html.includes('dana@acme.example'));
});

test('mail card strips addresses and phones from summary', () => {
  const html = renderTrackerHtml(withMail([mailThread({ emails: [{ at: T, from_name: 'Dana', summary: 'Asks to call me at (415) 555-0100 or pat@initech.example today.' }] })]), assets);
  assert.ok(html.includes('<tr id="mail-th1">') && html.includes('Asks to call me at'), 'card missing');
  assert.ok(!html.includes('555-0100') && !html.includes('pat@initech.example'));
});

test('I9: phones in any format and addresses in the sender or firm never reach the page', () => {
  const html = renderTrackerHtml(withMail([mailThread({ firm: 'Initech | 732-555-0199', sender_name: 'riley@acme.example', emails: [{ at: T, from_name: 'Riley', summary: 'Call 4155550100, +91 98765 43210, +91-9876543210, +44 20 7946 0958 or 415 5550100.' }] })]), assets);
  assert.ok(html.includes('<tr id="mail-th1">'));
  for (const s of ['4155550100', '98765 43210', '9876543210', '7946 0958', '415 5550100', '732-555-0199', 'riley@acme.example']) assert.ok(!html.includes(s), s);
});

test('applications: one compact table, the newest 10 on page 1, the rest paged in the same table', () => {
  const s2 = JSON.parse(JSON.stringify(state));
  const base = s2.jobs['9000000001'];
  for (let i = 0; i < 10; i++) {
    const id = String(9100000000 + i);
    s2.jobs[id] = { ...JSON.parse(JSON.stringify(base)), job_id: id, title: `Role ${id}`, url: `https://www.linkedin.com/jobs/view/${id}/` };
    s2.jobs[id].application.submitted_at = new Date(Date.parse('2026-10-26T18:00:00Z') + i * 60000).toISOString();
  }
  const m = build({ state: s2, opportunities, usage, runs, claims, variants, overrides, now: NOW });
  const html = renderTrackerHtml(m, assets);
  const sec = html.slice(html.indexOf('<section id="applications">'), html.indexOf('</section>', html.indexOf('<section id="applications">')));
  assert.ok(sec.includes('<table class="data-table apps-table">') && !html.includes('<article class="app-card"'));
  const rows = [...sec.matchAll(/<tr id="job-(\d+)" data-p="(\d+)">/g)].map((x) => [x[1], Number(x[2])]);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map((r) => r[0]), m.applications.map((a) => a.id));
  assert.deepEqual(rows.map((r) => r[1]), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2]);
  assert.match(sec, /<input type="radio" name="apps-page" id="ap-1" checked>/);
  assert.match(sec, /<label for="ap-2">11–12<\/label>/);
  assert.ok(html.includes('.apps:has(#ap-2:checked) tr[data-p]:not([data-p="2"]):not(:target){display:none}'));
  const one = renderTrackerHtml(build({ state, opportunities, usage, runs, claims, variants, overrides, now: NOW }), assets);
  assert.ok(!one.includes('<input type="radio" name="apps-page"'), 'one page needs no pager');
});

test('inbound card: a date-only applied_on shows on that local day', () => {
  const o = { job_id: 'email-abc', role: 'AI Engineer', company: 'Hooli via Staffco', cv: 'ai-architect', stage: 'applied', applied_on: '2026-10-27' };
  const m = build({ state, opportunities: [...opportunities, o], usage, runs, claims, variants, overrides, now: NOW });
  const html = renderTrackerHtml(m, assets);
  const row = html.slice(html.indexOf('<tr id="job-email-abc"'), html.indexOf('</tr>', html.indexOf('<tr id="job-email-abc"')));
  assert.match(row, /<td data-label="Applied"><span class="num">today<\/span><span class="sub num">27 Oct<\/span><\/td>/);
  assert.match(row, /<td data-label="After post">By email<\/td>/);
});

// The Applied column says how long ago, and After post how soon after the posting went up.
const speedState = () => {
  const s2 = JSON.parse(JSON.stringify(state));
  s2.jobs['9000000001'].detail.posted_text = '40 minutes ago';
  s2.jobs['9000000002'].detail.posted_text = 'Reposted 3 hours ago';
  const base = s2.jobs['9000000001'];
  s2.jobs['9200000001'] = { ...JSON.parse(JSON.stringify(base)), job_id: '9200000001', title: 'Day-old role', detail: { ...base.detail, posted_text: '1 day ago' } };
  s2.jobs['9200000001'].application.submitted_at = '2026-10-27T22:00:00.000Z';
  s2.jobs['dice-x1'] = { ...JSON.parse(JSON.stringify(base)), job_id: 'dice-x1', source: 'dice', title: 'AI Architect', url: 'https://www.dice.com/job-detail/x1',
    detail: { ...base.detail, posted_text: '2 hours ago', date_posted: '2026-10-27T18:30:00.000Z' } };
  s2.jobs['dice-x1'].application.submitted_at = '2026-10-27T21:00:00.000Z';
  s2.jobs['dice-x1'].application.attempts[0].channel = 'dice-easy';
  return s2;
};
const rowOf = (html, id) => html.slice(html.indexOf(`<tr id="job-${id}"`), html.indexOf('</tr>', html.indexOf(`<tr id="job-${id}"`)));

test('applications: Applied says how long ago as of the page time, with the local date and time', () => {
  const m = build({ state: speedState(), opportunities, usage, runs, claims, variants, overrides, now: NOW });
  const html = renderTrackerHtml(m, assets);
  assert.match(html, /<th scope="col">Applied<\/th><th scope="col">After post<\/th><th scope="col">Role<\/th>/);
  // as of the newest event (the 23:24 run): 20:47 is 2h 37m earlier
  assert.match(rowOf(html, '9000000001'), /<td data-label="Applied"><span class="num">2h ago<\/span><span class="sub num">27 Oct, 13:47<\/span><\/td>/);
  assert.match(rowOf(html, 'dice-x1'), /<td data-label="Applied"><span class="num">2h ago<\/span><span class="sub num">27 Oct, 14:00<\/span><\/td>/);
});

test('applications: After post is exact from a Dice post date or LinkedIn minutes, a range in the unit LinkedIn gave', () => {
  const html = renderTrackerHtml(build({ state: speedState(), opportunities, usage, runs, claims, variants, overrides, now: NOW }), assets);
  const cell = (id) => rowOf(html, id).match(/<td data-label="After post"[^>]*>(.*?)<\/td>/)[1];
  // Dice 18:30 -> 21:00
  assert.match(cell('dice-x1'), /^<span class="num">2h 30m<\/span>$/);
  // "40 minutes ago" at 20:00 -> posted 19:20, applied 20:47
  assert.match(cell('9000000001'), /^<span class="num">1h 27m<\/span>$/);
  // "Reposted 3 hours ago" at 20:00 means 3 to 4 hours before; applied 49m later: 3h49m to 4h49m
  assert.match(cell('9000000002'), /^<span class="num">4–5h<\/span><span class="sub">Reposted<\/span>$/);
  // "1 day ago" at 20:00, applied 2h later: 1d2h to 2d2h
  assert.match(cell('9200000001'), /^<span class="num">1–2d<\/span>$/);
  assert.match(rowOf(html, '9000000001'), /<td data-label="After post" title="Posted 27 Oct, 12:20 PT">/);
  assert.match(rowOf(html, '9000000002'), /<td data-label="After post" title="LinkedIn showed “Reposted 3 hours ago” on 27 Oct, 13:00 PT">/);
});

test('applications: the ages do not depend on the render time, so an unchanged state stays a no-op', () => {
  const at = (now) => renderTrackerHtml(build({ state: speedState(), opportunities, usage, runs, claims, variants, overrides, now }), assets);
  const sec = (html) => html.slice(html.indexOf('<section id="applications">'), html.indexOf('</section>', html.indexOf('<section id="applications">')));
  assert.equal(sec(at(NOW)), sec(at(new Date(NOW.getTime() + 5 * 3600e3))));
});

// "Heard" shows only what happened: the latest email on the role's thread, or how long it has
// been silent. There is no follow-up column: the loop never messages on LinkedIn or Dice.
const LATER = new Date('2026-11-04T01:00:00Z'); // Tue 3 Nov 17:00 PST, 5 business days after 27 Oct
const heardHtml = (html, id) => { const i = html.indexOf(`<tr id="job-${id}"`); const row = html.slice(i, html.indexOf('</tr>', i)); return row.slice(row.indexOf('data-label="Heard"')); };

test('heard: no linked mail reads as no reply yet with the business days since applying, and no next-action text reaches the page', () => {
  const m = build({ state, opportunities, runs, now: LATER });
  const a = m.applications.find((x) => x.id === '9000000001');
  assert.deepEqual([a.heard.kind, a.heard.days], ['none', 5]);
  const html = renderTrackerHtml(m, assets);
  assert.match(heardHtml(html, '9000000001'), /^data-label="Heard">No reply yet<span class="sub num">5 business days<\/span>/);
  assert.match(html, /<th scope="col">Heard<\/th>/);
  for (const s of ['Follow up if no reply', 'Prepare for call', 'data-label="Next"', 'Next action']) assert.ok(!html.includes(s), s);
});

test('heard: a reply stage with no thread reads as replied, and is never counted silent', () => {
  const m = build({ state, opportunities, runs, now: LATER });
  const a = m.applications.find((x) => x.id === '9000000002');
  assert.equal(a.heard.kind, 'them');
  assert.equal(m.status.silent, 1);
  assert.equal(m.status.replies, 1);
});

test('heard: the latest email on a linked thread wins, receipts are ignored, and only their email after the submit counts as a reply', () => {
  const thread = (o) => ({ thread_id: 'th1', status: 'sent', kind: 'reply', firm: 'Acme Corp', sender_name: 'Dana Example', subject: 'Fractional CTO', job_id: '9000000001', emails: [], sent: [], ...o });
  const at = (mail) => build({ state, opportunities, runs, mail, now: LATER });
  const dana = [{ at: '2026-10-28T17:00:00Z', from_name: 'Dana Example', summary: 'Asks the rate.' }];
  let m = at([thread({ emails: dana, sent: [{ at: '2026-10-28T19:00:00Z', text: 'Hi' }] })]);
  let a = m.applications.find((x) => x.id === '9000000001');
  assert.deepEqual([a.heard.kind, a.heard.at], ['you', '2026-10-28T19:00:00Z']);
  assert.equal(m.status.replies, 2);
  assert.equal(m.status.silent, 0);
  assert.match(heardHtml(renderTrackerHtml(m, assets), '9000000001'), /^data-label="Heard">You replied<span class="sub num">Wed 28 Oct<\/span><span class="sub">No answer yet<\/span>/);

  m = at([thread({ status: 'draft', emails: dana })]);
  a = m.applications.find((x) => x.id === '9000000001');
  assert.deepEqual([a.heard.kind, a.heard.who, a.heard.card], ['them', 'Dana Example', 'mail-th1']);
  assert.match(heardHtml(renderTrackerHtml(m, assets), '9000000001'), /^data-label="Heard">Dana Example wrote<span class="sub num">Wed 28 Oct<\/span><a class="sub" href="#mail-th1">Reply waiting<\/a>/);

  m = at([thread({ kind: 'receipt', status: 'no-reply', emails: dana })]);
  assert.equal(m.applications.find((x) => x.id === '9000000001').heard.kind, 'none');

  m = at([thread({ kind: 'outreach-fit', emails: [{ at: '2026-10-27T18:00:00Z', from_name: 'Dana Example', summary: 'Pitches the role.' }], sent: [{ at: '2026-10-27T20:47:00Z', text: 'Hi' }] })]);
  assert.equal(m.applications.find((x) => x.id === '9000000001').heard.kind, 'you');
  assert.equal(m.status.replies, 1, 'their outreach before the submit is not a reply');
});

test('heard: a rejection thread or a lost stage reads as rejected and is not a reply', () => {
  const rej = { thread_id: 'th2', status: 'no-reply', kind: 'rejection', firm: 'Acme Corp', sender_name: 'Acme Corp', subject: 'Update', job_id: '9000000001', emails: [{ at: '2026-10-29T17:00:00Z', from_name: 'Acme Corp', summary: 'Not moving forward.' }], sent: [] };
  let m = build({ state, opportunities, runs, mail: [rej], now: LATER });
  let a = m.applications.find((x) => x.id === '9000000001');
  assert.deepEqual([a.heard.kind, a.heard.at], ['rejected', '2026-10-29T17:00:00Z']);
  assert.equal(m.status.replies, 1);
  assert.match(heardHtml(renderTrackerHtml(m, assets), '9000000001'), /^data-label="Heard">Rejected<span class="sub num">Thu 29 Oct<\/span>/);
  m = build({ state, opportunities: [{ ...opportunities[0], stage: 'lost' }, opportunities[1]], runs, now: LATER });
  a = m.applications.find((x) => x.id === '9000000001');
  assert.equal(a.heard.kind, 'rejected');
  assert.equal(m.status.silent, 0);
});

test('summary and headline: replies counted against applications out, silent roles counted, no follow-up line', () => {
  const m = build({ state, opportunities, runs, now: LATER });
  const text = m.summary.join(' ');
  assert.match(text, /A person replied on 1 of 2\. 1 has had no reply for 5 or more business days\./);
  assert.doesNotMatch(text, /follow-up|Next action/i);
  const html = renderTrackerHtml(m, assets);
  assert.match(html, /<span class="readout">1<\/span><span class="metric-label">No reply in 5\+ business days<\/span>/);
});

test('heard: on an outreach thread a second pitch after the submit is not a reply, an answer after the user wrote is', () => {
  const pitch = (emails, sent) => ({ thread_id: 'th3', status: 'sent', kind: 'outreach-fit', firm: 'Acme Corp', sender_name: 'Sam Recruiter', subject: 'AI Engineer', job_id: '9000000001', emails, sent });
  const second = { at: '2026-10-28T15:00:00Z', from_name: 'Sam Recruiter', summary: 'Sends the same seat again.' };
  let m = build({ state, opportunities, runs, mail: [pitch([second], [{ at: '2026-10-28T21:00:00Z', text: 'Hi' }])], now: LATER });
  assert.equal(m.status.replies, 1);
  m = build({ state, opportunities, runs, mail: [pitch([second, { at: '2026-10-29T16:00:00Z', from_name: 'Sam Recruiter', summary: 'Shares the W2 range.' }], [{ at: '2026-10-28T21:00:00Z', text: 'Hi' }])], now: LATER });
  assert.equal(m.status.replies, 2);
  assert.equal(m.applications.find((x) => x.id === '9000000001').heard.kind, 'them');
});

// Interviews and rejections in the funnel: booked and held interviews, and rejections set apart.
const ivLine = (xs) => JSON.stringify(xs);
const ivOpps = () => [
  { ...opportunities[0], interviews: ivLine([{ at: '2026-10-29T10:00', booked_on: '2026-10-27', status: 'booked', round: 'Recruiter screen', with: 'Dana Example' }]) },
  { ...opportunities[1], interviews: ivLine([
    { at: '2026-10-27T09:30', booked_on: '2026-10-23', status: 'held', round: 'Hiring manager', with: 'Pat Manager' },
    { at: '2026-10-21T11:00', booked_on: '2026-10-19', status: 'canceled', round: 'Intro', with: 'Pat Manager' }, // booked before the 7 days
  ]) },
];
const funnelSlice = (html) => html.slice(html.indexOf('<figure class="chart funnel"'), html.indexOf('</figure>', html.indexOf('<figure class="chart funnel"')));
const sectionOf = (html, id) => html.slice(html.indexOf(`<section id="${id}">`), html.indexOf('</section>', html.indexOf(`<section id="${id}">`)));

test('interviews: the opportunity line is parsed as JSON; a missing line, bad JSON or a bad entry means none, never a throw', () => {
  const fm = parseFrontmatter('---\njob_id: "1"\ninterviews: [{"at":"2026-11-09T13:00","booked_on":"2026-11-06","status":"held","round":"Recruiter screen","with":"Sam Recruiter"}]\n---\n# x');
  assert.equal(typeof fm.interviews, 'string');
  assert.deepEqual(parseInterviews(fm.interviews), [{ at: '2026-11-09T13:00', booked_on: '2026-11-06', status: 'held', round: 'Recruiter screen', with: 'Sam Recruiter' }]);
  for (const bad of [undefined, null, '', 'null', '[{"at":', '{"at":"2026-11-09T13:00","status":"held"}', '[1, "x", null]', '[{"at":"soon","status":"booked"}]', '[{"at":"2026-13-45T99:99","status":"booked"}]', '[{"at":"2026-11-09T13:00","status":"maybe"}]']) {
    assert.deepEqual(parseInterviews(bad), [], String(bad));
  }
  assert.deepEqual(parseInterviews('[{"at":"2026-11-11T09:50","booked_on":"soon","status":"Booked"}]'), [{ at: '2026-11-11T09:50', booked_on: null, status: 'booked', round: null, with: null }]);
  const opps = [{ ...opportunities[0], interviews: '[{"at":' }, opportunities[1]];
  assert.doesNotThrow(() => build({ state, opportunities: opps, now: NOW }));
  assert.deepEqual(build({ state, opportunities: opps, now: NOW }).interviews, []);
});

test('interviews: local wall-clock times map to the right instant on both sides of the DST change', () => {
  const opps = [{ ...opportunities[0], interviews: ivLine([{ at: '2026-10-27T09:30', booked_on: '2026-10-27', status: 'booked' }, { at: '2026-11-09T13:00', booked_on: '2026-11-06', status: 'booked' }]) }];
  const m = build({ state, opportunities: opps, now: NOW });
  assert.deepEqual(m.interviews.map((i) => i.at_iso), ['2026-10-27T16:30:00.000Z', '2026-11-09T21:00:00.000Z']);
});

test('funnel: Interview booked counts by booking day, Interview held by interview time, each kept against the row above', () => {
  const m = build({ state, opportunities: ivOpps(), now: NOW });
  assert.deepEqual(m.funnel.rows.map((r) => r.key), ['seen', 'kept', 'viewed', 'triaged', 'ab', 'applied', 'booked', 'held', 'rejected']);
  const rows = Object.fromEntries(m.funnel.rows.map((r) => [r.key, r]));
  assert.deepEqual([rows.booked.label, rows.booked.week, rows.booked.today, rows.booked.pct_prev], ['Interview booked', 2, 1, 100]);
  assert.deepEqual([rows.held.label, rows.held.week, rows.held.today, rows.held.pct_prev], ['Interview held', 1, 1, 50]);
  // The search stages behind the activity cross-check stay as they were.
  assert.deepEqual(m.funnel.today.map((s) => s.key), ['seen', 'kept', 'viewed', 'triaged', 'ab', 'applied']);
  const fn = funnelSlice(renderTrackerHtml(m, assets));
  assert.match(fn, /<div class="frow f-booked" title="Interview booked: 2 in 7 days, 1 today"><span class="flabel">Interview booked<\/span>/);
  assert.match(fn, /<div class="frow f-held" title="Interview held: 1 in 7 days, 1 today">.*?<span class="num muted">50%<\/span><\/div>/);
  assert.match(fn, /<div class="frow f-applied" /);
});

test('funnel: Rejected counts rejection emails and lost roles on the tracker by date, as a share of Applied, set apart in red', () => {
  const rej = (id, at) => ({ thread_id: `r${id}`, status: 'no-reply', kind: 'rejection', firm: 'X', sender_name: 'X', subject: 'Update', job_id: id, emails: [{ at, from_name: 'X', summary: 'Not moving forward.' }], sent: [] });
  const mail = [rej('9000000001', '2026-10-27T17:00:00Z'), rej('9000000007', '2026-10-27T18:00:00Z')]; // 9000000007 was never applied to
  const lostOn = (updated) => [opportunities[0], { ...opportunities[1], stage: 'lost', ...(updated ? { updated } : {}) }];
  const m = build({ state, opportunities: lostOn('2026-10-25'), mail, now: NOW });
  const r = m.funnel.rows.find((x) => x.key === 'rejected');
  assert.deepEqual([r.label, r.week, r.today, r.pct_prev, r.pct_applied], ['Rejected', 2, 1, null, 100]);
  const at = (opps) => build({ state, opportunities: opps, now: NOW }).funnel.rows.find((x) => x.key === 'rejected');
  assert.deepEqual([at(lostOn('2026-10-12')).week, at(lostOn('2026-10-12')).today], [0, 0]); // lost before the 7 days
  assert.deepEqual([at(lostOn(null)).week, at(lostOn(null)).today], [1, 1]); // no updated date: the application date
  const html = renderTrackerHtml(m, assets);
  const fn = funnelSlice(html);
  assert.match(fn, /<div class="frow f-rejected" title="Rejected: 2 in 7 days, 1 today, 100% of Applied"><span class="flabel">Rejected<\/span>.*?<span class="num muted">100%<\/span><\/div>/);
  const note = fn.match(/<p class="note">([^<]*)<\/p>/)[1];
  assert.match(note, /Rejected[^.]*share of Applied/);
  assert.doesNotMatch(note, /[;–—]/);
  assert.match(html, /\.funnel \.frow\.f-rejected\{[^}]*var\(--red\)/);
});

test('applications: a rejected application carries a Rejected stage badge on a tinted row, the others keep theirs', () => {
  const rej = { thread_id: 'r1', status: 'no-reply', kind: 'rejection', firm: 'Acme Corp', sender_name: 'Acme Corp', subject: 'Update', job_id: '9000000001', emails: [{ at: '2026-10-27T17:00:00Z', from_name: 'Acme Corp', summary: 'Not moving forward.' }], sent: [] };
  const html = renderTrackerHtml(build({ state, opportunities: [opportunities[0], { ...opportunities[1], stage: 'lost' }], mail: [rej], now: NOW }), assets);
  for (const id of ['9000000001', '9000000002']) {
    assert.match(rowOf(html, id), new RegExp(`^<tr id="job-${id}" class="rejected">`), id);
    assert.match(rowOf(html, id), /<td data-label="Stage"><span class="badge stage-rejected">Rejected<\/span><\/td>/, id);
  }
  const plain = renderTrackerHtml(model(), assets);
  assert.match(rowOf(plain, '9000000001'), /^<tr id="job-9000000001">/);
  assert.match(rowOf(plain, '9000000002'), /<span class="badge stage-screening">Screen<\/span>/);
  assert.match(html, /\.badge\.stage-rejected\{[^}]*var\(--red\)/);
  assert.match(html, /\.apps-table tr\.rejected/);
});

test('interview list under the funnel: upcoming first, then held, local date and time, role @ company linked to its card, round, interviewer, status', () => {
  const m = build({ state, opportunities: [ivOpps()[0], { ...opportunities[1], interviews: ivLine([
    { at: '2026-10-27T09:30', booked_on: '2026-10-23', status: 'held', round: 'Hiring manager', with: 'Pat Manager' },
    { at: '2026-10-28T11:00', booked_on: '2026-10-26', status: 'booked', round: 'Panel', with: 'Pat Manager' },
    { at: '2026-10-20T09:00', booked_on: '2026-10-19', status: 'held', round: 'Intro', with: 'Ann Example' },
  ]) }], now: NOW });
  assert.deepEqual(m.interviews.map((i) => [i.id, i.status, i.at]), [['9000000002', 'booked', '2026-10-28T11:00'], ['9000000001', 'booked', '2026-10-29T10:00'],
    ['9000000002', 'held', '2026-10-27T09:30'], ['9000000002', 'held', '2026-10-20T09:00']]);
  const sec = sectionOf(renderTrackerHtml(m, assets), 'funnel');
  assert.ok(sec.indexOf('class="chart funnel"') < sec.indexOf('<table class="data-table interviews">'));
  const body = sec.slice(sec.indexOf('<tbody>'));
  assert.match(body, /^<tbody><tr><td data-label="When"><span class="num">Wed 28 Oct, 11:00 PT<\/span><\/td><th scope="row"><a href="#job-9000000002">Fractional CTO \(Client-Facing\) @ Globex<\/a><\/th><td data-label="Round">Panel<\/td><td data-label="With">Pat Manager<\/td><td data-label="Status"><span class="badge iv-booked">Booked<\/span><\/td><\/tr>/);
  assert.match(body, /<span class="num">Tue 27 Oct, 09:30 PT<\/span><\/td><th scope="row"><a href="#job-9000000002">[^<]+<\/a><\/th><td data-label="Round">Hiring manager<\/td><td data-label="With">Pat Manager<\/td><td data-label="Status"><span class="badge iv-held">Held<\/span>/);
  // No interviews on file: a plain empty line, no table.
  const none = sectionOf(renderTrackerHtml(model(), assets), 'funnel');
  assert.ok(none.includes('<p class="empty">No interviews yet.</p>') && !none.includes('data-table interviews'));
});

test('interview list: an address, a phone number or a meeting link in the round or interviewer never reaches the page', () => {
  const opps = [{ ...opportunities[0], interviews: ivLine([{ at: '2026-10-29T10:00', booked_on: '2026-10-27', status: 'booked',
    round: 'Recruiter screen https://us02web.zoom.us/j/8123456789?pwd=abc', with: 'Dana Example <dana@acme.example> (415) 555-0100' },
  { at: '2026-10-30T10:00', booked_on: '2026-10-27', status: 'booked', round: 'Panel meet.google.com/abc-defg-hij', with: 'Riley, +91 98765 43210' }]) }];
  const html = renderTrackerHtml(build({ state, opportunities: opps, now: NOW }), assets);
  for (const s of ['dana@acme.example', '555-0100', 'zoom.us', '8123456789', 'pwd=', 'meet.google.com', 'abc-defg-hij', '98765']) assert.ok(!html.includes(s), s);
  const body = sectionOf(html, 'funnel');
  assert.match(body, /<td data-label="Round">Recruiter screen<\/td><td data-label="With">Dana Example<\/td>/);
  assert.match(body, /<td data-label="Round">Panel<\/td><td data-label="With">Riley<\/td>/);
});

test('interviews show the card stage as Screen while the file still says applied; a canceled interview alone does not', () => {
  const card = (iv) => build({ state, opportunities: [{ ...opportunities[0], interviews: ivLine([iv]) }, opportunities[1]], now: NOW }).applications.find((a) => a.id === '9000000001');
  assert.equal(card({ at: '2026-10-29T10:00', booked_on: '2026-10-27', status: 'booked' }).stage, 'screening');
  assert.equal(card({ at: '2026-10-27T09:00', booked_on: '2026-10-26', status: 'held' }).stage, 'screening');
  assert.equal(card({ at: '2026-10-29T10:00', booked_on: '2026-10-27', status: 'canceled' }).stage, 'applied');
  const html = renderTrackerHtml(build({ state, opportunities: ivOpps(), now: NOW }), assets);
  assert.match(rowOf(html, '9000000001'), /<td data-label="Stage"><span class="badge stage-screening">Screen<\/span><\/td>/);
});

// ---------- workspace defaults, neutral brand, new sections ----------

test('defaults come from the fixture profile: its time zone and label, its tick hours, its caps reset, and the operator name', () => {
  const m = buildTracker({ state, opportunities, usage, runs, claims, variants, overrides, now: NOW });
  assert.equal(m.tz, 'America/Chicago');
  assert.equal(m.tz_label, 'CT');
  assert.equal(m.pulse.open, 420); // tick_start 07:00
  assert.equal(m.health.reset_label, '04:00');
  assert.equal(m.operator, 'Jordan Example');
  assert.match(m.as_of_label, / CT$/);
  const html = renderTrackerHtml(m, { sansWoff2: Buffer.from('s'), monoWoff2: Buffer.from('m') });
  assert.match(html, /<span class="wordmark">Jordan Example<\/span>/); // preferences.brand.wordmark
  assert.match(html, /<title>Job hunt · Applications<\/title>/); // config/tracker.json title
  assert.match(html, /:root\{--accent:#2F5D8A\}/);
  assert.match(html, /Daily caps, reset 04:00 CT/);
  assert.doesNotMatch(html, / PT\b/);
});

test('zone labels: a short generic name where one exists, else the offset', () => {
  assert.equal(zoneLabel('America/Los_Angeles'), 'PT');
  assert.equal(zoneLabel('America/New_York'), 'ET');
  assert.equal(zoneLabel('UTC'), 'UTC');
  assert.match(zoneLabel('Europe/Berlin', '2026-07-01T12:00:00Z'), /^GMT\+2$/);
});

test('brand: a bad accent is ignored, a good one overrides the default, and the CSS is read only at render', () => {
  const m = model();
  assert.ok(!renderTrackerHtml(m, { ...assets, accent: 'red;}body{color:lime' }).includes('color:lime'));
  assert.match(renderTrackerHtml(m, { ...assets, accent: '#123456' }), /:root\{--accent:#123456\}/);
  assert.match(renderTrackerHtml(m, { ...assets, css: '.probe{}' }), /<style>@font-face[^<]*\.probe\{\}/);
  assert.match(renderTrackerHtml(m, { ...assets, wordmark: '' }), /<span class="wordmark">Job hunt<\/span>/); // falls back to the title
});

test('labels name the operator: hand submits, inbound replies, cap overrides and the ask-type prefilter reasons', () => {
  const s = structuredClone(state);
  s.jobs['9000000001'].application.attempts = [{ at: T, mode: 'by-hand', outcome: 'submitted-by-hand' }];
  s.jobs['9000000011'].prefilter.reasons = ['onsite-metro-ask'];
  const m = build({ state: s, opportunities, usage, runs, claims, variants, overrides, operator: 'Jordan', now: NOW });
  assert.equal(m.applications.find((a) => a.id === '9000000001').evidence, 'Submitted by Jordan');
  assert.ok(m.filtered.by_reason.some((r) => r.reason === 'Office in the home metro, Jordan decides'));
  assert.match(renderTrackerHtml(m, assets), /Cap overrides today, each on Jordan&#39;s instruction/);
});

test('run labels: a query label wins, else the id in words; the canary is marked', () => {
  const labels = runLabels([{ canary: { id: 'core-ai' }, queries: [{ id: 'fractional-titles', label: 'Fractional titles' }, { id: 'interim-part-time' }] }, { queries: [{ id: 'dice-python-llm' }] }]);
  assert.deepEqual(labels, { 'dice-sweep': 'every Dice query', 'core-ai': 'canary: core ai', 'fractional-titles': 'Fractional titles', 'interim-part-time': 'interim part time', 'dice-python-llm': 'python llm' });
});

test('caps: every cap in config/limits.json, known ones by name, unknown ones named from their keys', () => {
  const rows = capRows({ _comment: 'x', linkedin_jobs: { job_views_per_day: { max: 9 } }, board_x: { posts_per_day: { max: 2 } } });
  assert.deepEqual(rows.map((r) => [r[2], r[3]]), [['job_views_per_day', 'Job views'], ['board_x.posts_per_day', 'Board x posts']]);
  const m = build({ state, usage: { linkedin_jobs: { job_views_per_day: { count: 3 } } }, limits: { linkedin_jobs: { job_views_per_day: { max: 9 } } }, now: NOW });
  assert.deepEqual(m.health.caps, [{ key: 'job_views_per_day', label: 'Job views', used: 3, max: 9 }]);
});

test('needs you: a tailored CV and letter waiting for approval is a card linking the review doc, and it says when the role needs a decision too', () => {
  const s = structuredClone(state);
  s.jobs['9000000007'].application = { attempts: [], docs_review: { status: 'pending' } };
  s.jobs['9000000008'].application.docs_review = 'approved';
  const reviews = { 9000000007: { doc_id: 'rev1', url: 'https://bikeshed.now/d/review-1' }, 9000000013: { doc_id: 'rev2', url: 'https://bikeshed.now/d/review-2' } };
  const m = build({ state: s, opportunities, usage, runs, claims, variants, overrides, reviews, now: NOW });
  const card = m.needs.find((n) => n.id === '9000000007');
  assert.deepEqual([card.kind, card.link, card.also_decide], ['docs_review', 'https://bikeshed.now/d/review-1', true]);
  assert.equal(m.needs.find((n) => n.id === '9000000013').kind, 'docs_review'); // listed in review-docs.json, not yet approved
  assert.equal(m.needs.find((n) => n.id === '9000000008').kind, 'needs_answers'); // approved documents: back to its own card
  assert.match(m.needs_summary, /CVs and letters to approve \(/);
  const html = renderTrackerHtml(m, assets);
  const row = html.slice(html.indexOf('<tr id="job-9000000007">'), html.indexOf('</tr>', html.indexOf('<tr id="job-9000000007">')));
  assert.match(row, /<span class="badge need">Approve CV and letter<\/span>/);
  assert.match(row, /<a href="https:\/\/bikeshed\.now\/d\/review-1"[^>]*>the review document<\/a>/);
  // tailor.mjs lists one document per part: the card links the CV and the letter separately.
  const nested = { 9000000007: { cv: { doc_id: 'c1', url: 'https://bikeshed.now/d/cv-1' }, letter: { doc_id: 'l1', url: 'https://bikeshed.now/d/letter-1' } } };
  const m2 = build({ state: s, opportunities, usage, runs, claims, variants, overrides, reviews: nested, now: NOW });
  const card2 = m2.needs.find((n) => n.id === '9000000007');
  assert.deepEqual([card2.link, card2.letter_link], ['https://bikeshed.now/d/cv-1', 'https://bikeshed.now/d/letter-1']);
  const html2 = renderTrackerHtml(m2, assets);
  assert.match(html2, />the CV<\/a> and <a href="https:\/\/bikeshed\.now\/d\/letter-1"[^>]*>the cover letter<\/a>/);
  assert.match(row, /still needs your Apply, Watch or Skip/);
  // Once approved, the card goes.
  s.jobs['9000000007'].application.docs_approved_at = T;
  assert.notEqual(build({ state: s, reviews, now: NOW }).needs.find((n) => n.id === '9000000007')?.kind, 'docs_review');
});

test('recent activity: the action log newest first, roles linked to their rows, the tracker publishes left out, addresses scrubbed', () => {
  const actions = [
    { at: '2026-10-27T20:40:00.000Z', actor: 'user', action: 'triage.decided', job_id: '9000000001', detail: 'pursue: strong fit' },
    { at: '2026-10-27T20:46:00.000Z', actor: 'user', action: 'triage.approved', job_id: '9000000001', detail: 'cv jordan-example-cv-fractional-cto.pdf' },
    { at: '2026-10-27T22:00:00.000Z', actor: 'agent', action: 'mail.recorded', job_id: null, detail: { kind: 'reply', from: 'someone@initech.example' } },
    { at: '2026-10-27T23:00:00.000Z', actor: 'script', action: 'tracker.updated', detail: 'x' },
  ];
  const m = build({ state, opportunities, usage, runs, claims, variants, overrides, actions, now: NOW });
  assert.deepEqual(m.activity_log.map((a) => a.action), ['mail recorded', 'triage approved', 'triage decided']);
  assert.equal(m.activity_log[1].anchor, 'job-9000000001');
  assert.equal(m.activity_log[0].detail, 'kind reply, from [address]');
  const html = renderTrackerHtml(m, assets);
  assert.ok(HEADINGS.includes('Recent activity'));
  const sec = sectionOf(html, 'activity');
  assert.match(sec, /<h2>Recent activity<\/h2>/);
  assert.match(sec, /<td data-label="Who"><span class="badge actor">You<\/span><\/td><th scope="row">triage approved<\/th><td data-label="Role"><a href="#job-9000000001">Fractional CTO @ Acme Corp<\/a><\/td>/);
  assert.ok(!sec.includes('tracker updated'));
  // An unchanged log keeps the page byte-identical; a tracker publish alone changes nothing.
  const again = build({ state, opportunities, usage, runs, claims, variants, overrides, actions: [...actions, { at: '2026-10-27T23:30:00.000Z', actor: 'script', action: 'tracker.updated' }], now: NOW });
  assert.equal(renderTrackerHtml(again, assets), html);
  assert.match(sectionOf(renderTrackerHtml(model(), assets), 'activity'), /<p class="empty">Nothing logged yet\.<\/p>/);
});

test('banned words: the generic list, extended from preferences.voice.banned', () => {
  assert.ok(BANNED.includes('seamless') && !BANNED.includes('tailored'));
  assert.deepEqual(bannedWords(['Rockstar']).slice(-1), ['rockstar']);
  assert.deepEqual(bannedWords([]), BANNED);
});

test('publish: a missing bikeshed CLI is an error, not a retryable refusal', async () => {
  const run = async () => ({ code: 127, stdout: '', stderr: 'bikeshed CLI not found: run npm ci' });
  assert.equal((await publishTracker({ html: '<x>', file: '/f', cfg: { doc_id: 'doc1' }, st: {}, run, title: 'T' })).status, 'error');
});

test('comment watch: new threads and new comments once each, a still-empty thread once as typing, CLI replies never', () => {
  const meta = { doc: 'doc1', kind: 'tracker' };
  const t1 = { threadId: 't1', section: 'job-9000000007', quote: 'Head of Engineering', comments: [{ author: { name: 'Jordan Example' }, body: 'skip this one', createdAt: '2026-10-27T20:00:00Z' }] };
  const t2 = { threadId: 't2', section: 'needs', quote: 'Queued', comments: [{ author: 'Jordan Example', body: '' }] };
  let r = watchEvents([t1, t2], {}, meta);
  assert.deepEqual(r.events, [
    { doc: 'doc1', kind: 'tracker', thread_id: 't1', section: 'job-9000000007', quote: 'Head of Engineering', text: 'skip this one', author: 'Jordan Example', at: '2026-10-27T20:00:00Z' },
    { doc: 'doc1', kind: 'tracker', thread_id: 't2', section: 'needs', quote: 'Queued', text: '', author: 'Jordan Example', at: null, typing: true },
  ]);
  r = watchEvents([t1, t2], r.seen, meta);
  assert.deepEqual(r.events, []); // nothing new, and the typing thread is not repeated
  const t1b = { ...t1, comments: [...t1.comments, { author: 'Jordan Example', body: 'Done, skipped.', via: 'cli' }, { author: 'Jordan Example', body: 'thanks' }] };
  const t2b = { ...t2, comments: [{ author: 'Jordan Example', body: 'apply' }] };
  r = watchEvents([t1b, t2b], r.seen, meta);
  assert.deepEqual(r.events.map((e) => [e.thread_id, e.text]), [['t1', 'thanks'], ['t2', 'apply']]);
  assert.deepEqual(watchEvents([t1b, t2b], r.seen, meta).events, []);
});
