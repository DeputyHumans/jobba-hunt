#!/usr/bin/env node
// Offline report over one or more probe result files (<data>/probes/*.json). No browser.
// Prints markdown: per-probe metrics, ID containment matrix, detail-view table and,
// with --cards, every card labelled FIT / core / blank (noise) plus R(emote).
//
// Usage: node scripts/probe-report.mjs <data>/probes/<yyyymmdd>-*.json [--cards] [--json] [--exclude-company "<regex>"]
// File paths resolve against the repo, then the workspace.

import './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { compilePrefilter } from './lib/prefilter.mjs';
import { withUniquePlausible, containment, labelCard, relevantIds } from './lib/probe-metrics.mjs';
import { loadConfig } from './lib/config.mjs';
import { resolveArgPath } from './lib/paths.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(`--${f}`);
const exIdx = args.indexOf('--exclude-company');
const excludeCompany = exIdx >= 0 ? new RegExp(args[exIdx + 1], 'i') : null;
const files = args.filter((a, i) => !a.startsWith('--') && !(exIdx >= 0 && i === exIdx + 1));
if (!files.length) { console.error('usage: probe-report.mjs <probe files...> [--cards] [--json]'); process.exit(1); }

const P = compilePrefilter(loadConfig('prefilter.json'));
const runs = files.map((f) => JSON.parse(readFileSync(resolveArgPath(f), 'utf8')));
if (runs.every((r) => r.source === 'dice' || r.report === 'kept')) { console.log(diceReport(runs)); process.exit(0); }

// Dice probes and LinkedIn hands-on probes (report "kept"): the decision rules count
// prefilter-kept cards (verdict saved by probe-searches.mjs), split by lane from the title.
function diceReport(diceRuns) {
  const has = (res, t) => res.some((r) => r.test(t || ''));
  const all = diceRuns.flatMap((r) => r.searches);
  const keptOf = (s) => s.cards.filter((c) => c.prefilter && c.prefilter.verdict !== 'drop');
  const lines = ['| Probe | Keywords | Status | Header | Cards | Kept | Kept % | Leadership | Hands-on | Easy Apply | Unique kept | Covered by |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const s of all) {
    const k = keptOf(s);
    const ids = new Set(k.map((c) => c.job_id));
    const others = all.filter((o) => o.id !== s.id).map((o) => ({ id: o.id, ids: new Set(keptOf(o).map((c) => c.job_id)) }));
    const unique = [...ids].filter((id) => !others.some((o) => o.ids.has(id)));
    // The other probe that holds the largest share of this probe's kept roles.
    const best = others.map((o) => ({ id: o.id, n: [...ids].filter((id) => o.ids.has(id)).length })).sort((a, b) => b.n - a.n)[0];
    const lead = k.filter((c) => has(P.titleLeadership, c.title) && !has(P.titleIc, c.title)).length;
    lines.push(`| ${s.id} | \`${s.keywords}\` | ${s.status} | ${s.result_count ?? '-'} | ${s.cards.length} | ${k.length} | ${s.cards.length ? Math.round((100 * k.length) / s.cards.length) : '-'}% | ${lead} | ${k.length - lead} | ${k.filter((c) => c.easy_apply).length} | ${unique.length} | ${best && ids.size ? `${best.id} ${Math.round((100 * best.n) / ids.size)}%` : '-'} |`);
  }
  const views = diceRuns.flatMap((r) => r.views);
  if (views.length) {
    lines.push('', '| Probe | Title @ Company | Contract types | Workplace | Pay | Apply |', '|---|---|---|---|---|---|');
    for (const v of views) lines.push(`| ${v.probe} | ${v.title || '?'} @ ${v.company || '?'} | ${(v.contract_types || []).join(', ') || '-'} | ${v.workplace || '-'} | ${v.comp_text || '-'} | ${v.apply?.type || '-'} |`);
  }
  if (flag('cards')) {
    for (const s of all) {
      lines.push('', `**${s.id}** \`${s.keywords}\``);
      for (const c of s.cards) lines.push(`- \`${c.prefilter?.verdict === 'drop' ? 'drop' : 'KEEP'}\` ${c.title} | ${c.company} | ${c.location} | ${c.employment_type || '-'} | ${c.pay_text || '-'}${c.prefilter?.verdict === 'drop' ? ` (${c.prefilter.reasons.join(', ')})` : ''}`);
    }
  }
  return lines.join('\n');
}
const searches = runs.flatMap((r) => r.searches);
const views = runs.flatMap((r) => r.views);
const rows = withUniquePlausible(searches, P);
// Latest readable view per job ID, from any probe file: structure evidence for "relevant".
const viewsById = Object.fromEntries(views.filter((v) => v.status === 'ok').map((v) => [v.job_id, v]));
const rel = Object.fromEntries(searches.map((s) => [s.id, relevantIds(s, viewsById, { excludeCompany, P })]));
const uniqueRel = Object.fromEntries(searches.map((s) => {
  const others = new Set(searches.filter((o) => o.id !== s.id).flatMap((o) => o.cards.map((c) => c.job_id)));
  return [s.id, rel[s.id].filter((id) => !others.has(id))];
}));
const matrix = containment(searches);
const any = (res, t) => res.some((r) => r.test(t || ''));

if (flag('json')) { console.log(JSON.stringify({ rows, relevant: rel, unique_relevant: uniqueRel, matrix, views }, null, 2)); process.exit(0); }

const filt = (q) => [q.workplace === 'any' ? 'any-wp' : q.workplace, q.job_type ? 'C,P' : null, ...Object.entries(q.params || {}).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(' ');
const pc = (v) => (v == null ? '-' : `${v}%`);
const out = [];
if (excludeCompany) out.push(`Relevant excludes companies matching /${excludeCompany.source}/i.\n`);
out.push('| Probe | Keywords | Filters | Status | Header | IDs | Trunc | Remote | Core | Fit | Relevant | Unique relevant |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of searches) {
  const m = rows.find((r) => r.id === s.id);
  out.push(`| ${s.id} | \`${s.keywords}\` | ${filt(s.query || {})} | ${s.status} | ${s.result_count ?? '-'} | ${m.ids} | ${m.truncated ? 'yes' : 'no'} | ${pc(m.remote_pct)} | ${pc(m.core_pct)} | ${pc(m.fit_pct)} | ${pc(m.ids ? Math.round((100 * rel[s.id].length) / m.ids) : null)} | ${uniqueRel[s.id].length}${uniqueRel[s.id].length ? ` (${uniqueRel[s.id].join(', ')})` : ''} |`);
}
const kept = searches.filter((s) => s.url_final && new URL(s.url_final).searchParams.get('keywords') !== s.keywords);
if (kept.length) out.push(`\nKeywords rewritten by LinkedIn: ${kept.map((s) => `${s.id} -> \`${new URL(s.url_final).searchParams.get('keywords')}\``).join(', ')}`);

out.push('\n**Containment** (row: % of its IDs that the column probe also returned)\n');
const ids = searches.map((s) => s.id);
out.push(`| | ${ids.join(' | ')} |`);
out.push(`|---|${ids.map(() => '---').join('|')}|`);
for (const r of ids) out.push(`| ${r} | ${ids.map((c) => (r === c ? '.' : matrix[r][c])).join(' | ')} |`);

if (views.length) {
  out.push('\n**Detail views**\n');
  out.push('| Probe | Job ID | Title @ Company | Type | Workplace | Scope signal in text | Comp | Applicants |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const v of views) {
    const hit = (v.description_text || '').match(P.scope.find((r) => r.test(v.description_text || '')) || /$^/);
    out.push(`| ${v.probe} | ${v.job_id} | ${v.title || '?'} @ ${v.company || '?'} | ${v.employment_type || '-'} | ${v.workplace || '-'} | ${hit ? `"${hit[0]}"` : 'none'} | ${v.comp_text || '-'} | ${v.applicants ?? '-'} |`);
  }
}

if (flag('cards')) {
  for (const s of searches) {
    out.push(`\n**${s.id}** \`${s.keywords}\` (${filt(s.query || {})})`);
    for (const c of s.cards) {
      const f = `${{ fit: 'FIT ', core: 'core', noise: '    ' }[labelCard(c, P)]} ${any(P.remote, c.location) ? 'R' : '.'}`;
      out.push(`- \`${f}\` ${c.job_id} | ${c.title} | ${c.company} | ${c.location}${c.promoted ? ' | promoted' : ''}`);
    }
  }
}
console.log(out.join('\n'));
