// Query-probe metrics. Pure: no browser, no network. Reads probe results written by
// scripts/probe-searches.mjs and measures how well each query targets the hunt, from
// card text only (title, location). Regexes come from config/prefilter.json via
// compilePrefilter, so "leadership", "scope" and "remote" mean the same here as in the sweep.

const any = (res, text) => res.some((r) => r.test(text || ''));
const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);

const isLead = (c, P) => any(P.titleLeadership, c.title) && !any(P.titleDrop, c.title);
const isRemote = (c, P) => any(P.remote, c.location);

// Relevance labels for the probe, stricter than the prefilter on purpose. title_leadership
// matches any "Director" and the remote filter makes remote 100% by construction, so
// lead+remote cannot tell a good query from a bad one.
//   core = a title in the operator's core set: prefilter.json probe_core_title, else title_exec
//   fit  = core AND a strict structure word in the title: probe_strict_scope, else scope_signals
// Keep "advisor" and "consulting" out of probe_strict_scope: many advisor titles are full-time,
// and "Consulting Director" is a department, not an engagement type.
// Titles are read with "_" as a space: JS treats "_" as a word character, so \bcto\b would miss
// "CTO_Remote".
const norm = (t) => String(t || '').replace(/_/g, ' ');
const isCore = (c, P) => any(P.probeCore, norm(c.title));
const strictScope = (c, P) => any(P.probeScope, norm(c.title));
const isFit = (c, P) => isCore(c, P) && strictScope(c, P);
export const labelCard = (c, P) => (isFit(c, P) ? 'fit' : isCore(c, P) ? 'core' : 'noise');

// Relevant = core title AND engagement structure from ANY source (contract or part-time counts as
// fractional; the title need not say "fractional"):
//   - a structure word in the title, or
//   - the probe ran with the contract/part-time job-type filter, or
//   - a detail view shows a Contract/Part-time/Temporary tag, or structure in the text.
// The description test is narrower than the title one: "contract" alone matches
// "futures contracts", so it needs "contract role/basis/..." or an hours-per-week line.
const DESC_STRUCTURE = /(?<![a-z])(fractional|part[- ]time|interim)(?![a-z])|contract (role|position|basis|engagement|assignment)|\d{1,2}\s*(-|to|–)\s*\d{1,2}\s*(hrs|hours)\s*(\/|per|a)\s*(wk|week)/i;
const viewShowsStructure = (v) => !!v && (/^(contract|part-time|temporary)$/i.test(v.employment_type || '') || DESC_STRUCTURE.test(v.description_text || ''));

// P is the compiled prefilter (compilePrefilter): it carries the core and strict-scope sets.
export function relevantIds(probe, viewsById = {}, { excludeCompany = null, P } = {}) {
  if (!P) throw new Error('relevantIds needs the compiled prefilter (P)');
  const filtered = !!probe.query?.job_type;
  return (probe.cards || [])
    .filter((c) => isCore(c, P) && !(excludeCompany && excludeCompany.test(c.company || '')))
    .filter((c) => filtered || strictScope(c, P) || viewShowsStructure(viewsById[c.job_id]))
    .map((c) => c.job_id);
}

export function probeMetrics(probe, P) {
  const cards = probe.cards || [];
  const n = cards.length;
  const plausible = cards.filter((c) => isLead(c, P) && isRemote(c, P));
  const fit = cards.filter((c) => isFit(c, P));
  return {
    id: probe.id,
    result_count: probe.result_count ?? null,
    ids: n,
    truncated: probe.result_count != null ? probe.result_count > n : n >= 25,
    remote_pct: pct(cards.filter((c) => isRemote(c, P)).length, n),
    lead_pct: pct(cards.filter((c) => isLead(c, P)).length, n),
    scope_pct: pct(cards.filter((c) => any(P.scope, c.title)).length, n),
    plausible_pct: pct(plausible.length, n),
    plausible_ids: plausible.map((c) => c.job_id),
    core_pct: pct(cards.filter((c) => isCore(c, P)).length, n),
    fit_pct: pct(fit.length, n),
    fit_ids: fit.map((c) => c.job_id),
  };
}

// containment[row][col] = % of row's IDs that col also returned.
export function containment(probes) {
  const sets = Object.fromEntries(probes.map((p) => [p.id, new Set((p.cards || []).map((c) => c.job_id))]));
  const m = {};
  for (const r of probes) {
    m[r.id] = {};
    for (const c of probes) {
      const rs = sets[r.id];
      m[r.id][c.id] = pct([...rs].filter((id) => sets[c.id].has(id)).length, rs.size);
    }
  }
  return m;
}

// Metrics plus the plausible IDs that no other probe returned at all.
export function withUniquePlausible(probes, P) {
  return probes.map((p) => {
    const m = probeMetrics(p, P);
    const others = new Set(probes.filter((o) => o.id !== p.id).flatMap((o) => (o.cards || []).map((c) => c.job_id)));
    const unique = m.plausible_ids.filter((id) => !others.has(id));
    const uniqueFit = m.fit_ids.filter((id) => !others.has(id));
    return { ...m, unique_plausible_ids: unique, unique_plausible: unique.length, unique_fit_ids: uniqueFit, unique_fit: uniqueFit.length };
  });
}

// Detail-view sample for one probe: first n cards matching `where` that no earlier
// probe already sampled. where: any | lead | non-remote.
export function pickViewIds(cards, { n = 0, where = 'any' } = {}, P, taken) {
  const ok = {
    any: () => true,
    lead: (c) => isLead(c, P),
    'non-remote': (c) => !isRemote(c, P),
    // Dice probes save each card's prefilter verdict.
    kept: (c) => !!c.prefilter && c.prefilter.verdict !== 'drop',
  }[where];
  if (!ok) throw new Error(`unknown view_sample.where "${where}"`);
  const out = [];
  for (const c of cards) {
    if (out.length >= n) break;
    if (taken.has(c.job_id) || !ok(c)) continue;
    out.push(c.job_id);
  }
  return out;
}
