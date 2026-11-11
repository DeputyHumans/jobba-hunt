import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, planSearches } from '../scripts/lib/search-url.mjs';

const cfg = {
  base_url: 'https://www.linkedin.com/jobs/search/',
  sort: 'DD',
  geos: { us: { geoId: '103644278' }, 'example-metro': { geoId: '90000001' } },
  workplace: { remote: { f_WT: '2' }, any: {} },
  job_types: { 'contract-part-time': { f_JT: 'C,P' } },
  canary: { id: 'canary-cto', keywords: 'CTO', geo: 'us', workplace: 'any', tpr_seconds: 604800 },
  queries: [
    { id: 'fractional-cto', keywords: 'fractional CTO', scope: 'fractional', geo: 'us', workplace: 'remote' },
    { id: 'cto-contract', keywords: 'CTO', scope: 'generic', geo: 'us', workplace: 'remote', job_type: 'contract-part-time' },
  ],
  paging: { page_size: 25, max_pages: 2 },
};

test('builds a search URL with keywords, geo, time window, workplace and sort', () => {
  const u = new URL(buildSearchUrl(cfg, cfg.queries[0], { tprSeconds: 93600 }));
  assert.equal(u.origin + u.pathname, 'https://www.linkedin.com/jobs/search/');
  assert.equal(u.searchParams.get('keywords'), 'fractional CTO');
  assert.equal(u.searchParams.get('geoId'), '103644278');
  assert.equal(u.searchParams.get('f_TPR'), 'r93600');
  assert.equal(u.searchParams.get('f_WT'), '2');
  assert.equal(u.searchParams.get('sortBy'), 'DD');
  assert.equal(u.searchParams.has('f_JT'), false, 'fractional-scope queries never carry the job-type filter');
  assert.equal(u.searchParams.has('start'), false);
});

test('generic queries carry the contract/part-time job-type filter', () => {
  const u = new URL(buildSearchUrl(cfg, cfg.queries[1], { tprSeconds: 86400 }));
  assert.equal(u.searchParams.get('f_JT'), 'C,P');
});

test('page 2 sets start to the page size', () => {
  const u = new URL(buildSearchUrl(cfg, cfg.queries[0], { tprSeconds: 86400, page: 1 }));
  assert.equal(u.searchParams.get('start'), '25');
});

test('unknown geo or workplace key throws instead of silently widening the search', () => {
  assert.throws(() => buildSearchUrl(cfg, { ...cfg.queries[0], geo: 'mars' }, { tprSeconds: 1 }), /geo/);
  assert.throws(() => buildSearchUrl(cfg, { ...cfg.queries[0], workplace: 'moon' }, { tprSeconds: 1 }), /workplace/);
});

test('plan puts the canary first with its fixed window, then every query with the sweep window', () => {
  const plan = planSearches(cfg, { tprSeconds: 90000 });
  assert.equal(plan.length, 3);
  assert.equal(plan[0].id, 'canary-cto');
  assert.equal(plan[0].canary, true);
  assert.equal(new URL(plan[0].url).searchParams.get('f_TPR'), 'r604800');
  assert.equal(new URL(plan[1].url).searchParams.get('f_TPR'), 'r90000');
  assert.equal(plan[1].scope, 'fractional');
});

test('query.params are applied verbatim and override the configured sort', () => {
  const q = { ...cfg.queries[1], params: { f_E: '5,6', sortBy: 'R' } };
  const u = new URL(buildSearchUrl(cfg, q, { tprSeconds: 604800 }));
  assert.equal(u.searchParams.get('f_E'), '5,6');
  assert.equal(u.searchParams.get('sortBy'), 'R');
  assert.equal(u.searchParams.get('f_JT'), 'C,P');
});

test('query.base_url overrides the configured endpoint (AI job search probe)', () => {
  const q = { ...cfg.queries[0], base_url: 'https://www.linkedin.com/jobs/search-results/' };
  const u = new URL(buildSearchUrl(cfg, q, { tprSeconds: 604800 }));
  assert.equal(u.origin + u.pathname, 'https://www.linkedin.com/jobs/search-results/');
  assert.equal(u.searchParams.get('keywords'), 'fractional CTO');
});

test('canary takes scope and endpoint from config (AI-search canary is productive, not canary-only)', () => {
  const c2 = { ...cfg, canary: { id: 'ai-fractional-cto', keywords: 'fractional CTO', scope: 'semantic', base_url: 'https://www.linkedin.com/jobs/search-results/', geo: 'us', workplace: 'any', tpr_seconds: 604800 } };
  const plan = planSearches(c2, { tprSeconds: 90000 });
  assert.equal(plan[0].scope, 'semantic');
  assert.equal(plan[0].canary, true);
  assert.equal(new URL(plan[0].url).pathname, '/jobs/search-results/');
  assert.equal(planSearches(cfg, { tprSeconds: 90000 })[0].scope, 'canary', 'a canary without a configured scope stays a pure control');
});
