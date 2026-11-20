#!/usr/bin/env node
// Daily LinkedIn Jobs sweep: canary, configured searches, prefilter, detail views for
// plausible roles. READ-ONLY, one run per day, sequential, paced. Flags, --dry-run, jittered
// pacing, abort guards and a raw snapshot; it holds ONE browser session for the whole run
// instead of a child process per search: one continuous session reads as one person
// browsing, and avoids ~30 browser launches per sweep.
//
// Usage:
//   node scripts/sweep-jobs.mjs --dry-run            # plan, URLs, caps, ETA; no browser, no network
//   node scripts/sweep-jobs.mjs                      # full sweep, headless
//   node scripts/sweep-jobs.mjs --headed             # watched run (the full set is 5 searches)
//   node scripts/sweep-jobs.mjs --queries 2          # canary + first 2 queries; the others keep their
//                                                    # own windows (per-query, shared with tick.mjs)
//   node scripts/sweep-jobs.mjs --no-views           # searches only
//
// Exit codes: 0 done (incl. budget exhausted), 1 aborted by a guard, 2 refused (a daily cap,
// a halt, the query set is not verified yet, or a chrome-driver refusal), 3 profile busy, or the
// chrome driver's browser stopped answering (no halt; re-run later by hand, never loop), 4 paused
// (config/pause.json; a dry run still plans).

import './lib/env.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, out, sleep, jitter } from './cloak-core.mjs';
import { openSession, SessionRefused } from './lib/session.mjs';
import { recordSession } from './lib/browser.mjs';
import { searchJobs, viewJob, chromeReaders } from './linkedin-jobs.mjs';
import { planSearches } from './lib/search-url.mjs';
import { compilePrefilter } from './lib/prefilter.mjs';
import { DATA_DIR, STATE_PATH, loadState, saveStateAtomic, markSweepSuccess, touchedIds } from './lib/state.mjs';
import { queryWindow, haltUntil, haltsSource, isHalted } from './lib/tick-plan.mjs';
import { readPause, pauseBlock } from './lib/pause.mjs';
import { createRun, survivorsOf, pendingTriageCount } from './lib/sweep-core.mjs';
import { canPost, recordPost, getUsageSummary } from './rate-limiter.mjs';
import { loadConfig, loadSearchConfig } from './lib/config.mjs';
import { display } from './lib/paths.mjs';
import { schedule } from './lib/profile.mjs';
import { logAction } from './lib/actions-log.mjs';

const log = (s) => process.stderr.write(`${s}\n`);

const { flags } = parseArgs(process.argv.slice(2));
const cfg = loadSearchConfig('searches.json');
const P = compilePrefilter(loadConfig('prefilter.json'));
const state = loadState(STATE_PATH);
const startedAt = new Date();
const sweepId = startedAt.toISOString();
const label = startedAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
// Per-query windows: each query searches back to its own last ok run (shared with the
// loop ticks), so a query this run skips keeps its window.
const tprById = Object.fromEntries(cfg.queries.map((q) => [q.id, queryWindow(state, q.id, startedAt.getTime(), cfg.window)]));

let plan = planSearches(cfg, { tprSeconds: cfg.window.first_run_seconds, tprById });
if (flags.queries !== undefined) plan = [plan[0], ...plan.slice(1, 1 + Number(flags.queries))];
const doViews = !flags['no-views'];
const usage = getUsageSummary().linkedin_jobs;
// Clamp at 0: the limiter reports a negative remainder after a day with a cap override.
const searchBudget = Math.max(0, usage.searches_per_day.available);
const viewBudget = Math.max(0, Math.min(cfg.views.max_per_sweep, usage.job_views_per_day.available));

log(`sweep ${sweepId} | per-query windows | ${plan.length} searches planned | budget: ${searchBudget} searches, ${viewBudget} views`);
if (!cfg.verified) log('!! config/searches.json is not verified (probe pending): a live sweep refuses. Run the LinkedIn query probe first (/hunt-probe).');

if (flags['dry-run']) {
  plan.forEach((p, i) => log(`  ${String(i).padStart(2)}. [${p.scope}] f_TPR=r${p.tprSeconds} (${(p.tprSeconds / 3600).toFixed(1)}h) ${p.keywords}\n      ${p.url}`));
  const avgSearch = (cfg.pacing.search_gap_ms[0] + cfg.pacing.search_gap_ms[1]) / 2 + 8000;
  const avgView = (cfg.pacing.view_gap_ms[0] + cfg.pacing.view_gap_ms[1]) / 2 + 5000;
  const eta = Math.round((Math.min(plan.length, searchBudget) * avgSearch + (doViews ? viewBudget * avgView : 0)) / 60000);
  log(`\nDRY RUN. Would run up to ${Math.min(plan.length, searchBudget)} searches${doViews ? ` and up to ${viewBudget} detail views` : ''}, ~${eta} min.`);
  log(`Sweep cap today: ${usage.sweeps_per_day.available}/${usage.sweeps_per_day.max} available. Last successful sweep: ${state.last_successful_sweep || 'never (first run backfills 7 days)'}.`);
  log(`Writes: ${display(join(DATA_DIR, 'raw', `${label}-sweep.json`))} and ${display(STATE_PATH)}. No browser launched.`);
  out({ success: true, dry_run: true, verified: !!cfg.verified, searches: Math.min(plan.length, searchBudget), views: doViews ? viewBudget : 0, eta_minutes: eta, sweeps_available: usage.sweeps_per_day.available });
  process.exit(0);
}

if (isHalted(state, startedAt.getTime())) {
  log(`HALTED until ${state.halt_until} (an earlier abort). No override exists, by design.`);
  out({ success: false, halted: true, halt_until: state.halt_until });
  process.exit(2);
}

const paused = pauseBlock(readPause());
if (paused) {
  log(`PAUSED (${paused}). Only the user lifts the pause (config/pause.json).`);
  out({ success: false, paused: true, reason: paused });
  process.exit(4);
}

if (!cfg.verified) {
  log('REFUSED: config/searches.json is not verified (run the LinkedIn query probe first: /hunt-probe, docs/query-probe-method.md).');
  out({ success: false, refused: true, cap: 'not-verified', reason: 'LinkedIn query set not verified (probe pending)' });
  process.exit(2);
}

const gate = canPost('linkedin_jobs', 'sweeps_per_day');
if (!gate.allowed) {
  log(`REFUSED: ${gate.reason}. Next allowed ${gate.nextAllowedAt}. No override exists, by design.`);
  out({ success: false, refused: true, reason: gate.reason, nextAllowedAt: gate.nextAllowedAt });
  process.exit(2);
}

let session;
try {
  session = await openSession('linkedin', { flags, headed: !!flags.headed, command: 'sweep', source: 'linkedin', readers: { cloak: { searchJobs, viewJob }, chrome: chromeReaders } });
} catch (err) {
  if (err instanceof SessionRefused) {
    log(`SKIPPED: ${err.result.reason}`);
    out(err.result);
    process.exit(err.code);
  }
  throw err;
}
recordPost('linkedin_jobs', 'sweeps_per_day', { sweepId });

const run = createRun({ page: session.page, state, cfg, P, runId: sweepId, log, io: session.io, limiter: { canPost, recordPost } });
const expiredHalt = state.halt_until || null;

try {
  for (let i = 0; i < plan.length && !run.abort && !run.budgetExhausted; i++) {
    const r = await run.searchQuery(plan[i]);
    if (!r || run.abort) break;
    if (i < plan.length - 1) await sleep(jitter(cfg.pacing.search_gap_ms));
  }
  run.prefilterTouched();
  if (doViews && !run.abort) await run.viewQueue(viewBudget);

  if (!run.abort) markSweepSuccess(state, sweepId);
  else if (haltsSource(run.abort)) state.halt_until = haltUntil(run.abort, Date.now(), cfg.tick.tz, schedule()?.reset_hour ?? 4);
  if (!run.abort && expiredHalt) state.halt_until = null;
  saveStateAtomic(STATE_PATH, state);
} finally {
  await session.close();
}
if (session.driver === 'chrome' && run.abort === 'login-lost') recordSession('linkedin', false);
if (haltsSource(run.abort)) logAction({ action: 'halt.set', source: 'linkedin', detail: { abort: run.abort, until: state.halt_until, by: `sweep-${sweepId}` } });
else if (expiredHalt) logAction({ action: 'halt.cleared', source: 'linkedin', detail: { was: expiredHalt, by: `sweep-${sweepId}` } });

const { perQuery, views, abort, budgetExhausted } = run;
const survivors = survivorsOf(state, sweepId);
const summary = {
  searches: perQuery.length,
  ids_seen: touchedIds(state, sweepId).length,
  new: perQuery.reduce((n, q) => n + q.new, 0),
  survivors: survivors.length,
  views: views.filter((v) => v.status === 'ok').length,
  pending_triage: pendingTriageCount(state),
};
const snapshot = {
  date: startedAt.toISOString().slice(0, 10),
  sweep_id: sweepId,
  method: 'sweep-jobs.mjs (canary + config/searches.json, one session, paced, read-only)',
  tpr_seconds: Object.fromEntries(plan.map((p) => [p.id, p.tprSeconds])),
  config_verified: !!cfg.verified,
  aborted: abort,
  budget_exhausted: budgetExhausted,
  summary,
  per_query: perQuery,
  views,
  survivors,
};
mkdirSync(join(DATA_DIR, 'raw'), { recursive: true });
const snapPath = join(DATA_DIR, 'raw', `${label}-sweep.json`);
writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
logAction({ action: 'sweep.done', source: 'linkedin', ref: display(snapPath), detail: { ...summary, aborted: abort || null, budget_exhausted: budgetExhausted } });

log(`\n${summary.searches} searches, ${summary.ids_seen} ids (${summary.new} new), ${summary.survivors} survivors, ${summary.views} viewed, ${summary.pending_triage} pending triage | guards: ${abort || 'none'}${budgetExhausted ? ' | budget exhausted' : ''}`);
log(`snapshot -> ${display(snapPath)}`);
if (abort === 'checkpoint') log('!! STOP. LinkedIn is halted 7 days after a checkpoint. Log in by hand in a real terminal: npm run jobs -- login. Then halve the caps. See docs/runbook.md "Guards and actions".');
else if (abort === 'login-lost') log('!! STOP. LinkedIn is halted until the next reset. Log in by hand in a real terminal: npm run jobs -- login. See docs/runbook.md "Guards and actions".');
else if (abort && abort !== 'browser-unavailable') log(`!! ABORTED (${abort}). No retry today. Debug with a --headed single search after the reset; see docs/runbook.md "Guards and actions".`);
if (abort === 'browser-unavailable') log(`!! The browser stopped answering (${run.browserError}). No halt; check the Chrome connection (/chrome).`);
out({ success: !abort, aborted: abort, ...(abort === 'browser-unavailable' ? { browser: 'unavailable', why: run.browserError } : {}), budget_exhausted: budgetExhausted, summary, snapshot: display(snapPath) });
process.exit(abort === 'browser-unavailable' ? 3 : abort ? 1 : 0);
