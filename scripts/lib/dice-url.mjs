// Dice job search URL builder. Pure: no browser, no network.
// Param names come from config/dice-searches.json (filters.* seen live 2026-10-28,
// runbook "Dice"), so a Dice change is a config edit, not a code change.

const DAY = 86400;

// Dice's firewall answered 403 to quoted phrases joined by OR ("A" OR "B"), live
// 2026-10-28. A single quoted phrase and an unquoted OR both loaded. Refuse the pattern
// before it reaches Dice: one 403 aborts the Dice tick for the day.
export function unsafeDiceQuery(q) {
  return /"/.test(q || '') && /\bOR\b/.test(q || '');
}

// Dice only filters by posted-date buckets. Pick the smallest bucket that still covers
// the time since the query's last ok run (plus the window buffer), so nothing is missed.
export function postedBucket(seconds) {
  if (seconds <= DAY) return 'ONE';
  if (seconds <= 3 * DAY) return 'THREE';
  return 'SEVEN';
}

function lookup(table, key, kind) {
  const v = table?.[key];
  if (!v) throw new Error(`unknown ${kind} "${key}" in config/dice-searches.json`);
  return v;
}

export function buildDiceUrl(cfg, query, { tprSeconds, page = 0 }) {
  if (unsafeDiceQuery(query.keywords)) throw new Error(`Dice query "${query.keywords}" joins quoted phrases with OR: Dice answers 403 (runbook "Dice")`);
  const u = new URL(query.base_url || cfg.base_url);
  u.searchParams.set('q', query.keywords);
  u.searchParams.set('countryCode', cfg.country || 'US');
  for (const [k, v] of Object.entries(lookup(cfg.workplace, query.workplace || 'remote', 'workplace'))) u.searchParams.set(k, v);
  for (const [k, v] of Object.entries(lookup(cfg.employment, query.employment || 'contract', 'employment'))) u.searchParams.set(k, v);
  u.searchParams.set('filters.postedDate', postedBucket(tprSeconds));
  for (const [k, v] of Object.entries(query.params || {})) u.searchParams.set(k, String(v));
  if (page > 0) u.searchParams.set('page', String(page + 1));
  return u.toString();
}
