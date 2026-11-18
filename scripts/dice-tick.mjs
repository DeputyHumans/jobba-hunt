#!/usr/bin/env node
// Dice loop tick: ONE Dice search (the canary every `canary_every` ticks, else the query whose
// last ok run is oldest), prefilter, then detail views for new keep/review Dice roles. READ-ONLY.
// Run by /hunt-loop right after the LinkedIn tick, in the same firing.
// Same planning, guards, sweep core and exit codes as tick.mjs; its own profile
// (<data>/browser/dice), caps (dice_jobs) and halt (state.sources.dice), so a Dice
// abort never stops LinkedIn and the other way round.
//
// Usage:
//   node scripts/dice-tick.mjs --dry-run [--now <iso>]   # plan only
//   node scripts/dice-tick.mjs [--headed] [--no-views]
//   node scripts/dice-tick.mjs --sweep [--views 80] [--headed]   # one-time full Dice sweep, on the
//        user's explicit instruction only: every query, page 2 when page 1 is full, then views of
//        every kept role up to --views. No tick-window check; the sweeps_per_day and
//        searches_per_day caps, the guards, the Dice halt and the pause still apply.
//
// Exit codes: 0 done, 1 aborted by a guard (Dice halted until the next reset_hour, or 7 days on
// a checkpoint), 2 refused (a cap, or the query set is not verified yet), 3 profile busy,
// 4 outside the tick window or paused (config/pause.json), 5 halted by an earlier Dice abort.
// The last stdout line is JSON with next_tick_at and next_delay_seconds, as tick.mjs.

import './lib/env.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, out, openContext, ProfileBusyError, sleep, jitter } from './cloak-core.mjs';
import { searchJobs, viewJob, signedInAtHome, capture, DICE_PROFILE, DICE_PLATFORM } from './dice-jobs.mjs';
import { buildDiceUrl } from './lib/dice-url.mjs';
import { compilePrefilter } from './lib/prefilter.mjs';
import { DATA_DIR, STATE_PATH, loadState, saveStateAtomic, recordTick, sourceState } from './lib/state.mjs';
import { isOpen, nextOpen, isHalted, haltUntil, pickTick, nextTickAt, queryWindow } from './lib/tick-plan.mjs';
import { createRun, survivorsOf, pendingTriageCount } from './lib/sweep-core.mjs';
import { canPost, recordPost, getUsageSummary } from './rate-limiter.mjs';
import { loadConfig, loadSearchConfig } from './lib/config.mjs';
import { display } from './lib/paths.mjs';
import { schedule } from './lib/profile.mjs';
import { logAction } from './lib/actions-log.mjs';
import { readPause } from './lib/pause.mjs';

const log = (s) => process.stderr.write(`${s}\n`);

const { flags } = parseArgs(process.argv.slice(2));
const cfg = loadSearchConfig('dice-searches.json');
const T = cfg.tick;
const resetHour = schedule()?.reset_hour ?? 4;
const state = loadState(STATE_PATH);
const loop = sourceState(state, 'dice');
if (flags.now && !flags['dry-run']) { log('--now is for --dry-run only: a live tick always uses the real clock.'); process.exit(2); }
const nowMs = flags.now ? Date.parse(flags.now) : Date.now();
if (Number.isNaN(nowMs)) { log(`unparseable --now ${flags.now}`); process.exit(2); }
// The next tick: an absolute time (next_tick_at) the loop schedules from, never inside the
// limiter's jitter gap after the last recorded tick; next_delay_seconds is the same instant as an
// offset from the end of this run (or from --now in a dry run).
const finish = (code, obj) => {
  const from = code === 0 || code === 1 ? Date.now() : nowMs;
  const at = nextTickAt(from, T, T.gap_seconds, { notBefore: getUsageSummary().dice_jobs.ticks_per_day.nextAllowedAt || null });
  out({ source: 'dice', ...obj, next_tick_at: new Date(at).toISOString(), next_delay_seconds: Math.round((at - from) / 1000) });
  process.exit(code);
};

if (isHalted(loop, nowMs)) {
  log(`DICE HALTED until ${loop.halt_until} (an earlier abort). No override exists, by design.`);
  finish(5, { success: false, halted: true, halt_until: loop.halt_until });
}
// The hunt-wide pause (config/pause.json): a live tick views nothing, reads like closed hours and
// comes back in an hour (the loop then runs only the inbox and the tracker). A dry run still plans.
const paused = readPause();
if (paused?.paused && !flags['dry-run']) {
  log(`PAUSED: ${paused.reason || 'no reason given'} (config/pause.json, since ${paused.since || '?'}). Nothing viewed.`);
  out({ source: 'dice', success: true, closed: true, paused: true, reason: paused.reason || null, next_tick_at: new Date(Date.now() + 3600000).toISOString(), next_delay_seconds: 3600 });
  process.exit(4);
}
// A halt that has run out is cleared by the first live run that ends without a new abort.
const expiredHalt = loop.halt_until || null;
const sweep = !!flags.sweep;
if (!sweep && !isOpen(nowMs, T)) {
  const next = new Date(nextOpen(nowMs, T)).toISOString();
  log(`CLOSED: outside ${T.start}-${T.end} ${T.tz}, days ${T.days.join(',')}. Next open ${next}.`);
  finish(4, { success: true, closed: true, next_open: next });
}

const pick = sweep
  ? { kind: 'sweep', id: 'dice-sweep', keywords: 'every configured query', query: cfg.canary, tprSeconds: cfg.canary.tpr_seconds }
  : pickTick(cfg, loop, nowMs);
const url = buildDiceUrl(cfg, pick.query, { tprSeconds: pick.tprSeconds });
const usage = getUsageSummary().dice_jobs;
const viewBudget = flags['no-views'] ? 0 : Math.max(0, Math.min(sweep ? Number(flags.views) || 80 : T.views_per_tick, usage.job_views_per_day.available));
// The sweep plan: the canary, then every query, each over its own window (tick-plan).
const plan = sweep ? [
  { kind: 'canary', id: cfg.canary.id, keywords: cfg.canary.keywords, scope: cfg.canary.scope, canary: true, query: cfg.canary, tprSeconds: cfg.canary.tpr_seconds },
  ...cfg.queries.map((q) => ({ kind: 'query', id: q.id, keywords: q.keywords, scope: q.scope, canary: false, query: q, tprSeconds: queryWindow(loop, q.id, nowMs, cfg.window) })),
] : [pick];
log(`dice tick | ${pick.kind} ${pick.id} | window ${(pick.tprSeconds / 3600).toFixed(1)}h | caps left: ${usage.ticks_per_day.available} ticks, ${usage.searches_per_day.available} searches, ${usage.job_views_per_day.available} views | views this tick <= ${viewBudget}`);

if (flags['dry-run']) {
  log(`  ${pick.keywords}\n  ${url}\nDRY RUN. No browser launched, no state written.${cfg.verified ? '' : '\nNOTE: config/dice-searches.json is not verified (probe pending): a live tick refuses.'}`);
  finish(0, { success: true, dry_run: true, paused: !!paused?.paused, verified: !!cfg.verified, now: new Date(nowMs).toISOString(), pick: { kind: pick.kind, id: pick.id, tpr_seconds: pick.tprSeconds, url }, view_budget: viewBudget });
}

// The query set comes from a query probe (/hunt-probe). Until a probe marks it verified, a live
// tick is refused like a cap: the loop treats it as a no-op.
if (!cfg.verified) {
  log('REFUSED: config/dice-searches.json is not verified (run the Dice query probe first: /hunt-probe, docs/query-probe-method.md).');
  finish(2, { success: false, refused: true, cap: 'not-verified', reason: 'Dice query set not verified (probe pending)' });
}
for (const cap of sweep ? ['sweeps_per_day', 'searches_per_day'] : ['ticks_per_day', 'searches_per_day']) {
  const g = canPost('dice_jobs', cap);
  if (!g.allowed) {
    log(`REFUSED: ${cap}: ${g.reason}. Next allowed ${g.nextAllowedAt}.`);
    finish(2, { success: false, refused: true, cap, reason: g.reason, nextAllowedAt: g.nextAllowedAt });
  }
}

const startedAt = new Date();
const tickId = `${sweep ? 'dice-sweep' : 'dice-tick'}-${startedAt.toISOString()}`;
let context, page;
try {
  ({ context, page } = await openContext(DICE_PLATFORM, { headed: !!flags.headed, flags, dir: DICE_PROFILE }));
} catch (err) {
  if (err instanceof ProfileBusyError) {
    log(`SKIPPED: ${err.message}`);
    finish(3, { success: false, profileBusy: true, profile: err.profile });
  }
  throw err;
}
if (!sweep) recordPost('dice_jobs', 'ticks_per_day', { tickId, query: pick.id });
else {
  recordPost('dice_jobs', 'sweeps_per_day', { sweepId: tickId });
  log(`dice sweep on the user's instruction: ${plan.length} queries, views <= ${viewBudget}`);
}

const run = createRun({
  page, state, cfg, P: compilePrefilter(loadConfig('prefilter.json')), runId: tickId, log, suspectStreak: loop.suspect_streak,
  io: { searchJobs, viewJob, buildUrl: buildDiceUrl }, limiter: { canPost, recordPost },
  platform: 'dice_jobs', source: 'dice', loop, pageScopes: sweep ? ['dice'] : [],
});
// A login-lost verdict is checked against the home feed before it halts Dice: false ones came
// from the search page's signed-out header. Confirmed signed in, it is recorded as a suspect
// page, not an abort.
async function confirmLoginLost() {
  if (run.abort !== 'login-lost') return;
  await capture(page, 'login-lost').catch(() => {});
  if (await signedInAtHome(page).catch(() => false)) {
    log('login-lost not confirmed: the home feed is signed in. Recorded as suspect, no halt.');
    run.abort = null;
    run.falseLogin = true;
  }
}
try {
  for (const [i, p] of plan.entries()) {
    if (run.abort || run.budgetExhausted) break;
    if (i) await sleep(jitter(cfg.pacing.search_gap_ms));
    await run.searchQuery(p);
    await confirmLoginLost();
    if (run.falseLogin) break;
  }
  run.prefilterTouched();
  if (viewBudget && !run.abort && !run.falseLogin) { await run.viewQueue(viewBudget); await confirmLoginLost(); }
} finally {
  await context.close().catch(() => {});
}

loop.suspect_streak = run.suspectStreak;
if (!sweep) recordTick(loop, { kind: pick.kind, id: pick.id, at: startedAt.toISOString() });
if (run.abort) loop.halt_until = haltUntil(run.abort, Date.now(), T.tz, resetHour);
else if (expiredHalt) loop.halt_until = null;
saveStateAtomic(STATE_PATH, state);
if (run.abort) logAction({ action: 'halt.set', source: 'dice', detail: { abort: run.abort, until: loop.halt_until, by: tickId } });
else if (expiredHalt) logAction({ action: 'halt.cleared', source: 'dice', detail: { was: expiredHalt, by: tickId } });

const viewed = run.views.filter((v) => v.status === 'ok' && v.verdict !== 'drop').map((v) => {
  const j = state.jobs[v.id];
  return { job_id: j.job_id, source: 'dice', title: j.title, company: j.company, verdict: v.verdict, employment_type: j.detail?.employment_type ?? null, workplace: j.detail?.workplace ?? null, comp_text: j.detail?.comp_text ?? null, apply_type: j.detail?.apply?.type ?? null, url: j.url };
});
const summary = {
  false_login: !!run.falseLogin,
  pick: pick.id,
  kind: pick.kind,
  searches: run.perQuery.length,
  new: run.perQuery.reduce((n, q) => n + q.new, 0),
  survivors: survivorsOf(state, tickId).length,
  views: run.views.filter((v) => v.status === 'ok').length,
  pending_triage: pendingTriageCount(state),
};
const label = startedAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
mkdirSync(join(DATA_DIR, 'raw'), { recursive: true });
const snapPath = join(DATA_DIR, 'raw', `${label}-dice-${sweep ? 'sweep' : 'tick'}.json`);
writeFileSync(snapPath, JSON.stringify({
  date: startedAt.toISOString().slice(0, 10), source: 'dice', tick_id: tickId, method: 'dice-tick.mjs (one Dice search, rotating, read-only)',
  pick: { kind: pick.kind, id: pick.id, tpr_seconds: pick.tprSeconds }, aborted: run.abort, halt_until: loop.halt_until,
  budget_exhausted: run.budgetExhausted, summary, per_query: run.perQuery, views: run.views, viewed,
}, null, 2));
logAction({ action: sweep ? 'sweep.done' : 'tick.done', source: 'dice', ref: display(snapPath), detail: { ...summary, aborted: run.abort || null, budget_exhausted: run.budgetExhausted } });

log(`\ndice ${pick.id}: ${summary.searches} search, ${summary.new} new, ${summary.views} viewed, ${summary.pending_triage} pending triage | guards: ${run.abort || 'none'}${run.budgetExhausted ? ' | budget exhausted' : ''}`);
log(`snapshot -> ${display(snapPath)}`);
if (run.abort === 'checkpoint') log('!! STOP DICE. Halted 7 days. Log in by hand: npm run dice -- login (runbook "Dice").');
else if (run.abort) log(`!! DICE ABORTED (${run.abort}). Dice halted until ${loop.halt_until}. LinkedIn is unaffected.`);
finish(run.abort ? 1 : 0, { success: !run.abort, aborted: run.abort, halt_until: loop.halt_until, budget_exhausted: run.budgetExhausted, summary, viewed, snapshot: display(snapPath) });
