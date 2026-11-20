// Bridge between sweep state and the in-session /hunt-triage scoring. The model
// returns scores and gate verdicts; the tier is computed here from those, so the
// thresholds (preferences.tiers, fit-profile.md) are enforced in one place and never drift.

import { isDiceId } from './dice-extract.mjs';
import { belowIcFloor, belowFullTimeFloor, belowFullTimeTarget } from './rate.mjs';
import { preferences, tiers } from './profile.mjs';
import { applicationKey } from './company.mjs';

const GATES = ['G1', 'G2', 'G3', 'G4'];
const GATE_VALUES = ['pass', 'fail', 'unclear'];
const DECISIONS = { pursue: 'shortlisted', watch: 'watching', skip: 'skipped' };
// The lanes a role can be scored in (preferences.lanes): leadership, and hands-on senior and
// lead roles, by default.
const DEFAULT_LANES = ['leadership', 'hands-on'];
export const triageLanes = (p = preferences()) => (Array.isArray(p.lanes) && p.lanes.length ? p.lanes : DEFAULT_LANES);

// Tier A at or above tiers.a, B at or above tiers.b (preferences.tiers, default 80 and 65).
export function tierFor(score, gates, t = tiers()) {
  if (GATES.some((g) => gates?.[g] === 'fail')) return 'reject';
  if (score >= (t?.a ?? 80)) return 'A';
  if (score >= (t?.b ?? 65)) return 'B';
  return 'C';
}

export function validateTriage(r, { lanes = triageLanes() } = {}) {
  const e = [];
  if (!/^\d{6,}$/.test(String(r?.job_id || '')) && !isDiceId(r?.job_id)) e.push('job_id must be a numeric LinkedIn id or dice-<guid>');
  if (r?.lane != null && !lanes.includes(r.lane)) e.push(`lane must be ${lanes.join('|')}`);
  if (!Number.isInteger(r?.score) || r.score < 0 || r.score > 100) e.push('score must be an integer 0-100');
  for (const g of GATES) if (!GATE_VALUES.includes(r?.gates?.[g])) e.push(`gates.${g} must be pass|fail|unclear`);
  for (const k of ['why_fit', 'gaps', 'red_flags']) if (!Array.isArray(r?.[k])) e.push(`${k} must be an array`);
  // An agency posting: the poster is a recruiter or staffing firm, and end_client is the employer it names.
  if (r?.end_client != null && (typeof r.end_client !== 'string' || !r.end_client.trim())) e.push('end_client must be a non-empty string or null');
  if (r?.via_agency != null && typeof r.via_agency !== 'boolean') e.push('via_agency must be true, false or omitted');
  return e;
}

// Score from the fetched description only. A role whose description is empty cannot pass or fail a
// gate on evidence: every gate is unclear, the red flags name no-description, and the score is at
// most 50. A row that claims more is refused.
export const NO_DESCRIPTION_MAX = 50;
export function noDescriptionErrors(job, r) {
  if (String(job?.detail?.description_text || '').trim()) return [];
  const e = [];
  if (GATES.some((g) => r?.gates?.[g] !== 'unclear')) e.push('no-description: the posting has no description, so every gate must be unclear');
  if (!(r?.red_flags || []).includes('no-description')) e.push('no-description: red_flags must include "no-description"');
  if (Number.isInteger(r?.score) && r.score > NO_DESCRIPTION_MAX) e.push(`no-description: score at most ${NO_DESCRIPTION_MAX}`);
  return e;
}

export function pendingForTriage(state) {
  return Object.values(state.jobs)
    .filter((j) => j.detail && !j.triage && j.prefilter?.verdict !== 'drop' && !['closed', 'dropped'].includes(j.status))
    .map((j) => ({
      job_id: j.job_id, source: j.source || 'linkedin', url: j.url, title: j.title, company: j.company, location: j.location,
      employment_type: j.detail.employment_type ?? null, contract_types: j.detail.contract_types ?? null, workplace: j.detail.workplace ?? null,
      applicants: j.detail.applicants ?? null, posted_text: j.detail.posted_text ?? j.posted_text ?? null,
      comp_text: j.detail.comp_text ?? null, company_url: j.detail.company_url ?? null,
      prefilter: j.prefilter, matched_queries: j.matched_queries, first_seen: j.first_seen,
      description_text: j.detail.description_text,
    }));
}

export function applyTriage(state, results, now, { tierCuts = tiers(), lanes = triageLanes() } = {}) {
  const applied = [];
  const errors = [];
  for (const r of results) {
    const errs = validateTriage(r, { lanes });
    if (!state.jobs[r?.job_id]) errs.push(`unknown job_id ${r?.job_id}`);
    else errs.push(...noDescriptionErrors(state.jobs[r.job_id], r));
    if (errs.length) { errors.push({ job_id: r?.job_id ?? null, errors: errs }); continue; }
    const j = state.jobs[r.job_id];
    // IC rate floor (preferences.money.ic_rate_floor), enforced here so a model score can never
    // lift it. The flag names the posted rate only: the floor is the user's and stays off the tracker.
    const floor = r.lane === 'hands-on' ? belowIcFloor(r.comp_seen, j.detail?.comp_text) : null;
    // Full-time IC salary floor and target (preferences.money). Full-time means the posting's
    // employment type says full-time and names no contract, part-time or temporary term.
    const et = String(j.detail?.employment_type || '');
    const fullTime = /full[- ]?time/i.test(et) && !/contract|part[- ]?time|temporary/i.test(et);
    const salary = r.lane === 'hands-on' && fullTime && !floor ? belowFullTimeFloor(r.comp_seen, j.detail?.comp_text) : null;
    const under = r.lane === 'hands-on' && fullTime && !floor && !salary ? belowFullTimeTarget(r.comp_seen, j.detail?.comp_text) : null;
    let t = floor ? { ...r, rate_below_floor: floor, red_flags: [`Rate floor: the posted rate tops out at $${floor.hourly}/hr, under the IC floor`, ...r.red_flags] } : r;
    if (salary) t = { ...t, salary_below_floor: salary, red_flags: [`Salary floor: the full-time pay tops out at $${salary.annual.toLocaleString('en-US')} a year, under the full-time floor`, ...t.red_flags] };
    // Below target is a flag for the user's question, not a reject; the target's number stays off the tracker.
    if (under) t = { ...t, salary_below_target: under, red_flags: [`Below target: the full-time pay tops out at $${under.annual.toLocaleString('en-US')} a year`, ...t.red_flags] };
    j.triage = { ...t, tier: floor || salary ? 'reject' : tierFor(r.score, r.gates, tierCuts), scored_at: now, decision: null, decided_at: null, note: null };
    j.status = 'triaged';
    applied.push(r.job_id);
  }
  return { applied, errors };
}

const siblingError = (sameCompany) => (sameCompany?.length ? `company limit: ${sameCompany.map((r) => `${r.id} ${r.status}`).join(', ')}` : null);

export function applyDecision(state, id, decision, note, now, { sameCompany = [] } = {}) {
  if (!DECISIONS[decision]) throw new Error(`decision must be one of ${Object.keys(DECISIONS).join('|')}`);
  const j = state.jobs[id];
  if (!j?.triage) throw new Error(`job ${id} is not triaged yet`);
  // The per-company limit (config/apply.json companies.limit): a pursue with live siblings is refused up front.
  if (decision === 'pursue' && siblingError(sameCompany)) throw new Error(siblingError(sameCompany));
  j.triage.decision = decision;
  j.triage.decided_at = now;
  j.triage.note = note || null;
  j.status = DECISIONS[decision];
  return j;
}

// Applications. A dry run needs the user's "pursue"; a real submit also needs the user's
// explicit approval (approveApplication, run right after their "Apply" in the session). One
// submit per job, ever: an unverified submit blocks too, because a retry could send a duplicate.
const FINAL = new Set(['submitted', 'submitted-by-hand', 'already-applied', 'submit-unverified']);

export function approveApplication(state, id, { cv, note, cover = null, coverPdf = null, sameCompany = [] }, now) {
  const j = state.jobs[id];
  if (j?.triage?.decision !== 'pursue') throw new Error(`job ${id} is not pursued; record the user's decision first`);
  if (siblingError(sameCompany)) throw new Error(siblingError(sameCompany));
  if (!cv) throw new Error('approval needs the approved CV (--cv)');
  j.application = { ...(j.application || {}), attempts: j.application?.attempts || [], status: 'approved', approved_at: now, cv, note: note || null, cover_note: cover, cover_pdf: coverPdf };
  return j;
}

// The tailored CV and letter for a job, approved by the user (a review-doc comment "approve",
// or "Apply"). It records the approval only; the role still needs its own approval unless the
// auto-apply rule covers it. docs_review becomes "approved" whatever its shape.
export function approveDocs(state, id, { note }, now) {
  const j = state.jobs[id];
  if (!j) throw new Error(`unknown job ${id}`);
  if (typeof note !== 'string' || !note.trim()) throw new Error("approve-docs needs --note with the user's words");
  if (FINAL.has(j.application?.status)) throw new Error(`job ${id} is already ${j.application.status}; nothing to approve`);
  const app = j.application || {};
  const review = app.docs_review && typeof app.docs_review === 'object' ? { ...app.docs_review, status: 'approved' } : 'approved';
  j.application = { ...app, attempts: app.attempts || [], docs_review: review, docs_approved_at: now, docs_note: note.trim() };
  return j;
}

// The same approval for a role outside the job state (an email or recruiter role tailored from a JD
// file): its only record is data/applications/<id>/tailor.json, so the approval lives there.
export function approveTailoredRecord(rec, { note }, now) {
  if (!rec) throw new Error('unknown job: no job state and no tailor.json');
  if (typeof note !== 'string' || !note.trim()) throw new Error("approve-docs needs --note with the user's words");
  if (!['built', 'review'].includes(rec.status)) throw new Error(`job ${rec.job_id} has no built documents to approve (tailor status ${rec.status})`);
  return { ...rec, status: 'approved', docs_approved_at: now, docs_note: note.trim() };
}

// The standing auto-apply rule (config/apply.json auto_apply, off until the user opts in): a
// role that meets every condition is pursued and approved without a question; any blocker
// sends it back to the user. The caller measures CV coverage and checks the file and the
// channel flag.
export function autoApplyBlockers(j, rule, { coverage = null, cvExists = false, verified = false, pause = null, sameCompany = [] } = {}) {
  if (!rule) return ['no auto_apply rule in config/apply.json'];
  // The hunt-wide pause (config/pause.json) stops auto-apply before anything else.
  if (pause?.paused) return [`submissions paused: ${pause.reason || 'no reason given'}`];
  const b = [];
  if (rule.enabled === false) b.push('auto-apply is off (config/apply.json auto_apply.enabled)');
  const t = j?.triage;
  if (!t) b.push('not scored');
  else {
    if (t.decision) b.push(`already decided: ${t.decision}`);
    if (t.rate_below_floor) b.push(`rate $${t.rate_below_floor.hourly}/hr under the $${t.rate_below_floor.floor}/hr IC floor`);
    // A full-time salary under the floor, or any reject, goes back to the user even when the
    // score and gates would pass: applyTriage rejects the tier without failing a gate.
    if (t.salary_below_floor) b.push(`salary $${Number(t.salary_below_floor.annual).toLocaleString('en-US')} a year under the full-time floor`);
    if (t.tier === 'reject') b.push('tier reject');
    if (!(t.score >= rule.min_score)) b.push(`score ${t.score} below ${rule.min_score}`);
    const gates = Object.entries(t.gates || {});
    const off = gates.filter(([, v]) => v !== 'pass').map(([k, v]) => `${k} ${v}`);
    if (!gates.length || off.length) b.push(`gates not all pass: ${off.join(', ') || 'none recorded'}`);
  }
  const type = j?.detail?.apply?.type || 'unknown';
  const channels = rule.channels || [];
  if (!channels.includes(type)) b.push(`apply type ${type} is not auto-applied (${channels.join(', ') || 'no channel listed'})`);
  else if (!verified) b.push(`channel ${type} not verified`);
  if (j?.application?.status) b.push(`application already ${j.application.status}`);
  if (j?.detail?.already_applied) b.push('LinkedIn shows it as applied');
  if (!cvExists) b.push('no existing CV for the archetype (or the lane pool, auto_apply.cv_pool)');
  if (!(coverage >= rule.min_cv_coverage)) b.push(`CV coverage ${coverage ?? 'unknown'}% below ${rule.min_cv_coverage}%`);
  if (siblingError(sameCompany)) b.push(siblingError(sameCompany));
  return b;
}

// The CV for auto-apply in archetype mode. With a pool for the role's lane (config/apply.json
// auto_apply.cv_pool: { <lane>: [slugs], domain: [slugs] }), the best-covering CV of that lane wins,
// the archetype's on a tie, and a domain CV goes only to a role whose archetype is that CV. Without
// a pool for the lane, the archetype's CV alone (the cv-map rule). An omitted lane is the first of
// preferences.lanes. ranked comes from build-cv --match: [{ slug, pct }].
export function pickCv(ranked = [], { lane, archetype, pool, lanes = triageLanes() } = {}) {
  const pct = (slug) => ranked.find((r) => r.slug === slug)?.pct ?? null;
  const lanePool = pool?.[lane || lanes[0]];
  if (!Array.isArray(lanePool) || !lanePool.length) return archetype ? { slug: archetype, pct: pct(archetype), archetype_pct: pct(archetype) } : null;
  const domain = Array.isArray(pool.domain) ? pool.domain : [];
  const ok = ranked.filter((r) => lanePool.includes(r.slug) && (!domain.includes(r.slug) || r.slug === archetype));
  if (!ok.length) return null;
  const best = ok.reduce((b, r) => (r.pct > b.pct || (r.pct === b.pct && r.slug === archetype) ? r : b));
  return { slug: best.slug, pct: best.pct, archetype_pct: pct(archetype) };
}

export function applyGate(j, { dryRun, pause = null, sameCompany = [] }) {
  if (j?.triage?.decision !== 'pursue') return 'not-pursued';
  // A run asked for a Submit and never finished: whether it went out is unknown, so nothing runs
  // again until `apply -- recover` records it submit-unverified for the operator to check.
  if (j.application?.submit_pending) return 'submit-pending';
  // While paused (config/pause.json) nothing is sent; a dry run still runs.
  if (!dryRun && pause?.paused) return `paused: ${pause.reason || 'no reason given'}`;
  if (FINAL.has(j.application?.status)) return 'already-applied';
  if (!dryRun && !j.application?.approved_at) return 'not-approved';
  // The per-company limit: never send past it. An already-applied sibling and an application known
  // only from an opportunity file count too; an approved, unsent sibling does not block the submit.
  const sent = !dryRun && sameCompany.find((r) => FINAL.has(r.status) || String(r.status).startsWith('opportunity:'));
  if (sent) return `same-company: ${sent.id} ${sent.status}`;
  return null;
}

// Other roles at the same company that are live: sent or approved. Closed, skipped, held and
// withdrawn roles do not count: a held role gave its place to the one kept over it. The company
// key (agencies, aliases, normalization) lives in ./company.mjs. opts come from company.mjs
// loadCompanyOpts: { limit, agencies, aliases, external }. The siblings come back only when they
// reach the limit (config/apply.json companies.limit, default 1); a null limit turns the rule off.
const LIVE = new Set([...FINAL, 'approved']);
export function sameCompanyRoles(state, j, { limit = 1, agencies = [], aliases = {}, external = [] } = {}) {
  if (limit == null) return [];
  const k = applicationKey(j, { agencies, aliases });
  if (!k.key && !k.agencyTitle) return [];
  const same = (o) => {
    const ok = applicationKey(o, { agencies, aliases });
    return k.key ? ok.key === k.key : (!ok.key && ok.agencyTitle === k.agencyTitle);
  };
  const live = Object.entries(state.jobs || {})
    .filter(([id, o]) => o !== j && id !== j.job_id && LIVE.has(o.application?.status) && same(o))
    .map(([id, o]) => ({ id, title: o.title, status: o.application.status }));
  // An opportunity file whose job is in state is already counted above, by its state record.
  const files = k.key ? external.filter((e) => e.key === k.key && e.job_id !== j.job_id && !state.jobs?.[e.job_id] && !agencies.some((a) => applicationKey({ company: a }, { aliases }).key === e.key)) : [];
  const all = [...live, ...files.map((e) => ({ id: e.id, title: e.title, status: e.status }))];
  return all.length >= limit ? all : [];
}

// Hold an approved (or pursued) role: it leaves the runner's reach until the user approves it again.
export function holdApplication(state, id, { note }, now) {
  const j = state.jobs[id];
  if (!j) throw new Error(`unknown job ${id}`);
  if (FINAL.has(j.application?.status)) throw new Error(`job ${id} is already ${j.application.status}`);
  if (typeof note !== 'string' || !note.trim()) throw new Error('pass --note with the reason for the hold');
  j.application = { ...(j.application || {}), attempts: j.application?.attempts || [], status: 'held', held_at: now };
  delete j.application.approved_at;
  j.application.attempts = [...j.application.attempts, { at: now, mode: 'hold', outcome: 'held', channel: null, detail: note.trim(), dir: null }];
  if (j.triage) { j.triage.decision = 'watch'; j.triage.decided_at = now; j.triage.note = note.trim(); }
  j.status = 'watching';
  return j;
}

// Withdraw an approved, unsent application: it leaves the runner's reach for good and the role
// is skipped. A sent application is never touched.
export function withdrawApplication(state, id, { note }, now) {
  const j = state.jobs[id];
  if (!j) throw new Error(`unknown job ${id}`);
  if (FINAL.has(j.application?.status)) throw new Error(`job ${id} is already ${j.application.status}`);
  if (typeof note !== 'string' || !note.trim()) throw new Error('pass --note with the reason for the withdrawal');
  j.application = { ...(j.application || {}), attempts: j.application?.attempts || [], status: 'withdrawn', withdrawn_at: now };
  delete j.application.approved_at;
  j.application.attempts = [...j.application.attempts, { at: now, mode: 'withdraw', outcome: 'withdrawn', channel: null, detail: note.trim(), dir: null }];
  if (j.triage) { j.triage.decision = 'skip'; j.triage.decided_at = now; j.triage.note = note.trim(); }
  j.status = 'skipped';
  return j;
}

// Written to the state file right before any Submit click, by either browser driver: if the run dies
// after it, the submit is never retried (applyGate refuses it) and `apply -- recover` records it.
export function markSubmitPending(state, id, { dir, at }) {
  const j = state.jobs[id];
  j.application = j.application || { status: 'open', attempts: [] };
  j.application.submit_pending = { dir, at };
  return j;
}

// The pending submit of a run that never finished becomes submit-unverified: the operator checks
// the platform by hand (confirm or not-sent), never a retry.
export function recoverPending(state, id, now) {
  const j = state.jobs[id];
  const p = j?.application?.submit_pending;
  if (!p) throw new Error(`no pending submit for ${id}`);
  return recordAttempt(state, id, { mode: 'submit', outcome: 'submit-unverified', detail: `the run that asked for Submit at ${p.at} never finished; check the platform by hand, never retry`, dir: p.dir }, now);
}

export function recordAttempt(state, id, { mode, outcome, detail = null, dir = null, channel = null }, now) {
  const j = state.jobs[id];
  j.application = j.application || { status: 'open', attempts: [] };
  delete j.application.submit_pending;
  j.application.attempts.push({ at: now, mode, outcome, channel, detail, dir });
  if (outcome === 'closed') { j.application.status = 'closed'; j.status = 'closed'; }
  if (FINAL.has(outcome)) {
    j.application.status = outcome;
    if (outcome !== 'already-applied') j.application.submitted_at = now;
    j.status = 'applied';
  }
  return j;
}

// Calibration: check scored roles against expected outcomes (the workspace's
// data/calibration.json, or tests/fixtures/calibration.json in tests). Missing results fail;
// nothing passes silently. Expectation types: order, tier_at_least, gate_is, reject_on.
const TIER_RANK = { reject: 0, C: 1, B: 2, A: 3 };

export function checkCalibration(results, fixture, { tierCuts = tiers() } = {}) {
  const byLabel = {};
  for (const role of fixture.roles) {
    const r = results.find((x) => String(x.job_id) === role.job_id);
    if (r) byLabel[role.label] = { ...r, tier: tierFor(r.score, r.gates, tierCuts) };
  }
  const failures = [];
  for (const role of fixture.roles) if (!byLabel[role.label]) failures.push({ type: 'missing', label: role.label });
  for (const e of fixture.expectations) {
    if (e.type === 'order') {
      const h = byLabel[e.higher];
      const l = byLabel[e.lower];
      if (h && l && !(h.score > l.score)) failures.push({ type: 'order', detail: `${e.higher} (${h.score}) must score above ${e.lower} (${l.score})` });
    } else if (e.type === 'tier_at_least') {
      const r = byLabel[e.label];
      if (r && TIER_RANK[r.tier] < TIER_RANK[e.tier]) failures.push({ type: 'tier_at_least', detail: `${e.label} is ${r.tier}, expected ${e.tier} or better` });
    } else if (e.type === 'reject_on') {
      const r = byLabel[e.label];
      if (r && r.gates?.[e.gate] !== 'fail') failures.push({ type: 'reject_on', detail: `${e.label} must fail ${e.gate} (got ${r.gates?.[e.gate]})` });
    } else if (e.type === 'gate_is') {
      const r = byLabel[e.label];
      if (r && r.gates?.[e.gate] !== e.value) failures.push({ type: 'gate_is', detail: `${e.label} must be ${e.value} on ${e.gate} (got ${r.gates?.[e.gate]})` });
    } else {
      failures.push({ type: 'unknown-expectation', detail: e.type });
    }
  }
  return { pass: failures.length === 0, failures };
}

// A run recorded submit-unverified whose own screenshot proves nothing was sent (the form still
// filled, Submit never clicked). The user's OK plus that evidence reopens it as approved, so
// the runner may try once more. Never for any other status.
export function markNotSent(state, id, { evidence, note }, now) {
  const j = state.jobs[id];
  if (!j || j.application?.status !== 'submit-unverified') throw new Error('not-sent is only for a job at submit-unverified');
  if (typeof evidence !== 'string' || !evidence.trim()) throw new Error('pass --evidence <screenshot that shows nothing was sent>');
  if (typeof note !== 'string' || !note.trim()) throw new Error("pass --note with the user's words approving the re-run");
  j.application.attempts.push({ at: now, mode: 'not-sent', outcome: 'not-sent', channel: null, detail: `${note.trim()} (${evidence.trim()})`, dir: null });
  j.application.status = 'approved';
  delete j.application.submitted_at;
  j.status = 'shortlisted';
  return j;
}
