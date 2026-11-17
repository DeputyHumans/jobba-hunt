import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, upsertCards, setPrefilter, setDetail } from '../scripts/lib/state.mjs';
import { tierFor, validateTriage, pendingForTriage, applyTriage, applyDecision, approveApplication, approveDocs, applyGate, recordAttempt, autoApplyBlockers, markNotSent, triageLanes } from '../scripts/lib/triage.mjs';
import { money } from '../scripts/lib/profile.mjs';

const T = '2026-10-27T15:00:00.000Z';
function seeded() {
  const s = emptyState();
  upsertCards(s, [
    { job_id: '9000000001', title: 'Fractional CTO', company: 'Acme Corp', location: 'Remote' },
    { job_id: '9000000002', title: 'Interim CTO', company: 'Globex', location: 'Remote' },
    { job_id: '9000000003', title: 'CTO', company: 'Initech', location: 'Remote' },
  ], { queryId: 'q', scope: 'fractional', sweepId: 'sw', now: T });
  setPrefilter(s, '9000000001', { verdict: 'keep', reasons: [], flags: [] });
  setPrefilter(s, '9000000002', { verdict: 'review', reasons: ['scope-unconfirmed'], flags: [] });
  setPrefilter(s, '9000000003', { verdict: 'keep', reasons: [], flags: [] });
  setDetail(s, '9000000001', { fetched_at: T, description_text: 'We need a fractional CTO.', employment_type: 'Contract', workplace: 'Remote' });
  setDetail(s, '9000000002', { fetched_at: T, description_text: 'Interim CTO for 6 months.', employment_type: 'Contract', workplace: 'Remote' });
  return s;
}
const result = (id, over = {}) => ({
  job_id: id, score: 84, gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' },
  why_fit: ['agentic SDLC mandate'], gaps: [], red_flags: [], comp_seen: null, hours_seen: '10-15/wk', archetype: 'agentic-transformation', ...over,
});

test('tier is computed from score and gates, never taken from the model', () => {
  assert.equal(tierFor(80, { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }), 'A');
  assert.equal(tierFor(79, { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }), 'B');
  assert.equal(tierFor(65, { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'unclear' }), 'B');
  assert.equal(tierFor(64, { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }), 'C');
  assert.equal(tierFor(95, { G1: 'fail', G2: 'pass', G3: 'pass', G4: 'pass' }), 'reject');
});

test('validation rejects out-of-range scores, bad gate values and missing arrays', () => {
  assert.deepEqual(validateTriage(result('9000000001')), []);
  assert.ok(validateTriage(result('9000000001', { score: 101 })).length);
  assert.ok(validateTriage(result('9000000001', { gates: { G1: 'yes' } })).length);
  assert.ok(validateTriage(result('9000000001', { why_fit: 'x' })).length);
  assert.ok(validateTriage(result('x1')).length);
});

test('pending triage = viewed, not dropped, not yet scored', () => {
  const s = seeded();
  assert.deepEqual(pendingForTriage(s).map((j) => j.job_id), ['9000000001', '9000000002']);
  const p = pendingForTriage(s)[0];
  assert.equal(p.description_text, 'We need a fractional CTO.');
  assert.equal(p.employment_type, 'Contract');
});

test('applying triage stores the computed tier, marks triaged, and reports errors without partial writes', () => {
  const s = seeded();
  const r = applyTriage(s, [result('9000000001'), result('9000000002', { score: 300 }), result('9000000099')], T);
  assert.deepEqual(r.applied, ['9000000001']);
  assert.equal(r.errors.length, 2);
  assert.equal(s.jobs['9000000001'].triage.tier, 'A');
  assert.equal(s.jobs['9000000001'].status, 'triaged');
  assert.equal(s.jobs['9000000002'].triage, null);
});

test('decisions move status: pursue -> shortlisted, watch -> watching, skip -> skipped', () => {
  const s = seeded();
  applyTriage(s, [result('9000000001'), result('9000000002', { score: 70 })], T);
  applyDecision(s, '9000000001', 'pursue', 'strong mandate fit', T);
  applyDecision(s, '9000000002', 'skip', '', T);
  assert.equal(s.jobs['9000000001'].status, 'shortlisted');
  assert.equal(s.jobs['9000000001'].triage.decision, 'pursue');
  assert.equal(s.jobs['9000000002'].status, 'skipped');
  assert.throws(() => applyDecision(s, '9000000001', 'maybe', '', T), /decision/);
  assert.throws(() => applyDecision(s, '9000000003', 'pursue', '', T), /not triaged/);
});

function pursued() {
  const s = emptyState();
  upsertCards(s, [{ job_id: '9000000050', title: 'Fractional CTO', company: 'Acme Corp', location: 'Remote' }], { queryId: 'q', scope: 'fractional', sweepId: 'sw', now: T });
  setDetail(s, '9000000050', { title: 'Fractional CTO', company: 'Acme Corp', description_text: 'x'.repeat(200) });
  applyTriage(s, [{ job_id: '9000000050', score: 85, gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, why_fit: [], gaps: [], red_flags: [] }], T);
  return s;
}

test('apply gate: no decision means no dry run and no submit', () => {
  const s = pursued();
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: true }), 'not-pursued');
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: false }), 'not-pursued');
});

test('apply gate: pursue allows a dry run; a real submit needs the explicit approval', () => {
  const s = pursued();
  applyDecision(s, '9000000050', 'pursue', '', T);
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: true }), null);
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: false }), 'not-approved');
  approveApplication(s, '9000000050', { cv: 'workspace/data/out/cv/share/jordan-example-cv-x.pdf', note: 'Apply' }, T);
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: false }), null);
  assert.equal(s.jobs['9000000050'].application.cv, 'workspace/data/out/cv/share/jordan-example-cv-x.pdf');
});

test('approval refuses a job that was not pursued', () => {
  const s = pursued();
  assert.throws(() => approveApplication(s, '9000000050', { cv: 'x.pdf' }, T), /not pursued/);
  applyDecision(s, '9000000050', 'skip', '', T);
  assert.throws(() => approveApplication(s, '9000000050', { cv: 'x.pdf' }, T), /not pursued/);
});

test('apply gate: submitted, already applied or an unverified submit all block another submit', () => {
  for (const outcome of ['submitted', 'already-applied', 'submit-unverified', 'submitted-by-hand']) {
    const s = pursued();
    applyDecision(s, '9000000050', 'pursue', '', T);
    approveApplication(s, '9000000050', { cv: 'x.pdf' }, T);
    recordAttempt(s, '9000000050', { mode: 'submit', outcome }, T);
    assert.equal(applyGate(s.jobs['9000000050'], { dryRun: false }), 'already-applied', outcome);
    assert.equal(applyGate(s.jobs['9000000050'], { dryRun: true }), 'already-applied', outcome);
  }
});

test('a dry run or needs_answers keeps the application open', () => {
  const s = pursued();
  applyDecision(s, '9000000050', 'pursue', '', T);
  approveApplication(s, '9000000050', { cv: 'x.pdf' }, T);
  recordAttempt(s, '9000000050', { mode: 'dry-run', outcome: 'dry-run-complete' }, T);
  recordAttempt(s, '9000000050', { mode: 'submit', outcome: 'needs_answers' }, T);
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: false }), null);
  assert.equal(s.jobs['9000000050'].application.attempts.length, 2);
});

test('approval stores the cover note path the user saw in the question', () => {
  const s = pursued();
  applyDecision(s, '9000000050', 'pursue', '', T);
  approveApplication(s, '9000000050', { cv: 'x.pdf', cover: 'data/applications/9000000050/cover-note.txt' }, T);
  assert.equal(s.jobs['9000000050'].application.cover_note, 'data/applications/9000000050/cover-note.txt');
});

// A sample auto-apply rule: score 75+, every gate passing, Easy Apply only, with an existing CV
// covering 60%+. Everything else still asks the user.
const RULE = { min_score: 75, channels: ['easy'], min_cv_coverage: 60 };
const autoJob = (o = {}) => ({
  job_id: '9', detail: { fetched_at: '2026-10-28T17:00:00Z', apply: { type: 'easy' }, already_applied: false },
  triage: { score: 82, tier: 'A', gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, decision: null }, ...o,
});
const ok = { coverage: 60, cvExists: true, verified: true };

test('auto-apply: a 75+ role with every gate passing, Easy Apply and an existing 60% CV has no blockers', () => {
  assert.deepEqual(autoApplyBlockers(autoJob(), RULE, ok), []);
  assert.deepEqual(autoApplyBlockers(autoJob({ triage: { ...autoJob().triage, score: 75, tier: 'B' } }), RULE, ok), []);
});

test('auto-apply: below 75, any gate not passing, or already decided goes back to the user', () => {
  const t = autoJob().triage;
  assert.match(autoApplyBlockers(autoJob({ triage: { ...t, score: 74 } }), RULE, ok).join(), /score 74 below 75/);
  assert.match(autoApplyBlockers(autoJob({ triage: { ...t, gates: { ...t.gates, G4: 'unclear' } } }), RULE, ok).join(), /G4/);
  assert.match(autoApplyBlockers(autoJob({ triage: { ...t, decision: 'skip' } }), RULE, ok).join(), /already decided/);
  assert.match(autoApplyBlockers(autoJob({ triage: null }), RULE, ok).join(), /not scored/);
});

test('auto-apply: a reject tier or a full-time salary under the floor goes back, even with passing gates and score', () => {
  const t = autoJob().triage;
  assert.match(autoApplyBlockers(autoJob({ triage: { ...t, tier: 'reject', salary_below_floor: { annual: 180000 } } }), RULE, ok).join(), /salary .*180,000.* under the full-time floor/);
  assert.match(autoApplyBlockers(autoJob({ triage: { ...t, tier: 'reject' } }), RULE, ok).join(), /tier reject/);
});

test('auto-apply: a company-site role, an unverified channel, no CV or low coverage goes back to the user', () => {
  assert.match(autoApplyBlockers(autoJob({ detail: { ...autoJob().detail, apply: { type: 'external' } } }), RULE, ok).join(), /external/);
  assert.match(autoApplyBlockers(autoJob(), RULE, { ...ok, verified: false }).join(), /not verified/);
  assert.match(autoApplyBlockers(autoJob(), RULE, { ...ok, cvExists: false }).join(), /no existing CV/);
  assert.match(autoApplyBlockers(autoJob(), RULE, { ...ok, coverage: 59 }).join(), /59% below 60%/);
  assert.match(autoApplyBlockers(autoJob(), RULE, { ...ok, coverage: null }).join(), /unknown/);
});

test('auto-apply: an application already on record, LinkedIn showing applied, or no rule at all blocks it', () => {
  assert.match(autoApplyBlockers(autoJob({ application: { status: 'submitted' } }), RULE, ok).join(), /already submitted/);
  assert.match(autoApplyBlockers(autoJob({ detail: { ...autoJob().detail, already_applied: true } }), RULE, ok).join(), /LinkedIn shows/);
  assert.deepEqual(autoApplyBlockers(autoJob(), null, ok), ['no auto_apply rule in config/apply.json']);
});

// The money floors come from preferences.money (the fixture profile: IC floor $95/hr, full-time
// floor $200K, target $260K). The flags name the posted pay only, never the user's numbers. The
// hourly floor applies first, so a full-time figure under the salary floor sits above $95/hr.
test('IC rate floor: a hands-on role under the floor is rejected and never auto-applied; leadership is untouched', () => {
  assert.equal(money().ic_rate_floor, 95);
  const s = seeded();
  applyTriage(s, [
    result('9000000001', { lane: 'hands-on', comp_seen: '$80 - $85/hr' }),
    result('9000000002', { lane: 'hands-on', comp_seen: 'Depends on Experience' }),
    result('9000000003', { lane: 'leadership', comp_seen: '$90/hr' }),
  ], T);
  const low = s.jobs['9000000001'].triage;
  assert.equal(low.tier, 'reject');
  assert.deepEqual(low.rate_below_floor, { hourly: 85, floor: 95 });
  assert.match(low.red_flags[0], /tops out at \$85\/hr, under the IC floor/);
  assert.doesNotMatch(low.red_flags[0], /\$95/); // the floor is the user's: it stays off the tracker
  assert.equal(s.jobs['9000000002'].triage.tier, 'A');
  assert.equal(s.jobs['9000000003'].triage.tier, 'A');
  const rule = { min_score: 75, channels: ['easy'], min_cv_coverage: 60 };
  s.jobs['9000000001'].detail.apply = { type: 'easy' };
  assert.ok(autoApplyBlockers(s.jobs['9000000001'], rule, { coverage: 80, cvExists: true, verified: true }).some((b) => /under the \$95\/hr IC floor/.test(b)));
});

test('full-time IC floor: a full-time hands-on role posted under the floor is rejected; a contract at the same pay is not', () => {
  const s = seeded();
  s.jobs['9000000001'].detail = { ...(s.jobs['9000000001'].detail || {}), employment_type: 'Full-time' };
  s.jobs['9000000002'].detail = { ...(s.jobs['9000000002'].detail || {}), employment_type: 'Contract' };
  applyTriage(s, [
    result('9000000001', { lane: 'hands-on', comp_seen: '$160,000 to $199,000 base + quarterly bonus' }),
    result('9000000002', { lane: 'hands-on', comp_seen: '$160,000 to $199,000 per year' }),
  ], T);
  const ft = s.jobs['9000000001'].triage;
  assert.equal(ft.tier, 'reject');
  assert.deepEqual(ft.salary_below_floor, { annual: 199000, floor: 200000 });
  assert.match(ft.red_flags[0], /tops out at \$199,000 a year/);
  assert.doesNotMatch(ft.red_flags[0], /200,000|260,000/); // the floor is the user's: it stays off the tracker
  assert.equal(s.jobs['9000000002'].triage.tier, 'A');
});

test('full-time IC target: a top between the floor and the target is scored as usual and flagged below target, with no number for the target', () => {
  const s = seeded();
  s.jobs['9000000001'].detail = { ...(s.jobs['9000000001'].detail || {}), employment_type: 'Full-time' };
  applyTriage(s, [result('9000000001', { lane: 'hands-on', comp_seen: '$200,000 to $240,000 base' })], T);
  const t = s.jobs['9000000001'].triage;
  assert.equal(t.tier, 'A');
  assert.equal(t.salary_below_floor, undefined);
  assert.deepEqual(t.salary_below_target, { annual: 240000, target: 260000 });
  assert.match(t.red_flags[0], /^Below target: the full-time pay tops out at \$240,000 a year$/);
  assert.doesNotMatch(t.red_flags.join(' '), /260/);
});

test('a closed posting marks the application and the role closed, not a needs-you card', () => {
  const s = seeded();
  recordAttempt(s, '9000000001', { mode: 'submit', outcome: 'closed', detail: 'LinkedIn: No longer accepting applications' }, T);
  assert.equal(s.jobs['9000000001'].application.status, 'closed');
  assert.equal(s.jobs['9000000001'].status, 'closed');
});

// A run recorded submit-unverified whose screenshot proves nothing was sent (the form still
// filled, Submit never clicked). Only the user's OK, with that evidence, reopens it.
test('markNotSent: a submit-unverified job with evidence and a note from the user goes back to approved, and only then can run again', () => {
  const s = pursued();
  const id = '9000000050';
  applyDecision(s, id, 'pursue', '', T);
  approveApplication(s, id, { cv: 'workspace/data/out/cv/share/jordan-example-cv-x.pdf', note: 'Apply' }, T);
  recordAttempt(s, id, { mode: 'submit', outcome: 'submit-unverified', detail: 'error after Submit was clicked' }, T);
  assert.equal(applyGate(s.jobs[id], { dryRun: false }), 'already-applied');
  assert.throws(() => markNotSent(s, id, { evidence: '', note: 'Fix and re-run' }, T), /evidence/);
  assert.throws(() => markNotSent(s, id, { evidence: '/tmp/03-error.png', note: '' }, T), /the user's words/);
  markNotSent(s, id, { evidence: '/tmp/03-error.png', note: 'Fix and re-run' }, T);
  const a = s.jobs[id].application;
  assert.equal(a.status, 'approved');
  assert.equal(a.submitted_at, undefined);
  assert.deepEqual([a.attempts.at(-1).mode, a.attempts.at(-1).outcome], ['not-sent', 'not-sent']);
  assert.match(a.attempts.at(-1).detail, /Fix and re-run.*03-error\.png/);
  assert.equal(applyGate(s.jobs[id], { dryRun: false }), null);
});

test('markNotSent refuses a job that is not at submit-unverified', () => {
  const s = pursued();
  const id = '9000000050';
  applyDecision(s, id, 'pursue', '', T);
  approveApplication(s, id, { cv: 'x.pdf', note: 'Apply' }, T);
  recordAttempt(s, id, { mode: 'submit', outcome: 'submitted' }, T);
  assert.throws(() => markNotSent(s, id, { evidence: '/tmp/x.png', note: 're-run' }, T), /submit-unverified/);
});

test('tiers come from preferences.tiers (fixture 80/65), or from the caller', () => {
  const pass = { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' };
  assert.equal(tierFor(70, pass, { a: 90, b: 70 }), 'B');
  assert.equal(tierFor(89, pass, { a: 90, b: 70 }), 'B');
  assert.equal(tierFor(69, pass, { a: 90, b: 70 }), 'C');
  const s = seeded();
  applyTriage(s, [result('9000000001', { score: 84 })], T, { tierCuts: { a: 90, b: 70 } });
  assert.equal(s.jobs['9000000001'].triage.tier, 'B');
});

test('lanes come from preferences.lanes, or from the caller', () => {
  assert.deepEqual(triageLanes(), ['leadership', 'hands-on']); // the template default (the fixture sets none)
  assert.deepEqual(triageLanes({ lanes: ['advisory'] }), ['advisory']);
  assert.deepEqual(validateTriage(result('9000000001', { lane: 'advisory' }), { lanes: ['advisory'] }), []);
  assert.match(validateTriage(result('9000000001', { lane: 'advisory' })).join(), /lane must be leadership\|hands-on/);
});

test('auto-apply: a rule switched off blocks every role', () => {
  assert.match(autoApplyBlockers(autoJob(), { ...RULE, enabled: false }, ok).join(), /auto-apply is off/);
  assert.deepEqual(autoApplyBlockers(autoJob(), { ...RULE, enabled: true }, ok), []);
});

test('approveDocs: records the approval and the user\'s words, needs a note, and refuses a job already sent', () => {
  const s = pursued();
  const id = '9000000050';
  assert.throws(() => approveDocs(s, id, { note: ' ' }, T), /--note/);
  assert.throws(() => approveDocs(s, '9000000099', { note: 'approve' }, T), /unknown job/);
  approveDocs(s, id, { note: 'approve' }, T);
  assert.deepEqual([s.jobs[id].application.docs_approved_at, s.jobs[id].application.docs_review, s.jobs[id].application.docs_note], [T, 'approved', 'approve']);
  assert.deepEqual(s.jobs[id].application.attempts, []);
  assert.equal(applyGate(s.jobs[id], { dryRun: false }), 'not-pursued'); // the role still needs its own approval
  // A review object keeps its fields; the role approval keeps the documents' approval.
  s.jobs[id].application.docs_review = { status: 'pending', url: 'https://bikeshed.now/d/review-1' };
  approveDocs(s, id, { note: 'looks good' }, T);
  assert.deepEqual(s.jobs[id].application.docs_review, { status: 'approved', url: 'https://bikeshed.now/d/review-1' });
  applyDecision(s, id, 'pursue', '', T);
  approveApplication(s, id, { cv: 'x.pdf' }, T);
  assert.equal(s.jobs[id].application.docs_approved_at, T);
  recordAttempt(s, id, { mode: 'submit', outcome: 'submitted' }, T);
  assert.throws(() => approveDocs(s, id, { note: 'approve' }, T), /already submitted/);
});

test('pause: no real submit and no auto-apply while paused; dry runs still allowed', () => {
  const s = pursued();
  applyDecision(s, '9000000050', 'pursue', '', T);
  approveApplication(s, '9000000050', { cv: 'x.pdf', note: 'Apply' }, T);
  const pause = { paused: true, reason: 'CV refresh' };
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: false, pause }), 'paused: CV refresh');
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: true, pause }), null);
  assert.equal(applyGate(s.jobs['9000000050'], { dryRun: false, pause: { paused: false } }), null);
  assert.deepEqual(autoApplyBlockers(autoJob(), RULE, ok), []);
  assert.deepEqual(autoApplyBlockers(autoJob(), RULE, { ...ok, pause }), ['submissions paused: CV refresh']);
});
