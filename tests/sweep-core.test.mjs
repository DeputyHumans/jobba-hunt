import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'jobba-core-'));
process.env.JOBBA_LIMITS_LOG = join(dir, 'limits-log.json');
const { createRun } = await import('../scripts/lib/sweep-core.mjs');
const { emptyState } = await import('../scripts/lib/state.mjs');
const { compilePrefilter } = await import('../scripts/lib/prefilter.mjs');
const limiter = await import('../scripts/rate-limiter.mjs');

const tpl = (name) => JSON.parse(readFileSync(new URL(`../templates/workspace/config/${name}`, import.meta.url), 'utf8'));
const cfg = {
  ...tpl('searches.json'),
  canary: { id: 'canary-semantic', keywords: '"fractional CTO"', scope: 'semantic', base_url: 'https://www.linkedin.com/jobs/search-results/', geo: 'us', workplace: 'any', tpr_seconds: 604800 },
  queries: [
    { id: 'fractional-leaders', keywords: 'fractional CTO OR interim CTO', scope: 'fractional', geo: 'us', workplace: 'remote' },
    { id: 'leadership-remote', keywords: 'head of engineering', scope: 'generic', geo: 'us', workplace: 'remote' },
  ],
  pacing: { search_gap_ms: [0, 0], view_gap_ms: [0, 0], settle_ms: [0, 0] },
};
const P = compilePrefilter(tpl('prefilter.json'), { onsiteMetros: [], accept: ['c2c', '1099', 'w2', 'full-time', 'contract', 'part-time'], icRateFloor: null, ftSalaryFloor: null });
const q = cfg.queries.find((x) => x.id === 'fractional-leaders');
const item = { kind: 'query', id: q.id, keywords: q.keywords, scope: q.scope, canary: false, query: q, tprSeconds: 3600 };
const canaryItem = { kind: 'canary', id: cfg.canary.id, keywords: cfg.canary.keywords, scope: cfg.canary.scope, canary: true, query: cfg.canary, tprSeconds: 604800 };
const card = (id) => ({ job_id: id, title: 'Fractional CTO', company: 'Acme Corp', location: 'United States (Remote)', url: `https://www.linkedin.com/jobs/view/${id}/` });

function harness({ search, view, suspectStreak = 0 }) {
  const state = emptyState();
  const run = createRun({
    page: null, state, cfg, P, runId: 'tick-test', log: () => {}, suspectStreak,
    statePath: join(mkdtempSync(join(tmpdir(), 'jobba-core-state-')), 'jobs.json'),
    io: { searchJobs: async (_p, url) => ({ ...search(url), url }), viewJob: async (_p, id) => view(id) },
    limiter,
  });
  return { state, run };
}

test('the run refuses to start without page readers or the rate limiter', () => {
  const base = { page: null, state: emptyState(), cfg, P, runId: 'x', log: () => {} };
  assert.throws(() => createRun({ ...base, limiter }), /io\.searchJobs/);
  assert.throws(() => createRun({ ...base, io: { searchJobs: async () => ({}), viewJob: async () => ({}) } }), /rate limiter/);
});

test('an ok search stores the cards and moves that query window start', async () => {
  const { state, run } = harness({ search: () => ({ status: 'ok', cards: [card('9000000001')], result_count: 1 }) });
  await run.searchQuery(item);
  assert.equal(run.abort, null);
  assert.ok(state.jobs['9000000001']);
  assert.ok(state.query_runs['fractional-leaders'].last_ok);
  assert.equal(run.perQuery[0].tpr_seconds, 3600);
});

test('an empty classic search is not an abort and still moves the window', async () => {
  const { state, run } = harness({ search: () => ({ status: 'empty', cards: [] }) });
  await run.searchQuery(item);
  assert.equal(run.abort, null);
  assert.ok(state.query_runs['fractional-leaders']);
});

test('a suspect search does not move the window, and the streak carried in from the last tick aborts', async () => {
  const { state, run } = harness({ search: () => ({ status: 'suspect', cards: [] }), suspectStreak: 1 });
  await run.searchQuery(item);
  assert.equal(run.abort, 'throttle-suspect');
  assert.equal(run.suspectStreak, 2);
  assert.equal(state.query_runs['fractional-leaders'], undefined);
});

test('an empty canary aborts (semantic search is never legitimately empty)', async () => {
  const { run } = harness({ search: () => ({ status: 'empty', cards: [] }) });
  await run.searchQuery(canaryItem);
  assert.equal(run.abort, 'canary-empty');
});

test('the canary search keeps its fixed config window', async () => {
  let seen;
  const { run } = harness({ search: (url) => { seen = url; return { status: 'ok', cards: [card('9000000002')] }; } });
  await run.searchQuery(canaryItem);
  assert.match(seen, /f_TPR=r604800/);
});

test('a viewed role stores its detail and reports the apply type', async () => {
  const { state, run } = harness({
    search: () => ({ status: 'ok', cards: [card('9000000003')] }),
    view: () => ({ status: 'ok', title: 'Fractional CTO', company: 'Acme Corp', employment_type: 'Contract', workplace: 'Remote', description_text: 'Fractional CTO, 15 hours a week, remote.', apply: { type: 'easy' } }),
  });
  await run.searchQuery(item);
  run.prefilterTouched();
  await run.viewQueue(5);
  assert.equal(state.jobs['9000000003'].status, 'viewed');
  assert.equal(state.jobs['9000000003'].detail.apply.type, 'easy');
  assert.equal(run.views[0].apply_type, 'easy');
});

test('page 2 for any query when at least new_share_for_next of page 1 is new; not when page 1 was mostly seen', async () => {
  const g = cfg.queries.find((x) => x.id === 'leadership-remote');
  const gi = { kind: 'query', id: g.id, keywords: g.keywords, scope: g.scope, canary: false, query: g, tprSeconds: 3600 };
  const pageOf = (url, base) => Array.from({ length: 25 }, (_, i) => card(String(base + (url.includes('start=25') ? 100 : 0) + i)));
  // All new: page 2 is read.
  let urls = [];
  const a = harness({ search: (url) => { urls.push(url); return { status: 'ok', cards: pageOf(url, 9000000000), result_count: 99 }; }, view: () => ({ status: 'ok' }) });
  await a.run.searchQuery(gi);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /start=25/);
  // Mostly seen: page 1 only.
  urls = [];
  const b = harness({ search: (url) => { urls.push(url); return { status: 'ok', cards: pageOf(url, 9000000500), result_count: 99 }; }, view: () => ({ status: 'ok' }) });
  const { upsertCards } = await import('../scripts/lib/state.mjs');
  upsertCards(b.state, Array.from({ length: 20 }, (_, i) => card(String(9000000500 + i))), { queryId: g.id, scope: g.scope, sweepId: 'earlier', now: new Date().toISOString() });
  await b.run.searchQuery(gi);
  assert.equal(urls.length, 1);
});

test('a lost browser (chrome driver) ends the run as browser-unavailable, never halts, and counts a load only if it happened', async () => {
  const { BrowserUnavailableError } = await import('../scripts/lib/bridge.mjs');
  const { haltsSource } = await import('../scripts/lib/tick-plan.mjs');
  const searches = () => limiter.getUsageSummary().linkedin_jobs?.searches_per_day?.count ?? 0;
  const before = searches();
  const { state, run } = harness({ search: () => { throw new BrowserUnavailableError('no response to rq-1', { loaded: false }); }, view: () => ({ status: 'ok' }) });
  const r = await run.searchQuery(item);
  assert.equal(r, null);
  assert.equal(run.abort, 'browser-unavailable');
  assert.match(run.browserError, /no response/);
  assert.equal(haltsSource(run.abort), false);
  assert.equal(searches(), before, 'no load happened: nothing counted');
  assert.equal(state.query_runs['fractional-leaders'], undefined, 'the window does not move');
  assert.equal(run.perQuery.length, 0, 'no guard read a page');
  const loaded = harness({ search: () => { throw new BrowserUnavailableError('integrity: hash mismatch', { loaded: true }); }, view: () => ({ status: 'ok' }) });
  await loaded.run.searchQuery(item);
  assert.equal(loaded.run.abort, 'browser-unavailable');
  assert.equal(searches(), before + 1, 'the load the agent made counts');
});
