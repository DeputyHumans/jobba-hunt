// Entrypoint gates, end to end: each command runs against a throwaway copy of the synthetic
// workspace and must refuse before any browser starts. Nothing here launches a browser: every
// case stops at a gate (a halt, the pause, a cap) or writes state only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

const FUTURE = '2099-01-01T00:00:00.000Z';

function workspace() {
  const home = mkdtempSync(join(tmpdir(), 'jobba-gates-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  const data = join(home, 'data');
  mkdirSync(join(data, 'state'), { recursive: true });
  return { home, data };
}

const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2)); };
const jobsState = (extra = {}) => ({ _schema: 2, query_runs: {}, sources: {}, jobs: {}, ...extra });
const pause = (ws) => writeJson(join(ws.home, 'config', 'pause.json'), { paused: true, reason: 'CV refresh', since: '2026-11-18', by: 'operator' });
// A verified copy of a template query set: the live paths refuse an unverified one first.
function verified(ws, name) {
  const t = JSON.parse(readFileSync(join(CODE_ROOT, 'templates', 'workspace', 'config', name), 'utf8'));
  writeJson(join(ws.home, 'config', name), { ...t, verified: true, verified_at: '2026-11-01T00:00:00Z', verified_by: 'test' });
}

function cli(ws, script, ...args) {
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', script), ...args], {
    cwd: CODE_ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, JOBBA_HOME: ws.home, JOBBA_DATA_DIR: ws.data, JOBBA_LIMITS_LOG: join(ws.data, 'state', 'limits-log.json'), JOBBA_NO_BROWSER: '1' },
  });
  const last = r.stdout.trim().split('\n').pop() || '{}';
  return { code: r.status, json: JSON.parse(last), stderr: r.stderr };
}

// ---------- D6: triage record ----------

test('triage record: a results file with a bad row exits 1, and the good rows are still recorded', () => {
  const ws = workspace();
  const job = (id) => ({ job_id: id, title: 'Head of Platform', company: 'Acme Corp', status: 'viewed', detail: { fetched_at: '2026-11-01T10:00:00Z', description_text: 'A real posting.' } });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ jobs: { 9000000001: job('9000000001'), 9000000002: job('9000000002') } }));
  const row = (id, score) => ({ job_id: id, lane: 'leadership', archetype: 'platform', score, gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, dimensions: {}, why_fit: ['x'], gaps: [], red_flags: [] });
  const file = join(ws.data, 'results.json');
  writeJson(file, [row('9000000001', 80), row('9000000002', 300)]);
  const r = cli(ws, 'record-triage.mjs', 'record', '--file', file);
  assert.equal(r.code, 1, 'any reported error exits 1');
  assert.equal(r.json.success, false);
  assert.ok(r.json.errors.length >= 1);
  assert.deepEqual(r.json.applied, ['9000000001']);
});

// ---------- D11: pause and halt outside the ticks ----------

test('sweep: refuses while paused (exit 4) and while halted (exit 2), before any browser', () => {
  const ws = workspace();
  verified(ws, 'searches.json');
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  pause(ws);
  const p = cli(ws, 'sweep-jobs.mjs');
  assert.equal(p.code, 4);
  assert.equal(p.json.paused, true);
  assert.match(p.json.reason, /paused: CV refresh/);
  writeJson(join(ws.home, 'config', 'pause.json'), { paused: false });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ halt_until: FUTURE }));
  const h = cli(ws, 'sweep-jobs.mjs');
  assert.equal(h.code, 2);
  assert.equal(h.json.halted, true);
});

test('probe: a live probe refuses while paused (exit 4) or halted (exit 5); the dry run still plans', () => {
  const ws = workspace();
  const probe = join(ws.home, 'config', 'probes', 'gate-probe.json');
  writeJson(probe, { name: 'gate-probe', tpr_seconds: 604800, defaults: { geo: 'us', workplace: 'remote' }, views: [], searches: [{ id: 'P1', keywords: 'head of platform' }] });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  pause(ws);
  assert.equal(cli(ws, 'probe-searches.mjs', '--file', probe, '--dry-run').code, 0, 'a dry run launches no browser and stays allowed');
  const p = cli(ws, 'probe-searches.mjs', '--file', probe);
  assert.equal(p.code, 4);
  assert.equal(p.json.paused, true);
  writeJson(join(ws.home, 'config', 'pause.json'), { paused: false });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ halt_until: FUTURE }));
  const h = cli(ws, 'probe-searches.mjs', '--file', probe);
  assert.equal(h.code, 5);
  assert.equal(h.json.halted, true);
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ sources: { dice: { halt_until: FUTURE } } }));
  const d = cli(ws, 'probe-searches.mjs', '--file', probe, '--source', 'dice');
  assert.equal(d.code, 5, 'a Dice probe waits on the Dice halt');
});

test('reader CLIs: search and view refuse while paused or halted; limits still answers', () => {
  const ws = workspace();
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ halt_until: FUTURE }));
  const li = cli(ws, 'linkedin-jobs.mjs', 'view', '--id', '9000000001');
  assert.equal(li.code, 1);
  assert.equal(li.json.halted, true);
  assert.equal(cli(ws, 'linkedin-jobs.mjs', 'limits').code, 0);
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ sources: { dice: { halt_until: FUTURE } } }));
  const dv = cli(ws, 'dice-jobs.mjs', 'search', '--query', 'platform');
  assert.equal(dv.code, 1);
  assert.equal(dv.json.halted, true);
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  pause(ws);
  const ls = cli(ws, 'linkedin-jobs.mjs', 'search', '--query', 'platform');
  assert.equal(ls.code, 1);
  assert.equal(ls.json.paused, true);
  const dl = cli(ws, 'dice-jobs.mjs', 'view', '--id', 'dice-00000000-0000-0000-0000-000000000001');
  assert.equal(dl.code, 1);
  assert.equal(dl.json.paused, true);
});

// ---------- D12: the Dice sweep cap ----------

test('dice-tick --sweep: refused once dice_jobs sweeps_per_day is used up', () => {
  const ws = workspace();
  verified(ws, 'dice-searches.json');
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  writeJson(join(ws.data, 'state', 'limits-log.json'), [{ timestamp: new Date().toISOString(), platform: 'dice_jobs', actionType: 'sweeps_per_day', sweepId: 'earlier' }]);
  const r = cli(ws, 'dice-tick.mjs', '--sweep');
  assert.equal(r.code, 2);
  assert.equal(r.json.refused, true);
  assert.equal(r.json.cap, 'sweeps_per_day');
});

test('dice-tick records a sweep against sweeps_per_day', () => {
  const src = readFileSync(join(CODE_ROOT, 'scripts', 'dice-tick.mjs'), 'utf8');
  assert.match(src, /recordPost\('dice_jobs', 'sweeps_per_day'/);
});

// ---------- D5: auto --dry-run shows the letter blocker ----------

test('triage auto --dry-run lists the missing generated cover letter, like the real run', () => {
  const ws = workspace();
  const job = { job_id: '9000000001', title: 'Head of Engineering', company: 'Acme Corp', status: 'triaged', detail: { fetched_at: '2026-11-01T10:00:00Z', description_text: 'A real posting.', apply: { type: 'easy' } },
    triage: { score: 90, tier: 'A', lane: 'leadership', gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, archetype: 'platform-lead', decision: null } };
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ jobs: { 9000000001: job } }));
  const tpl = JSON.parse(readFileSync(join(CODE_ROOT, 'templates', 'workspace', 'config', 'apply.json'), 'utf8'));
  writeJson(join(ws.home, 'config', 'apply.json'), { ...tpl, verified: { ...tpl.verified, easy: true }, auto_apply: { ...tpl.auto_apply, enabled: true, channels: ['easy'], cover_letter: { easy: 'generated' } } });
  const dry = cli(ws, 'record-triage.mjs', 'auto', '--id', '9000000001', '--dry-run');
  assert.equal(dry.code, 2);
  assert.ok(dry.json.blockers.some((b) => /needs a generated cover letter/.test(b)), dry.json.blockers.join(' | '));
});

// ---------- D1: a tailored set for a role outside the job state ----------

test('approve-docs: an email or recruiter role known only by its tailor.json records the approval there; jobs.json is untouched', () => {
  const ws = workspace();
  const id = 'email-18c2f0a9b7d3e4f1';
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  const before = readFileSync(join(ws.data, 'state', 'jobs.json'), 'utf8');
  const rec = join(ws.data, 'applications', id, 'tailor.json');
  writeJson(rec, { job_id: id, company: 'Hooli', title: 'Staff Engineer', status: 'drafting', docs: null });
  const early = cli(ws, 'record-triage.mjs', 'approve-docs', '--id', id, '--note', 'approve');
  assert.equal(early.code, 1, 'nothing built yet: nothing to approve');
  writeJson(rec, { job_id: id, company: 'Hooli', title: 'Staff Engineer', status: 'review', docs: { slug: 'x', cv: { share: 'staff' } } });
  assert.equal(cli(ws, 'record-triage.mjs', 'approve-docs', '--id', id).code, 1, 'the operator\'s words are required');
  const r = cli(ws, 'record-triage.mjs', 'approve-docs', '--id', id, '--note', 'approve, send it');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.job_state, false);
  const after = JSON.parse(readFileSync(rec, 'utf8'));
  assert.deepEqual([after.status, after.docs_note], ['approved', 'approve, send it']);
  assert.ok(after.docs_approved_at);
  assert.equal(readFileSync(join(ws.data, 'state', 'jobs.json'), 'utf8'), before);
  assert.equal(cli(ws, 'record-triage.mjs', 'approve-docs', '--id', 'email-nope', '--note', 'approve').code, 1, 'an id with neither state nor tailor.json is unknown');
});

// ---------- D18: the next tick never lands inside the jitter gap ----------

test('a refused tick still names a next_tick_at past the jitter floor', () => {
  const ws = workspace();
  verified(ws, 'searches.json');
  // A one-minute gap: only the jitter floor can push the next tick past the limiter's gap.
  const cfgPath = join(ws.home, 'config', 'searches.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeJson(cfgPath, { ...cfg, tick: { ...cfg.tick, gap_seconds: [60, 60] } });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  const last = new Date(Date.now() - 5 * 60000).toISOString();
  writeJson(join(ws.data, 'state', 'limits-log.json'), [{ timestamp: last, platform: 'linkedin_jobs', actionType: 'ticks_per_day', tickId: 'earlier' }]);
  const r = cli(ws, 'tick.mjs', '--dry-run');
  assert.ok(r.json.next_tick_at, JSON.stringify(r.json));
  const tpl = JSON.parse(readFileSync(join(CODE_ROOT, 'templates', 'workspace', 'config', 'limits.json'), 'utf8'));
  const floor = Date.parse(last) + tpl.linkedin_jobs.ticks_per_day.jitterMin * 60000;
  assert.ok(Date.parse(r.json.next_tick_at) >= floor + 60000, `next_tick_at ${r.json.next_tick_at} is past the floor`);
});

// ---------- letter approaches: the pick and the review gate ----------

const fixtureLetter = (f) => JSON.parse(readFileSync(join(CODE_ROOT, 'tests', 'fixtures', 'letters', `${f}.json`), 'utf8'));
const setPrefs = (ws, tailoring) => {
  const p = join(ws.home, 'profile', 'preferences.json');
  const prefs = JSON.parse(readFileSync(p, 'utf8'));
  writeJson(p, { ...prefs, tailoring: { ...(prefs.tailoring || {}), ...tailoring } });
};
// A built tailored set for job 9000000201 whose letter is the given fixture.
function tailoredSet(ws, f, { approved = false } = {}) {
  const id = '9000000201';
  const dir = join(ws.data, 'applications', id);
  const letter = { ...fixtureLetter(f), job_id: id };
  writeJson(join(dir, 'cover-letter.json'), letter);
  for (const name of ['cv.pdf', 'cv.html', 'letter.pdf', 'letter.html']) writeFileSync(join(dir, name), 'x');
  writeFileSync(join(dir, 'cover-letter.txt'), 'x');
  const terms = 'Kubernetes\nCI/CD\n';
  writeFileSync(join(dir, 'jd.terms.txt'), terms);
  writeJson(join(dir, 'tailor.json'), { job_id: id, company: letter.company, title: letter.role, status: 'built', terms_hash: createHash('sha256').update(terms).digest('hex').slice(0, 16), baseline: { pct: 60 }, rounds: [{ slug: 't', pct: 80 }],
    docs: { slug: 't', cv: { share: 'staff', share_pdf: `$JOBBA_DATA_DIR/applications/${id}/cv.pdf`, html: `$JOBBA_DATA_DIR/applications/${id}/cv.html` }, letter: { pdf: `$JOBBA_DATA_DIR/applications/${id}/letter.pdf`, html: `$JOBBA_DATA_DIR/applications/${id}/letter.html` } } });
  const job = { job_id: id, title: letter.role, company: letter.company, status: 'shortlisted', detail: { fetched_at: '2026-11-01T10:00:00Z', description_text: 'A real posting.', apply: { type: 'easy' } },
    triage: { score: 90, tier: 'A', lane: 'leadership', gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, archetype: 'platform-lead', decision: 'pursue' },
    application: { status: 'approved', approved_at: '2026-11-01T10:00:00Z', attempts: [], cv: `$JOBBA_DATA_DIR/applications/${id}/cv.pdf`, cover_pdf: `$JOBBA_DATA_DIR/applications/${id}/letter.pdf`, ...(approved ? { docs_approved_at: '2026-11-01T11:00:00Z' } : {}) } };
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ jobs: { [id]: job } }));
  return id;
}

test('build-cover: a fixed tailoring.letter refuses another approach; per-job needs approach_why', () => {
  const ws = workspace();
  const dir = join(ws.data, 'applications', '9000000102');
  writeJson(join(dir, 'cover-letter.json'), fixtureLetter('b-first-two-weeks'));
  setPrefs(ws, { letter: 'A' });
  const r = cli(ws, 'build-cover.mjs', '--job', '9000000102');
  assert.equal(r.code, 1);
  assert.match(r.json.errors.join(' | '), /tailoring.letter is A/);
  setPrefs(ws, { letter: 'per-job' });
  const { approach_why, ...noWhy } = fixtureLetter('b-first-two-weeks');
  writeJson(join(dir, 'cover-letter.json'), noWhy);
  assert.match(cli(ws, 'build-cover.mjs', '--job', '9000000102').json.errors.join(' | '), /approach_why/);
});

test('tailor review: a B or C letter goes to review even under tailoring.review auto; A and D keep the standing decision', () => {
  const ws = workspace();
  writeJson(join(ws.home, 'config', 'tracker.json'), { publisher: 'local' });
  setPrefs(ws, { review: 'auto', letter: 'per-job' });
  const id = tailoredSet(ws, 'b-first-two-weeks');
  const b = cli(ws, 'tailor.mjs', 'review', '--job', id);
  assert.equal(b.code, 0, JSON.stringify(b.json));
  assert.equal(b.json.review, 'session', 'publisher local: shown to the operator, not auto-approved');
  assert.match(b.json.reason || '', /approach B/);
  const ws2 = workspace();
  setPrefs(ws2, { review: 'auto', letter: 'per-job' });
  const id2 = tailoredSet(ws2, 'd-lean-ps');
  const d = cli(ws2, 'tailor.mjs', 'review', '--job', id2);
  assert.deepEqual([d.code, d.json.review, d.json.approved], [0, 'auto', true]);
});

test('auto and the runner: an unapproved B or C letter blocks; an approved one does not', () => {
  const ws = workspace();
  setPrefs(ws, { review: 'auto', letter: 'per-job' });
  const id = tailoredSet(ws, 'c-three-questions');
  const r = cli(ws, 'record-triage.mjs', 'auto', '--id', id, '--dry-run');
  assert.ok(r.json.blockers.some((b) => /letter approach C needs the operator's review/.test(b)), r.json.blockers.join(' | '));
  const run = cli(ws, 'apply-job.mjs', '--job', id);
  assert.equal(run.code, 2);
  assert.match(run.json.reason, /letter approach C needs the operator's review/);
  const ok = workspace();
  setPrefs(ok, { review: 'auto', letter: 'per-job' });
  const id2 = tailoredSet(ok, 'c-three-questions', { approved: true });
  assert.ok(!cli(ok, 'record-triage.mjs', 'auto', '--id', id2, '--dry-run').json.blockers.some((b) => /letter approach/.test(b)));
});

test('tailor status reports the tailor.json approval of a role outside the job state', () => {
  const ws = workspace();
  const id = 'email-18c2f0a9b7d3e4f2';
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  const terms = 'Kubernetes\n';
  writeFileSync(join(ws.data, 'jd.terms.txt'), terms);
  const dir = join(ws.data, 'applications', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'jd.terms.txt'), terms);
  writeJson(join(dir, 'tailor.json'), { job_id: id, status: 'review', terms_hash: createHash('sha256').update(terms).digest('hex').slice(0, 16), docs: { slug: 'x' } });
  assert.equal(cli(ws, 'tailor.mjs', 'status', '--job', id).json.approved, false);
  assert.equal(cli(ws, 'record-triage.mjs', 'approve-docs', '--id', id, '--note', 'approve').code, 0);
  assert.equal(cli(ws, 'tailor.mjs', 'status', '--job', id).json.approved, true);
});

test('doctor: the vault row finds op through JOBBA_OP_BIN or config op.bin, not only on PATH', () => {
  const ws = workspace();
  writeJson(join(ws.home, 'config', 'vault.json'), { adapter: 'op', op: { bin: process.execPath } });
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', 'doctor.mjs'), '--offline', '--json'], {
    cwd: CODE_ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, JOBBA_HOME: ws.home, JOBBA_DATA_DIR: ws.data, PATH: '/usr/bin:/bin' },
  });
  const rows = JSON.parse(r.stdout.trim().split('\n').pop()).rows;
  const vault = rows.find((x) => x.group === 'vault');
  assert.equal(vault.status, 'ok', JSON.stringify(vault));
  const bs = rows.find((x) => /bikeshed/.test(x.fix || ''));
  if (bs) assert.doesNotMatch(bs.fix, /--origin/);
});


// ---------- halts: a probe abort halts its source; the operator clears a halt by command ----------

test('jobs and dice clear-halt: only with the operator\'s words; it clears that source alone and logs halt.cleared', () => {
  const ws = workspace();
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ halt_until: FUTURE, sources: { dice: { halt_until: FUTURE } } }));
  assert.equal(cli(ws, 'linkedin-jobs.mjs', 'clear-halt').code, 1, 'needs --note with the operator\'s words');
  const r = cli(ws, 'linkedin-jobs.mjs', 'clear-halt', '--note', 'clear it, I logged in by hand');
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual([r.json.cleared, r.json.was], [true, FUTURE]);
  const st = JSON.parse(readFileSync(join(ws.data, 'state', 'jobs.json'), 'utf8'));
  assert.deepEqual([st.halt_until, st.sources.dice.halt_until], [null, FUTURE], 'Dice stays halted');
  const log = readFileSync(join(ws.data, 'log', 'actions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const row = log.find((x) => x.action === 'halt.cleared');
  assert.deepEqual([row.actor, row.source], ['user', 'linkedin']);
  const d = cli(ws, 'dice-jobs.mjs', 'clear-halt', '--note', 'clear Dice too');
  assert.deepEqual([d.code, d.json.cleared], [0, true]);
  assert.equal(cli(ws, 'dice-jobs.mjs', 'clear-halt', '--note', 'again').json.cleared, false, 'nothing to clear');
});

test('a probe guard abort halts its source; its own cap stop does not', async () => {
  const { haltsSource } = await import('../scripts/lib/tick-plan.mjs');
  assert.deepEqual(['checkpoint', 'login-lost', 'canary-failed', 'blocked', 'cap-reached', null].map(haltsSource), [true, true, true, true, false, false]);
  assert.match(readFileSync(join(CODE_ROOT, 'scripts', 'probe-searches.mjs'), 'utf8'), /haltsSource\(result\.aborted\)/);
});
