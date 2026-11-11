// Search, prefilter and view steps shared by the daily sweep (sweep-jobs.mjs) and the
// loop ticks (tick.mjs, dice-tick.mjs). One browser page, sequential, paced; every page load
// goes through the rate limiter and every result through the abort guards. The caller owns
// the browser session, the plan and the pacing between searches.
//
// This module imports nothing outside lib/: the caller passes the page readers (io) and the
// rate limiter, so the same core runs LinkedIn, Dice and the tests.

import { buildSearchUrl } from './search-url.mjs';
import { prefilterJob } from './prefilter.mjs';
import { evaluateSearch, evaluateView } from './guards.mjs';
import { STATE_PATH, saveStateAtomic, upsertCards, setPrefilter, setDetail, viewCandidates, touchedIds, markQueryRun } from './state.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

// io: { searchJobs(page, url), viewJob(page, id), buildUrl? } (linkedin-jobs.mjs or dice-jobs.mjs
// and their URL builder; fakes in tests). limiter: { canPost, recordPost } from rate-limiter.mjs.
// Both are required: a run without a limiter would load pages outside the caps. `platform` is the
// rate-limiter group, `source` picks the view queue, and `loop` holds the per-query window starts
// (the state root for LinkedIn, state.sources.dice for Dice).
export function createRun({ page, state, cfg, P, runId, log, suspectStreak = 0, statePath = STATE_PATH, io = {}, limiter, platform = 'linkedin_jobs', source = 'linkedin', loop = state, pageScopes = ['fractional'] }) {
  if (!io.searchJobs || !io.viewJob) throw new Error('createRun needs io.searchJobs and io.viewJob');
  if (!limiter?.canPost || !limiter?.recordPost) throw new Error('createRun needs the rate limiter (canPost, recordPost)');
  const { canPost, recordPost } = limiter;
  io = { buildUrl: buildSearchUrl, ...io };
  const run = { perQuery: [], views: [], abort: null, budgetExhausted: false, suspectStreak };
  const save = () => saveStateAtomic(statePath, state);

  // One search results page. Plan items carry their own window (tprSeconds); the canary
  // keeps its fixed config window. An ok or empty page 1 moves that query's window start.
  async function search(p, pageIdx) {
    if (!canPost(platform, 'searches_per_day').allowed) { run.budgetExhausted = true; return null; }
    const tpr = p.canary ? p.query.tpr_seconds : p.tprSeconds;
    const url = io.buildUrl(cfg, p.query, { tprSeconds: tpr, page: pageIdx });
    const startedAt = new Date().toISOString();
    log(`[search] ${p.id}${pageIdx ? ` p${pageIdx + 1}` : ''}: ${p.keywords}`);
    let r;
    try {
      r = await io.searchJobs(page, url);
    } catch (err) {
      r = { status: 'suspect', cards: [], error: err.message.slice(0, 200), url };
    }
    recordPost(platform, 'searches_per_day', { runId, query: p.id, page: pageIdx });
    const g = evaluateSearch(r, { canary: p.canary, suspectStreak: run.suspectStreak });
    run.suspectStreak = g.suspectStreak;
    const { newIds, seenIds } = upsertCards(state, r.cards, { queryId: p.id, scope: p.scope, sweepId: runId, now: new Date().toISOString() });
    if (pageIdx === 0 && !g.abort && (r.status === 'ok' || r.status === 'empty')) markQueryRun(loop, p.id, startedAt);
    save();
    run.perQuery.push({ id: p.id, page: pageIdx, tpr_seconds: tpr, status: r.status, result_count: r.result_count ?? null, ids: r.cards.length, new: newIds.length, seen: seenIds.length, used_list_items: r.used_list_items ?? null, error: r.error });
    log(`         ${r.status} | ${r.cards.length} ids (${newIds.length} new)${r.result_count != null ? ` | header says ${r.result_count}` : ''}`);
    if (g.abort) run.abort = g.abort;
    r.newCount = newIds.length;
    return r;
  }

  // Page 1, then page 2+ only for queries in pageScopes (fractional on LinkedIn; every Dice
  // query in a Dice sweep) whose previous page came back full.
  run.searchQuery = async (p) => {
    const r = await search(p, 0);
    if (!r || run.abort) return r;
    // Any query also reads the next page when the last one came back full and mostly new (at least
    // `new_share_for_next` of it), while the day's search cap allows: a broad query can bring many
    // new roles on one page, and page 2 then holds more of them.
    const share = (x) => (x?.cards?.length ? (x.newCount || 0) / x.cards.length : 0);
    const nextShare = cfg.paging.new_share_for_next ?? 1.01;
    const wantNext = (x) => pageScopes.includes(p.scope) || (share(x) >= nextShare && canPost(platform, 'searches_per_day').allowed);
    let full = r.cards.length >= cfg.paging.page_size;
    let last = r;
    for (let pg = 1; pg < cfg.paging.max_pages && full && wantNext(last) && !run.abort; pg++) {
      await sleep(jitter(cfg.pacing.search_gap_ms));
      const r2 = await search(p, pg);
      last = r2;
      full = !!r2 && r2.cards.length >= cfg.paging.page_size;
    }
    return r;
  };

  // Prefilter after the searches: scopes accumulate across queries within one run.
  run.prefilterTouched = () => {
    for (const id of touchedIds(state, runId)) {
      const j = state.jobs[id];
      if (!j.detail) setPrefilter(state, id, prefilterJob(j, P, { scopes: j.scopes }));
    }
    save();
  };

  run.viewQueue = async (limit) => {
    const queue = viewCandidates(state, { limit, source });
    let unreadableStreak = 0;
    if (queue.length) log(`\n[views] ${queue.length} detail views queued`);
    for (let i = 0; i < queue.length && !run.abort; i++) {
      if (!canPost(platform, 'job_views_per_day').allowed) { run.budgetExhausted = true; break; }
      await sleep(jitter(cfg.pacing.view_gap_ms));
      const id = queue[i];
      let v;
      try { v = await io.viewJob(page, id); } catch (err) { v = { status: 'unreadable', error: err.message.slice(0, 200) }; }
      recordPost(platform, 'job_views_per_day', { runId, jobId: id });
      const g = evaluateView(v, { unreadableStreak });
      unreadableStreak = g.unreadableStreak;
      if (v.status === 'ok') {
        const { status: _s, url: _u, ...detail } = v;
        setDetail(state, id, detail);
        setPrefilter(state, id, prefilterJob(state.jobs[id], P, { scopes: state.jobs[id].scopes }));
        if (v.closed) state.jobs[id].status = 'closed';
        save();
      }
      run.views.push({ id, status: v.status, closed: v.closed ?? null, verdict: state.jobs[id].prefilter?.verdict ?? null, apply_type: v.apply?.type ?? null, error: v.error });
      log(`[view] ${id} ${v.status}${v.title ? ` | ${v.title} @ ${v.company}` : ''}${v.employment_type ? ` | ${v.employment_type}` : ''}${v.workplace ? `/${v.workplace}` : ''}${v.apply?.type ? ` | apply: ${v.apply.type}` : ''} -> ${state.jobs[id].prefilter?.verdict}`);
      if (g.abort) run.abort = g.abort;
    }
  };

  return run;
}

// Roles touched by this run that survived the prefilter, for the snapshot and the loop.
export function survivorsOf(state, runId) {
  return touchedIds(state, runId).map((id) => state.jobs[id])
    .filter((j) => j.prefilter && j.prefilter.verdict !== 'drop')
    .map((j) => ({ job_id: j.job_id, title: j.title, company: j.company, location: j.location, verdict: j.prefilter.verdict, reasons: j.prefilter.reasons, flags: j.prefilter.flags, viewed: !!j.detail, status: j.status, repost_of: j.repost_of, url: j.url }));
}

export function pendingTriageCount(state) {
  return Object.values(state.jobs).filter((j) => j.detail && !j.triage && j.prefilter?.verdict !== 'drop' && j.status !== 'closed').length;
}
