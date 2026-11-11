#!/usr/bin/env node
// Query probe: runs a fixed list of searches (and a few detail views) in ONE browser
// session to measure how well candidate queries target the hunt, before the sweep's
// query set is changed. READ-ONLY, paced and capped exactly like sweep-jobs.mjs (same
// limiter counters, same abort guards). It never touches data/state/jobs.json or the
// sweeps_per_day cap, so a probe does not disturb the sweep's dedup or first-run backfill.
//
// Usage:
//   node scripts/probe-searches.mjs --file config/probes/<yyyymmdd>-probe-a.json --dry-run
//   node scripts/probe-searches.mjs --file config/probes/<yyyymmdd>-probe-a.json [--headed]
//   node scripts/probe-searches.mjs --mark-verified <data/probes/...json> [--report <path>]
//        records that a finished probe verified the configured query set: sets verified: true
//        (with verified_at and verified_by) in the workspace searches.json, or dice-searches.json
//        for a Dice probe. The tick, dice-tick and sweep refuse until then. No browser.
//
// --file resolves against the repo, then the workspace (config/probes/ lives in the workspace).
// Probe file: { name, source?, tpr_seconds, defaults: {geo, workplace}, views: [{probe, job_id}], already_viewed: [id],
//   searches: [{ id, keywords, geo?, workplace?, job_type?, params?, base_url?, capture?, view_sample?: {n, where} }] }
// "source": "dice" (or --source dice) runs the probe on Dice instead: config/dice-searches.json,
// the Dice reader and profile, the dice_jobs caps, and each card's prefilter verdict saved
// (Dice probe rules count prefilter-kept roles; view_sample where "kept").
// --into-state (Dice only: a one-time Dice scan before the loop starts) also writes the cards
// and views into <data>/state/jobs.json, so the roles go on to triage and apply. It never moves
// a query window or the canary counter.
// Output: <data>/probes/YYYYMMDD-HHMM-<name>.json, rewritten after every page load so an
// abort keeps what was already read. Analyse with scripts/probe-report.mjs.
//
// Exit codes: 0 done, 1 aborted by a guard, 2 refused (not enough cap left today, or
// --mark-verified on a probe that did not finish), 3 profile busy (not counted; never loop).

import './lib/env.mjs';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, out, fail, openContext, ProfileBusyError, sleep, jitter } from './cloak-core.mjs';
import * as linkedin from './linkedin-jobs.mjs';
import * as diceJobs from './dice-jobs.mjs';
import { buildSearchUrl } from './lib/search-url.mjs';
import { buildDiceUrl } from './lib/dice-url.mjs';
import { compilePrefilter, prefilterJob } from './lib/prefilter.mjs';
import { pickViewIds } from './lib/probe-metrics.mjs';
import { evaluateSearch, evaluateView } from './lib/guards.mjs';
import { DATA_DIR, STATE_PATH, loadState, saveStateAtomic, upsertCards, setPrefilter, setDetail } from './lib/state.mjs';
import { canPost, recordPost, getUsageSummary } from './rate-limiter.mjs';
import { loadConfig, loadSearchConfig, loadOwnConfig, saveConfig, readJsonFile } from './lib/config.mjs';
import { display, resolveArgPath } from './lib/paths.mjs';
import { logAction } from './lib/actions-log.mjs';

const log = (s) => process.stderr.write(`${s}\n`);

const { flags } = parseArgs(process.argv.slice(2));

// --mark-verified: the probe result is the evidence; the config is never hand-edited to verified.
if (flags['mark-verified']) {
  const resultPath = resolveArgPath(flags['mark-verified']);
  if (!resultPath || !existsSync(resultPath)) fail(`probe result not found: ${flags['mark-verified']}`);
  const r = readJsonFile(resultPath);
  const name = r.source === 'dice' ? 'dice-searches.json' : 'searches.json';
  if (!r.finished_at || r.aborted || !Array.isArray(r.searches) || !r.searches.length) {
    out({ success: false, refused: true, reason: `probe ${r.name || '?'} did not finish cleanly (aborted: ${r.aborted || 'no'}); it cannot verify ${name}` });
    process.exit(2);
  }
  const own = loadOwnConfig(name, {});
  // The shipped example queries are never verified: the workspace file must hold its own set.
  if (!Array.isArray(own.queries) || !own.queries.length || !own.canary) {
    out({ success: false, refused: true, reason: `workspace config/${name} has no own canary and queries yet; write the probed set there first` });
    process.exit(2);
  }
  const at = new Date().toISOString();
  const by = display(resultPath);
  saveConfig(name, { ...own, verified: true, verified_at: at, verified_by: by, ...(flags.report ? { verified_report: String(flags.report) } : {}) });
  logAction({ actor: 'agent', action: 'search.verified', source: r.source || 'linkedin', ref: by, detail: { config: name, probe: r.name, searches: r.searches.length } });
  log(`${name}: verified (probe ${r.name}, ${r.searches.length} searches).`);
  out({ success: true, verified: true, config: `config/${name}`, verified_at: at, verified_by: by });
  process.exit(0);
}

if (!flags.file) fail('Pass --file config/probes/<probe>.json');
const probeFile = resolveArgPath(flags.file);
if (!existsSync(probeFile)) fail(`probe file not found: ${flags.file}`);
const probe = readJsonFile(probeFile);
const dice = flags.source === 'dice' || probe.source === 'dice';
const cfg = loadSearchConfig(dice ? 'dice-searches.json' : 'searches.json');
const { searchJobs, viewJob, capture } = dice ? diceJobs : linkedin;
const buildUrl = dice ? buildDiceUrl : buildSearchUrl;
const platform = dice ? 'dice_jobs' : 'linkedin_jobs';
if (flags['into-state'] && !dice) fail('--into-state is for Dice probes only');
const intoState = !!flags['into-state'];
const state = intoState ? loadState(STATE_PATH) : null;
const P = compilePrefilter(loadConfig('prefilter.json'));
const startedAt = new Date();
const label = startedAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

const searches = probe.searches.map((s) => {
  const q = { ...probe.defaults, ...s };
  return { ...s, query: q, url: buildUrl(cfg, q, { tprSeconds: s.tpr_seconds || probe.tpr_seconds }) };
});
const explicitViews = probe.views || [];
const maxViews = explicitViews.length + searches.reduce((n, s) => n + (s.view_sample?.n || 0), 0);
const usage = getUsageSummary()[platform];

log(`probe ${probe.name} | ${searches.length} searches, up to ${maxViews} views | available today: ${usage.searches_per_day.available} searches, ${usage.job_views_per_day.available} views`);
if (flags['dry-run']) {
  searches.forEach((s) => log(`  ${s.id.padEnd(4)} ${s.keywords}${s.view_sample ? `  [views: ${s.view_sample.n} ${s.view_sample.where || 'any'}]` : ''}\n       ${s.url}`));
  explicitViews.forEach((v) => log(`  view ${v.job_id} (from ${v.probe})`));
  const eta = Math.round((searches.length * ((cfg.pacing.search_gap_ms[0] + cfg.pacing.search_gap_ms[1]) / 2 + 12000)
    + maxViews * ((cfg.pacing.view_gap_ms[0] + cfg.pacing.view_gap_ms[1]) / 2 + 6000)) / 60000);
  log(`\nDRY RUN. ~${eta} min. Writes ${display(join(DATA_DIR, 'probes', `${label}-${probe.name}.json`))}. No browser launched.`);
  out({ success: true, dry_run: true, probe: probe.name, searches: searches.length, views: maxViews, eta_minutes: eta });
  process.exit(0);
}

// A probe is only comparable if every query in it ran under the same conditions, so it
// refuses up front instead of running out of cap halfway.
if (searches.length > usage.searches_per_day.available || maxViews > usage.job_views_per_day.available) {
  log(`REFUSED: needs ${searches.length} searches / ${maxViews} views, cap left ${usage.searches_per_day.available} / ${usage.job_views_per_day.available}. Run after the daily cap reset.`);
  out({ success: false, refused: true });
  process.exit(2);
}

let context, page;
try {
  ({ context, page } = dice
    ? await openContext(diceJobs.DICE_PLATFORM, { headed: !!flags.headed, flags, dir: diceJobs.DICE_PROFILE })
    : await openContext('linkedin', { headed: !!flags.headed, flags }));
} catch (err) {
  if (err instanceof ProfileBusyError) {
    log(`SKIPPED: ${err.message}`);
    out({ success: false, profileBusy: true, profile: err.profile });
    process.exit(3);
  }
  throw err;
}

const result = { name: probe.name, source: dice ? 'dice' : 'linkedin', report: probe.report || (dice ? 'kept' : 'leadership'), file: display(probeFile), started_at: startedAt.toISOString(), finished_at: null, aborted: null, tpr_seconds: probe.tpr_seconds, searches: [], views: [] };
mkdirSync(join(DATA_DIR, 'probes'), { recursive: true });
const outPath = join(DATA_DIR, 'probes', `${label}-${probe.name}.json`);
const save = () => writeFileSync(outPath, JSON.stringify(result, null, 2));

try {
  let suspectStreak = 0;
  for (let i = 0; i < searches.length && !result.aborted; i++) {
    const s = searches[i];
    if (i > 0) await sleep(jitter(cfg.pacing.search_gap_ms));
    if (!canPost(platform, 'searches_per_day').allowed) { result.aborted = 'cap-reached'; break; }
    log(`[search] ${s.id}: ${s.keywords}`);
    let r;
    try { r = await searchJobs(page, s.url); } catch (err) { r = { status: 'suspect', cards: [], error: err.message.slice(0, 200) }; }
    recordPost(platform, 'searches_per_day', { probe: probe.name, query: s.id, via: 'probe' });
    // Every card carries its prefilter verdict: the kept-card report (Dice, LinkedIn IC) counts it.
    const scope = dice ? 'dice' : s.job_type ? 'generic' : s.scope || 'fractional';
    for (const c of r.cards) c.prefilter = prefilterJob(c, P, { scopes: [scope] });
    if (intoState && r.cards.length) {
      upsertCards(state, r.cards, { queryId: `${probe.name}:${s.id}`, scope, sweepId: `${probe.name}-${startedAt.toISOString()}`, now: new Date().toISOString() });
      for (const c of r.cards) if (!state.jobs[c.job_id].detail) setPrefilter(state, c.job_id, c.prefilter);
      saveStateAtomic(STATE_PATH, state);
    }
    // capture: true saves HTML + screenshot (data/captures, gitignored) for offline replay.
    if (s.capture) r.capture = await capture(page, `${probe.name}-${s.id}-search`).catch((err) => ({ error: err.message }));
    const g = evaluateSearch(r, { canary: false, suspectStreak });
    suspectStreak = g.suspectStreak;
    result.searches.push({
      id: s.id, keywords: s.keywords, query: s.query, url_requested: s.url, url_final: r.url ?? null, status: r.status,
      result_count: r.result_count ?? null, empty_marker: r.empty_marker ?? null, used_list_items: r.used_list_items ?? null,
      cards: r.cards, filler_count: r.filler_count ?? 0, capture: r.capture, error: r.error,
    });
    save();
    log(`         ${r.status} | ${r.cards.length} ids${r.result_count != null ? ` | header ${r.result_count}` : ''}`);
    if (g.abort) result.aborted = g.abort;
  }

  if (!result.aborted) {
    // already_viewed: IDs read by an earlier probe day, so samples go to postings not yet read.
    const taken = new Set([...explicitViews.map((v) => v.job_id), ...(probe.already_viewed || [])]);
    const queue = [...explicitViews];
    for (const s of searches) {
      const done = result.searches.find((x) => x.id === s.id);
      if (!s.view_sample || !done) continue;
      for (const id of pickViewIds(done.cards, s.view_sample, P, taken)) { taken.add(id); queue.push({ probe: s.id, job_id: id }); }
    }
    let unreadableStreak = 0;
    if (queue.length) log(`\n[views] ${queue.length} detail views`);
    for (const v of queue) {
      if (result.aborted) break;
      await sleep(jitter(cfg.pacing.view_gap_ms));
      if (!canPost(platform, 'job_views_per_day').allowed) { result.aborted = 'cap-reached'; break; }
      let d;
      try { d = await viewJob(page, v.job_id); } catch (err) { d = { status: 'unreadable', error: err.message.slice(0, 200) }; }
      recordPost(platform, 'job_views_per_day', { probe: probe.name, jobId: v.job_id, via: 'probe' });
      const g = evaluateView(d, { unreadableStreak });
      unreadableStreak = g.unreadableStreak;
      result.views.push({ probe: v.probe, ...d, job_id: v.job_id });
      if (intoState && d.status === 'ok' && state.jobs[v.job_id]) {
        const { status: _s, url: _u, ...detail } = d;
        setDetail(state, v.job_id, detail);
        setPrefilter(state, v.job_id, prefilterJob(state.jobs[v.job_id], P, { scopes: state.jobs[v.job_id].scopes }));
        if (d.closed) state.jobs[v.job_id].status = 'closed';
        saveStateAtomic(STATE_PATH, state);
      }
      save();
      log(`[view] ${v.job_id} (${v.probe}) ${d.status}${d.title ? ` | ${d.title} @ ${d.company}` : ''}${d.employment_type ? ` | ${d.employment_type}` : ''}${d.workplace ? `/${d.workplace}` : ''}`);
      if (g.abort) result.aborted = g.abort;
    }
  }
} finally {
  await context.close().catch(() => {});
  result.finished_at = new Date().toISOString();
  save();
}

logAction({ action: 'probe.run', source: result.source, ref: display(outPath), detail: { name: probe.name, searches: result.searches.length, views: result.views.length, aborted: result.aborted || null, into_state: intoState } });
log(`\n${result.searches.length} searches, ${result.views.length} views | guards: ${result.aborted || 'none'}\nprobe -> ${display(outPath)}`);
if (result.aborted === 'checkpoint' || result.aborted === 'login-lost') log('!! STOP. Same rules as a sweep abort: see docs/runbook.md §4.');
out({ success: !result.aborted, aborted: result.aborted, searches: result.searches.length, views: result.views.length, file: display(outPath) });
process.exit(result.aborted ? 1 : 0);
