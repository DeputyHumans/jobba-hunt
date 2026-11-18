// LinkedIn Jobs search URL builder. Pure: no browser, no network.
// Param codes come from config/searches.json (docs/platforms.md "LinkedIn"), so a
// LinkedIn change is a config edit, not a code change.

function lookup(table, key, kind) {
  const v = table?.[key];
  if (!v) throw new Error(`unknown ${kind} "${key}" in config/searches.json`);
  return v;
}

export function buildSearchUrl(cfg, query, { tprSeconds, page = 0 }) {
  const u = new URL(query.base_url || cfg.base_url);
  u.searchParams.set('keywords', query.keywords);
  u.searchParams.set('geoId', lookup(cfg.geos, query.geo, 'geo').geoId);
  u.searchParams.set('f_TPR', `r${Math.round(tprSeconds)}`);
  for (const [k, v] of Object.entries(lookup(cfg.workplace, query.workplace, 'workplace'))) u.searchParams.set(k, v);
  // The job-type filter goes only on generic queries: fractional roles are often
  // mis-tagged as full-time, so filtering them on f_JT would hide exactly what we want.
  if (query.job_type) {
    for (const [k, v] of Object.entries(lookup(cfg.job_types, query.job_type, 'job_type'))) u.searchParams.set(k, v);
  }
  if (cfg.sort) u.searchParams.set('sortBy', cfg.sort);
  // Raw extra params (f_E, sortBy, ...) for probes and per-query overrides. Applied last, so they win.
  for (const [k, v] of Object.entries(query.params || {})) u.searchParams.set(k, String(v));
  if (page > 0) u.searchParams.set('start', String(page * (cfg.paging?.page_size || 25)));
  return u.toString();
}

// Canary first (fixed wide window), then every configured query with its window:
// tprById[id] (per-query, from tick-plan queryWindow) or the shared tprSeconds.
// The canary's scope comes from config: a productive canary (the AI-search query, scope
// "semantic") feeds triage; one without a scope is a pure control whose hits are dropped.
export function planSearches(cfg, { tprSeconds, tprById = {} }) {
  const c = cfg.canary;
  const plan = [{
    id: c.id, keywords: c.keywords, scope: c.scope || 'canary', canary: true, query: c, tprSeconds: c.tpr_seconds,
    url: buildSearchUrl(cfg, c, { tprSeconds: c.tpr_seconds }),
  }];
  for (const q of cfg.queries) {
    const tpr = tprById[q.id] ?? tprSeconds;
    plan.push({ id: q.id, keywords: q.keywords, scope: q.scope, canary: false, query: q, tprSeconds: tpr, url: buildSearchUrl(cfg, q, { tprSeconds: tpr }) });
  }
  return plan;
}
