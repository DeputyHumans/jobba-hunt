#!/usr/bin/env node
// Loop tick: ONE search (the canary every `canary_every` ticks, else the classic query with the
// oldest window), prefilter, then detail views for new keep/review roles. READ-ONLY. Run by
// /hunt-loop about every 30 min inside the tick window (preferences.schedule: tz, days,
// tick_start-tick_end). Shares the search/view code, guards, state and caps with the daily sweep.
//
// Usage:
//   node scripts/tick.mjs --dry-run [--now <iso>]   # plan only: hours gate, rotation, window, caps
//   node scripts/tick.mjs                           # one live tick, headless
//   node scripts/tick.mjs --headed                  # watched tick
//   node scripts/tick.mjs --no-views                # search only
//
// Exit codes: 0 done (incl. budget exhausted), 1 aborted by a guard (state halted until
// the next reset_hour, or 7 days on a checkpoint), 2 refused (a cap, or the query set is not
// verified yet), 3 profile busy (skip, never retry in a loop), 4 outside the tick window or paused (config/pause.json),
// 5 halted by an earlier abort. The last stdout line is JSON with next_tick_at (the absolute time
// the loop schedules the next firing from: never inside the limiter's jitter gap) and
// next_delay_seconds (the same instant as an offset from the end of this run).

import './lib/env.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, out, openContext, ProfileBusyError } from './cloak-core.mjs';
import { searchJobs, viewJob } from './linkedin-jobs.mjs';
import { buildSearchUrl } from './lib/search-url.mjs';
import { compilePrefilter } from './lib/prefilter.mjs';
import { DATA_DIR, STATE_PATH, loadState, saveStateAtomic, recordTick } from './lib/state.mjs';
import { isOpen, nextOpen, isHalted, haltUntil, pickTick, nextTickAt } from './lib/tick-plan.mjs';
import { createRun, survivorsOf, pendingTriageCount } from './lib/sweep-core.mjs';
import { canPost, recordPost, getUsageSummary } from './rate-limiter.mjs';
import { loadConfig, loadSearchConfig } from './lib/config.mjs';
import { display } from './lib/paths.mjs';
import { schedule } from './lib/profile.mjs';
import { logAction } from './lib/actions-log.mjs';
import { readPause } from './lib/pause.mjs';

const log = (s) => process.stderr.write(`${s}\n`);

const { flags } = parseArgs(process.argv.slice(2));
const cfg = loadSearchConfig('searches.json');
const T = cfg.tick;
const resetHour = schedule()?.reset_hour ?? 4;
const state = loadState(STATE_PATH);
if (flags.now && !flags['dry-run']) { log('--now is for --dry-run only: a live tick always uses the real clock.'); process.exit(2); }
const nowMs = flags.now ? Date.parse(flags.now) : Date.now();
if (Number.isNaN(nowMs)) { log(`unparseable --now ${flags.now}`); process.exit(2); }
// The next tick: an absolute time (next_tick_at) the loop schedules from, never inside the
// limiter's jitter gap after the last recorded tick; next_delay_seconds is the same instant as an
// offset from the end of this run (or from --now in a dry run).
const finish = (code, obj) => {
  const from = code === 0 || code === 1 ? Date.now() : nowMs;
  const at = nextTickAt(from, T, T.gap_seconds, { notBefore: getUsageSummary().linkedin_jobs.ticks_per_day.nextAllowedAt || null });
  out({ ...obj, next_tick_at: new Date(at).toISOString(), next_delay_seconds: Math.round((at - from) / 1000) });
  process.exit(code);
};

if (isHalted(state, nowMs)) {
  log(`HALTED until ${state.halt_until} (an earlier abort). No override exists, by design.`);
  finish(5, { success: false, halted: true, halt_until: state.halt_until });
}
// The hunt-wide pause (config/pause.json): a live tick views nothing, reads like closed hours and
// comes back in an hour (the loop then runs only the inbox and the tracker). A dry run still plans.
const paused = readPause();
if (paused?.paused && !flags['dry-run']) {
  log(`PAUSED: ${paused.reason || 'no reason given'} (config/pause.json, since ${paused.since || '?'}). Nothing viewed.`);
  out({ success: true, closed: true, paused: true, reason: paused.reason || null, next_tick_at: new Date(Date.now() + 3600000).toISOString(), next_delay_seconds: 3600 });
  process.exit(4);
}
// A halt that has run out is cleared by the first live tick that ends without a new abort.
const expiredHalt = state.halt_until || null;
if (!isOpen(nowMs, T)) {
  const next = new Date(nextOpen(nowMs, T)).toISOString();
  log(`CLOSED: outside ${T.start}-${T.end} ${T.tz}, days ${T.days.join(',')}. Next open ${next}.`);
  finish(4, { success: true, closed: true, next_open: next });
}

const pick = pickTick(cfg, state, nowMs);
const url = buildSearchUrl(cfg, pick.query, { tprSeconds: pick.tprSeconds });
const usage = getUsageSummary().linkedin_jobs;
const viewBudget = flags['no-views'] ? 0 : Math.max(0, Math.min(T.views_per_tick, usage.job_views_per_day.available));
log(`tick | ${pick.kind} ${pick.id} | f_TPR=r${pick.tprSeconds} (${(pick.tprSeconds / 3600).toFixed(1)}h) | caps left: ${usage.ticks_per_day.available} ticks, ${usage.searches_per_day.available} searches, ${usage.job_views_per_day.available} views | views this tick <= ${viewBudget}`);

if (flags['dry-run']) {
  log(`  ${pick.keywords}\n  ${url}\nDRY RUN. No browser launched, no state written.${cfg.verified ? '' : '\nNOTE: config/searches.json is not verified (probe pending): a live tick refuses.'}`);
  finish(0, { success: true, dry_run: true, paused: !!paused?.paused, verified: !!cfg.verified, now: new Date(nowMs).toISOString(), pick: { kind: pick.kind, id: pick.id, tpr_seconds: pick.tprSeconds, url }, view_budget: viewBudget });
}

// The query set comes from a query probe (/hunt-probe). Until a probe marks it verified, a live
// tick is refused like a cap: the loop treats it as a no-op.
if (!cfg.verified) {
  log('REFUSED: config/searches.json is not verified (run the LinkedIn query probe first: /hunt-probe, docs/query-probe-method.md).');
  finish(2, { success: false, refused: true, cap: 'not-verified', reason: 'LinkedIn query set not verified (probe pending)' });
}
for (const cap of ['ticks_per_day', 'searches_per_day']) {
  const g = canPost('linkedin_jobs', cap);
  if (!g.allowed) {
    log(`REFUSED: ${cap}: ${g.reason}. Next allowed ${g.nextAllowedAt}.`);
    finish(2, { success: false, refused: true, cap, reason: g.reason, nextAllowedAt: g.nextAllowedAt });
  }
}

const startedAt = new Date();
const tickId = `tick-${startedAt.toISOString()}`;
let context, page;
try {
  ({ context, page } = await openContext('linkedin', { headed: !!flags.headed, flags }));
} catch (err) {
  if (err instanceof ProfileBusyError) {
    log(`SKIPPED: ${err.message}`);
    finish(3, { success: false, profileBusy: true, profile: err.profile });
  }
  throw err;
}
recordPost('linkedin_jobs', 'ticks_per_day', { tickId, query: pick.id });

const run = createRun({
  page, state, cfg, P: compilePrefilter(loadConfig('prefilter.json')), runId: tickId, log, suspectStreak: state.suspect_streak,
  io: { searchJobs, viewJob }, limiter: { canPost, recordPost },
});
try {
  await run.searchQuery(pick);
  run.prefilterTouched();
  if (viewBudget && !run.abort) await run.viewQueue(viewBudget);
} finally {
  await context.close().catch(() => {});
}

state.suspect_streak = run.suspectStreak;
recordTick(state, { kind: pick.kind, id: pick.id, at: startedAt.toISOString() });
if (run.abort) state.halt_until = haltUntil(run.abort, Date.now(), T.tz, resetHour);
else if (expiredHalt) state.halt_until = null;
saveStateAtomic(STATE_PATH, state);
if (run.abort) logAction({ action: 'halt.set', source: 'linkedin', detail: { abort: run.abort, until: state.halt_until, by: tickId } });
else if (expiredHalt) logAction({ action: 'halt.cleared', source: 'linkedin', detail: { was: expiredHalt, by: tickId } });

// Roles this tick fetched and kept: what /hunt-loop triages next.
const viewed = run.views.filter((v) => v.status === 'ok' && v.verdict !== 'drop').map((v) => {
  const j = state.jobs[v.id];
  return { job_id: j.job_id, title: j.title, company: j.company, verdict: v.verdict, employment_type: j.detail?.employment_type ?? null, workplace: j.detail?.workplace ?? null, apply_type: j.detail?.apply?.type ?? null, url: j.url };
});
const summary = {
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
const snapPath = join(DATA_DIR, 'raw', `${label}-tick.json`);
writeFileSync(snapPath, JSON.stringify({
  date: startedAt.toISOString().slice(0, 10), tick_id: tickId, method: 'tick.mjs (one search, rotating, read-only)',
  pick: { kind: pick.kind, id: pick.id, tpr_seconds: pick.tprSeconds }, aborted: run.abort, halt_until: state.halt_until,
  budget_exhausted: run.budgetExhausted, summary, per_query: run.perQuery, views: run.views, viewed,
}, null, 2));
logAction({ action: 'tick.done', source: 'linkedin', ref: display(snapPath), detail: { ...summary, aborted: run.abort || null, budget_exhausted: run.budgetExhausted } });

log(`\n${pick.id}: ${summary.searches} search, ${summary.new} new, ${summary.views} viewed, ${summary.pending_triage} pending triage | guards: ${run.abort || 'none'}${run.budgetExhausted ? ' | budget exhausted' : ''}`);
log(`snapshot -> ${display(snapPath)}`);
if (run.abort === 'checkpoint') log('!! STOP. Halted 7 days. Log in by hand in a real terminal: npm run jobs -- login. Then halve the caps in config/limits.json (docs/runbook.md "Halts, the pause and cap overrides").');
else if (run.abort) log(`!! ABORTED (${run.abort}). Halted until ${state.halt_until}. See docs/runbook.md "Guards and actions".`);
finish(run.abort ? 1 : 0, { success: !run.abort, aborted: run.abort, halt_until: state.halt_until, budget_exhausted: run.budgetExhausted, summary, viewed, snapshot: display(snapPath) });
