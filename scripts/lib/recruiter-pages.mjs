// The two published pages of a recruiter list (pipeline/recruiter/<list>/roles.json): the index (roles
// in order of preference, each with its fit score, two labelled comments, the posting and the tailored
// CV) and the role analysis (score breakdown, requirement by requirement, CV coverage, method).
// Pure: no filesystem, no network. Neutral brand: a text wordmark (preferences.brand.wordmark or the
// user's display name), an optional mark, the accent colour from preferences.brand.accent. Static
// HTML: a published copy runs no scripts.

import { applicationEmail, tiers as profileTiers, tz as profileTz } from './profile.mjs';
import { markSvg } from './brand-mark.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const dayLabel = (iso) => DAY.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
// Link expiry is a moment, read in the user's time zone (preferences.schedule.tz): an end-of-day
// expiry stored in UTC can fall on the evening before in that zone.
export const untilLabel = (iso, zone = profileTz()) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone || 'UTC' }).format(new Date(iso));

// Tiers from preferences.tiers (A from 80, B from 65 by default), the same cut-offs triage uses.
export const DEFAULT_TIERS = { a: 80, b: 65 };
const tierCuts = (t) => ({ a: Number(t?.a ?? DEFAULT_TIERS.a), b: Number(t?.b ?? DEFAULT_TIERS.b) });
export const tierLabel = (score, t = DEFAULT_TIERS) => { const c = tierCuts(t); return score >= c.a ? 'Strong fit' : score >= c.b ? 'Good fit' : 'Partial fit'; };

// The fit score's dimensions: [key, label, weight]. Weights come from preferences.recruiter_weights
// (dimsFrom); these are the defaults, and they sum to 100.
export const DEFAULT_WEIGHTS = { mandate: 35, domain: 20, stage: 20, stack: 10, signal: 15 };
const LABELS = { mandate: 'Mandate', domain: 'Domain', stage: 'Stage', stack: 'Stack', signal: 'Posting quality' };
export const dimsFrom = (weights = {}) => Object.entries(LABELS).map(([k, label]) => [k, label, Number(weights?.[k] ?? DEFAULT_WEIGHTS[k])]);
export const DIMS = dimsFrom(DEFAULT_WEIGHTS);
const STATUS = { met: 'Met', partial: 'Partial', gap: 'Gap' };

// Each role's dimension scores must add up to its fit score, and every requirement needs a known status.
export function checkRoles(roles, dims = DIMS) {
  const errs = [];
  const total = dims.reduce((a, [, , w]) => a + w, 0);
  if (total !== 100) errs.push(`weights sum to ${total}, not 100`);
  for (const r of roles) {
    const sum = Math.round(dims.reduce((a, [k, , w]) => a + ((r.dims?.[k] ?? NaN) / 5) * w, 0));
    if (sum !== r.score) errs.push(`${r.company}: dimensions give ${sum}, score says ${r.score}`);
    for (const q of r.requirements || []) if (!STATUS[q.status]) errs.push(`${r.company}: unknown status ${q.status}`);
  }
  return errs;
}

// Which link each page shows. While the share links are open: a CV's share link, and the analysis's share
// link on the index. The analysis links the index only where its reader can open it: a reader who came by
// the analysis share link cannot open a members-only index.
export function resolveLinks(roles, { docs = {}, share = null, now = Date.now() } = {}) {
  const open = !!share && Date.parse(share.expires) > now;
  const shared = (k) => (open && share.pages?.[k]) || null;
  return {
    until: open ? share.expires : null,
    cvUrls: Object.fromEntries(roles.map((r) => [r.cv, (open && share.links?.[r.cv]) || docs[r.cv]?.url || null])),
    analysisUrl: shared('analysis') || docs.analysis?.url || null,
    indexUrl: shared('index') || (shared('analysis') ? null : docs.index?.url || null),
  };
}

// accent overrides the stylesheet's accent token (--blue) when it is a hex colour.
function shell({ title, kicker, date, body }, { css, fontsCss = '', mark = null, wordmark = '', accent = null }) {
  const accentCss = /^#[0-9a-f]{3,8}$/i.test(String(accent || '')) ? `:root{--blue:${accent}}` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · ${esc(dayLabel(date))}</title>
<style>${fontsCss}${css}${accentCss}</style></head>
<body><div class="wrap">
<header class="masthead"><span class="wordmark">${markSvg(mark)}<span class="wordmark-name"><span>${esc(wordmark)}</span></span></span>
<div class="mast-meta"><span class="kicker">${esc(kicker)}</span><time datetime="${esc(date)}">${esc(dayLabel(date))}</time></div></header>
${body}
<footer class="foot"><span>${esc(wordmark)}</span><span>${esc(dayLabel(date))}</span></footer>
</div></body></html>
`;
}

// The last word and the arrow wrap together, so the arrow never sits alone on a line.
const linkText = (s) => { const w = String(s).split(' '); const last = w.pop(); return `${w.length ? `${esc(w.join(' '))} ` : ''}<span class="nowrap">${esc(last)}&#x2009;<span class="arr">&#x2197;</span></span>`; };
const ext = (url, html, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(url)}" target="_blank" rel="noopener">${html}</a>`;
const meta = (r) => `<p class="meta"><span class="company nowrap">${esc(r.company)}</span> · <span class="nowrap">${esc(r.where)}</span> · <span class="nowrap">${esc(r.comp)}</span></p>`;
const meter = (pct, label, t = DEFAULT_TIERS) => { const c = tierCuts(t); return `<span class="meter" role="img" aria-label="${esc(label)}"><span style="width:${pct}%"></span><i style="left:${c.b}%"></i><i style="left:${c.a}%"></i></span>`; };
const rank = (i) => `<span class="rank">${String(i + 1).padStart(2, '0')}</span>`;
const lede = (page, n, tail) => `<p class="lede">${n} role${n === 1 ? '' : 's'} from a ${ext(page.source.url, esc(page.source.label))}, ${tail}</p>`;

function fitBlock(r, t = DEFAULT_TIERS) {
  return `<div class="fit" aria-label="Fit score ${r.score} of 100, ${esc(tierLabel(r.score, t))}, ${esc(r.priority)}">
<span class="label">Fit score</span>
<span class="score">${r.score}<small>/100</small></span>
${meter(r.score, `${r.score} of 100`, t)}
<span class="tier">${esc(tierLabel(r.score, t))}</span>
<span class="badge ${esc(r.priority.toLowerCase())}">${esc(r.priority)}</span>
</div>`;
}

// ---------- index ----------
function indexRole(r, i, t) {
  return `<li class="role">
${rank(i)}
<div class="role-head">
${meta(r)}
<h2>${ext(r.url, linkText(r.title))}</h2>
${ext(r.cvUrl, `<span class="label">Tailored CV</span>${linkText(r.cvTitle)}`, 'cv')}
</div>
<dl class="notes"><dt class="label">Why it fits</dt><dd>${esc(r.why)}</dd><dt class="label">Consider</dt><dd class="consider">${esc(r.consider)}</dd></dl>
${fitBlock(r, t)}
</li>`;
}

// page: roles.json; roles: its roles with cvUrl and cvTitle resolved; linksUntil: ISO date or null.
// assets: { css, fontsCss, mark, wordmark, accent }; tiers and zone default to the user's preferences.
export function renderIndexHtml(page, roles, { linksUntil = null, analysisUrl = null, tiers = profileTiers(), zone = profileTz(), ...assets }) {
  const c = tierCuts(tiers);
  const until = linksUntil ? `Private links, open until <b>${esc(untilLabel(linksUntil, zone))}</b>.` : 'Private links.';
  const body = `<section class="hero"><h1>Roles to <em>consider</em></h1>
${lede(page, roles.length, 'in order of preference, each with a CV tailored to the posting.')}
<dl class="key">
<div><dt class="label">Fit score</dt><dd>0 to 100: the posting's requirements against the record. <b>${c.a}+</b> strong, <b>${c.b}+</b> good.${analysisUrl ? ` Breakdown in the ${ext(analysisUrl, 'role analysis')}.` : ''}</dd></div>
<div><dt class="label">Comments</dt><dd><b>Why it fits</b>: the strongest match. <b>Consider</b>: the gap or trade-off to weigh.</dd></div>
<div><dt class="label">Tailored CV</dt><dd>${until}</dd></div>
</dl></section>
<ol class="roles">
${roles.map((r, i) => indexRole(r, i, tiers)).join('\n')}
</ol>`;
  return shell({ title: 'Roles to consider', kicker: 'Roles to consider', date: page.date, body }, assets);
}

// ---------- role analysis ----------
const counts = (r) => Object.fromEntries(Object.keys(STATUS).map((s) => [s, r.requirements.filter((q) => q.status === s).length]));
const pips = (r) => `<span class="pips" role="img" aria-label="${Object.entries(counts(r)).map(([s, n]) => `${n} ${STATUS[s].toLowerCase()}`).join(', ')}">${r.requirements.map((q) => `<i class="st-${q.status}"></i>`).join('')}</span>`;
const pair = (c) => `<span class="pair" role="img" aria-label="Tailored CV ${c.tailored}%, best standard CV ${c.generic}%"><span class="bar t" style="width:${c.tailored}%"></span><span class="bar g" style="width:${c.generic}%"></span></span>`;

function glanceRow(r, i, t) {
  const c = counts(r);
  return `<tr><td class="num">${String(i + 1).padStart(2, '0')}</td>
<th scope="row">${esc(r.title)}<span class="co">${esc(r.company)} · ${esc(r.where)}</span></th>
<td data-label="Fit score"><span class="score-s">${r.score}</span>${meter(r.score, `${r.score} of 100`, t)}</td>
<td data-label="Requirements">${pips(r)}<span class="pips-n">${c.met} met · ${c.partial} partial · ${c.gap} gap</span></td>
<td data-label="CV coverage"><span class="cov">${r.coverage.tailored}%<small> vs ${r.coverage.generic}%</small></span>${pair(r.coverage)}</td></tr>`;
}

function breakdown(r, dims) {
  return `<ul class="dims">${dims.map(([k, label, w]) => {
    const pts = Math.round((r.dims[k] / 5) * w);
    return `<li><span class="dim-l">${esc(label)}</span><span class="dim-bar" role="img" aria-label="${pts} of ${w}"><span style="width:${(100 * r.dims[k]) / 5}%"></span></span><span class="dim-n">${pts}<small>/${w}</small></span></li>`;
  }).join('')}</ul>`;
}

function analysisRole(r, i, dims, t) {
  const reqs = r.requirements.map((q) => `<li class="req st-${q.status}"><i aria-hidden="true"></i><span class="req-s label">${STATUS[q.status]}</span><div><p class="req-t">${esc(q.text)}</p><p class="req-n">${esc(q.note)}</p></div></li>`).join('');
  return `<article class="card" id="role-${i + 1}">
<header class="card-head">${rank(i)}<div>${meta(r)}<h3>${ext(r.url, linkText(r.title))}</h3></div></header>
<div class="card-body">
<div>${fitBlock(r, t)}<p class="label sub">Score breakdown</p>${breakdown(r, dims)}
<p class="label sub">CV coverage</p><p class="cov-line"><span class="cov">${r.coverage.tailored}%</span> tailored CV <span class="muted">vs ${r.coverage.generic}% for the best standard CV</span></p>${pair(r.coverage)}</div>
<div><p class="label sub">Requirements</p><ul class="reqs">${reqs}</ul></div>
</div>
</article>`;
}

export function renderAnalysisHtml(page, roles, { indexUrl = null, dims = DIMS, tiers = profileTiers(), ...assets }) {
  const c = tierCuts(tiers);
  const legend = `<p class="legend"><span><i class="st-met"></i>Met</span><span><i class="st-partial"></i>Partial</span><span><i class="st-gap"></i>Gap</span><span><b class="sw t"></b>Tailored CV</span><span><b class="sw g"></b>Best standard CV</span></p>`;
  const body = `<section class="hero"><h1>Role <em>analysis</em></h1>
${lede(page, roles.length, `scored against the record, requirement by requirement.${indexUrl ? ` The ${ext(indexUrl, 'index')} lists them with their tailored CVs.` : ''}`)}
</section>
<section><div class="section-head"><span class="index">01</span><h2>At a glance</h2></div>
<div class="table-wrap"><table class="glance"><thead><tr><th scope="col">#</th><th scope="col">Role</th><th scope="col">Fit score</th><th scope="col">Requirements</th><th scope="col">CV coverage</th></tr></thead>
<tbody>${roles.map((r, i) => glanceRow(r, i, tiers)).join('')}</tbody></table></div>${legend}</section>
<section><div class="section-head"><span class="index">02</span><h2>Role by role</h2></div>
${roles.map((r, i) => analysisRole(r, i, dims, tiers)).join('\n')}</section>
<section><div class="section-head"><span class="index">03</span><h2>Method</h2></div>
<dl class="method">
<div><dt class="label">Fit score</dt><dd>Five dimensions, each rated 0 to 5 and weighted: ${dims.map(([, label, w]) => `${esc(label.toLowerCase())} ${w}`).join(', ')}. <b>${c.a}+</b> strong fit, <b>${c.b}+</b> good fit. Pay is shown, never scored.</dd></div>
<div><dt class="label">Requirements</dt><dd>Taken from each posting. <b>Met</b> where the record shows it, <b>partial</b> where it shows part of it, <b>gap</b> where it does not.</dd></div>
<div><dt class="label">CV coverage</dt><dd>The share of the posting's must-have terms the CV covers. The term list is fixed from the posting before the CV is written. Compared with the best of the standard CVs.</dd></div>
</dl></section>`;
  return shell({ title: 'Role analysis', kicker: 'Role analysis', date: page.date, body }, assets);
}

// Refuses a page that names someone it must not (roles.json never_show: the recruiter, the
// source's people), carries an address other than the allowed ones (the user's application
// email), a phone number, or a script.
export function pageViolations(html, neverShow = [], allow = [applicationEmail()]) {
  const ok = new Set(allow.map((e) => String(e || '').toLowerCase()).filter(Boolean));
  const bad = [];
  const text = html.replace(/<style>[\s\S]*?<\/style>/g, '');
  for (const name of neverShow) if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) bad.push(`name ${name}`);
  for (const e of new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])) if (!ok.has(e.toLowerCase())) bad.push(`email ${e}`);
  if (/\(?\b\d{3}\)?[ .-]?\d{3}[ .-]\d{4}\b/.test(text)) bad.push('phone number');
  if (/<script/i.test(html)) bad.push('script');
  return bad;
}
