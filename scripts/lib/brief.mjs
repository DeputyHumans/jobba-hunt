// Interview and call prep briefs: the long brief markdown (templates/interview-brief.md) as a
// page a person reads before a call. Numbered sections, claim IDs as chips that open the exact
// claim-bank wording, optional glossary terms as hints. Pure functions; scripts/build-brief.mjs
// does the file I/O.

import { marked } from 'marked';
import { markSvg, wordmarkName } from './brand-mark.mjs';

export const CLAIMS_PLACEHOLDER = '**Claims** `[CLAIMS TABLE]`';
const CLAIM_RE = /\bC\d{2,3}\b/g;
const SKIP_TAGS = new Set(['a', 'code', 'button', 'h1', 'h2', 'h3', 'h4', 'th', 'pre']);
// The table fillClaims writes: its source column quotes the bank (which names retired IDs), so it is
// never checked as the brief's own claim use.
const CLAIMS_TABLE_HEAD = '| ID | Claim (start of the exact wording) | Source (claim bank) |';
const withoutClaimsTable = (md) => md.replace(/^\| ID \| Claim \(start of the exact wording\) \| Source \(claim bank\) \|\n\|---\|---\|---\|\n(?:\|.*\|(?:\n|$))*/m, '');

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/`/g, '');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const unescape = (s) => s.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// collateral/claim-bank.md rows: | ID | claim | category | source | status | never say |. Retired rows are left out.
export function parseClaimBank(md) {
  const bank = new Map();
  for (const line of md.split('\n')) {
    const m = /^\| (C\d{2,}) \|(?! \*\*Retired)/.exec(line);
    if (!m) continue;
    const c = line.split('|').map((s) => s.trim());
    bank.set(m[1], { text: plain(c[2]), cat: plain(c[3]), src: plain(c[4]), status: plain(c[5]), never: plain(c[6]) });
  }
  return bank;
}

// Front matter (only `call` and `title` are read), the H1, and the body after it.
export function splitBrief(md) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
  const front = {};
  if (fm) for (const k of ['call', 'title']) {
    const v = new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(fm[1]);
    if (v) front[k] = v[1].replace(/^"(.*)"$/, '$1');
  }
  const rest = fm ? md.slice(fm[0].length) : md;
  const h1 = /^# (.+)$/m.exec(rest);
  return { front, h1: h1 ? h1[1].trim() : '', body: h1 ? rest.replace(h1[0], '') : rest };
}

// "Acme Corp: Staff Software Engineer, Payments AI, recruiter screen brief" -> company, role.
export function heroParts(h1) {
  const m = /^(.+?):\s*(.+?)(?:,\s*[^,]*\bbrief)?$/i.exec(h1);
  return m ? { company: m[1].trim(), role: m[2].trim() } : { company: h1, role: '' };
}

// Claim IDs in order of first use, plus any the bank does not hold (or holds as retired).
export function claimUse(text, bank) {
  const order = [];
  const unknown = [];
  for (const c of text.match(CLAIM_RE) || []) {
    if (!bank.has(c)) { if (!unknown.includes(c)) unknown.push(c); continue; }
    if (!order.includes(c)) order.push(c);
  }
  return { order, unknown };
}

export function claimsTableMd(order, bank) {
  const cell = (s) => s.replace(/\|/g, '/');
  const rows = order.map((c) => {
    const t = bank.get(c).text;
    return `| ${c} | ${cell(t.length > 110 ? `${t.slice(0, 110)}…` : t)} | ${cell(bank.get(c).src)} |`;
  });
  return `**Claims**\n\n${CLAIMS_TABLE_HEAD}\n|---|---|---|\n${rows.join('\n')}`;
}

// Replace the claims placeholder with the table of every claim the brief cites. No placeholder: unchanged.
export function fillClaims(md, bank) {
  if (!md.includes(CLAIMS_PLACEHOLDER)) return md;
  const { order } = claimUse(md.replace(CLAIMS_PLACEHOLDER, ''), bank);
  return md.replace(CLAIMS_PLACEHOLDER, claimsTableMd(order, bank));
}

// md: the brief markdown. bank: parseClaimBank(). glossary: [{ term, def, here }].
// assets: { css, sansWoff2, monoWoff2 } and the brand: mark (brand/mark.json or null), wordmark,
// kicker (preferences.brand.title), accent (a hex colour), operator (whose brief it is).
// builtAt: ISO string for the footer.
export function renderBriefHtml({ md, bank, glossary = [], assets, builtAt }) {
  const filled = fillClaims(md, bank);
  const { front, h1, body } = splitBrief(filled);
  const { company, role } = heroParts(h1);
  const { unknown } = claimUse(withoutClaimsTable(body), bank);

  let html = marked.parse(body, { gfm: true });

  // A code span that holds only claim IDs (`C09 C81 C44`) is a chip group, as in the first briefs.
  html = html.replace(/<code>((?:C\d{2,3}[\s,]*)+)<\/code>/g, (_, ids) => `<span class="chips">${ids.trim().split(/[\s,]+/).join(' ')}</span>`);

  // Numbered sections from "## N. Title".
  const toc = [];
  let auto = 0;
  html = html.replace(/<h2>(?:(\d+)\.\s*)?(.*?)<\/h2>/g, (_, n, t) => {
    const num = n ? Number(n) : auto + 1;
    auto = num;
    const idx = String(num).padStart(2, '0');
    const id = `s${num}-${slug(unescape(t))}`;
    toc.push(`<a href="#${id}"><span class="index">${idx}</span>${esc(unescape(t))}</a>`);
    return `${toc.length > 1 ? '</section>\n' : ''}<section id="${id}"><div class="section-head"><span class="index">${idx}</span><h2>${t}</h2></div>`;
  });
  if (toc.length) html += '</section>';

  // Tables: scroll wrapper, key-value style for two columns.
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, (_, inner) => {
    const cols = (((/<thead>[\s\S]*?<\/thead>/.exec(inner)) || [''])[0].match(/<th[\s>]/g) || []).length;
    return `<div class="table-wrap"><table class="data-table${cols === 2 ? ' kv' : ''}">${inner}</table></div>`;
  });

  // Claim chips and glossary terms, in text nodes only (never in attributes, links, code or headings).
  const terms = glossary.filter((g) => g && g.term).map((g) => ({ ...g, id: `term-${slug(g.term)}`, re: new RegExp(`(^|[^\\w-])(${g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w-])`) }));
  const placed = new Set(); // terms with a hint anywhere
  let block = new Set(); // terms with a hint in the current block: one hint per term per paragraph, cell or item
  const chips = new Map(); // claim id -> Set of section numbers
  let section = 0;
  const open = [];
  html = html.split(/(<[^>]+>)/).map((seg) => {
    if (seg.startsWith('<')) {
      const t = /^<(\/?)([a-z0-9]+)/i.exec(seg);
      if (t && SKIP_TAGS.has(t[2].toLowerCase())) { if (t[1]) open.pop(); else if (!seg.endsWith('/>')) open.push(t[2]); }
      if (t && !t[1] && /^(p|td|li|dd|blockquote)$/i.test(t[2])) block = new Set();
      const s = /^<section id="s(\d+)-/.exec(seg);
      if (s) section = Number(s[1]);
      return seg;
    }
    if (open.length || !seg.trim()) return seg;
    let out = seg;
    for (const g of terms) {
      if (block.has(g.id) || !g.re.test(out)) continue;
      block.add(g.id);
      placed.add(g.id);
      out = out.replace(g.re, (_, pre, word) => `${pre}\u0000${g.id}\u0001${word}\u0002`);
    }
    out = out.replace(CLAIM_RE, (c) => {
      if (!bank.has(c)) return c;
      if (!chips.has(c)) chips.set(c, new Set());
      chips.get(c).add(section);
      return `\u0003${c}\u0004`;
    });
    return out
      .replace(/\u0000([^\u0001]+)\u0001([^\u0002]+)\u0002/g, (_, id, word) => `<button type="button" class="term" popovertarget="${id}">${word}</button>`)
      .replace(/\u0003(C\d+)\u0004/g, (_, c) => `<button type="button" class="claim" popovertarget="pop-${c}" title="${esc(bank.get(c).text.slice(0, 120))}">${c}</button>`);
  }).join('');

  // Closing section: every claim the brief leans on, as a grid (the popovers live inside it).
  const ids = [...chips.keys()].sort((a, z) => Number(a.slice(1)) - Number(z.slice(1)));
  const refIdx = String(auto + 1).padStart(2, '0');
  if (ids.length) toc.push(`<a href="#claim-reference"><span class="index">${refIdx}</span>Claim reference</a>`);
  const grid = ids.map((c) => `<button type="button" class="claim" popovertarget="pop-${c}" title="${esc(bank.get(c).text.slice(0, 120))}">${c}</button>`).join('');

  const claimPops = [...chips.keys()].map((c) => {
    const b = bank.get(c);
    const used = [...chips.get(c)].sort((a, z) => a - z).map((n) => (n ? `§${n}` : 'intro')).join(' · ');
    return `<div popover id="pop-${c}" class="claim-pop" role="dialog" aria-label="${c}"><div class="pop-head"><span class="index">${c}</span><span class="pop-meta">${esc(b.cat)} · ${esc(b.status)}</span><button type="button" class="pop-x" popovertarget="pop-${c}" popovertargetaction="hide" aria-label="Close">Close</button></div>
<p class="pop-label">Exact safe wording</p><p class="pop-claim">${esc(b.text)}</p>
<dl><dt>Never say</dt><dd>${esc(b.never)}</dd><dt>Source</dt><dd>${esc(b.src)}</dd><dt>Used in</dt><dd>${used}</dd></dl></div>`;
  });
  const termsSorted = [...terms].sort((a, z) => a.term.localeCompare(z.term, 'en', { sensitivity: 'base' }));
  const termGrid = termsSorted.map((g) => `<button type="button" class="claim" popovertarget="${g.id}">${esc(g.term)}</button>`).join('');
  const termPops = termsSorted.map((g) => `<div id="${g.id}" popover class="claim-pop term-pop" role="dialog" aria-label="${esc(g.term)}">
<div class="pop-head"><span class="index">Term</span><span class="pop-meta">${esc(g.term)}</span><button type="button" class="pop-x" popovertarget="${g.id}" popovertargetaction="hide" aria-label="Close">Close</button></div>
<p class="pop-claim"><strong>${esc(g.term)}</strong>: ${esc(g.def)}</p>${g.here ? `<dl><dt>Here</dt><dd>${esc(g.here)}</dd></dl>` : ''}</div>`);

  const b64 = (buf) => Buffer.from(buf).toString('base64');
  const fonts = `@font-face{font-family:'Instrument Sans Variable';src:url(data:font/woff2;base64,${b64(assets.sansWoff2)}) format('woff2');font-weight:400 700;font-style:normal;font-display:swap}`
    + `@font-face{font-family:'Geist Mono Variable';src:url(data:font/woff2;base64,${b64(assets.monoWoff2)}) format('woff2');font-weight:100 900;font-style:normal;font-display:swap}`;
  const wordmark = String(assets.wordmark || '');
  const kicker = String(assets.kicker || 'Job hunt');
  const accentCss = assets.accent && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(assets.accent)) ? `:root{--accent:${assets.accent}}` : '';
  const lede = `${terms.length ? 'Call prep brief' : 'Recruiter screen brief'}. Answers use claim-bank wording only. Click any claim ID for the exact safe wording, what never to say, and where it is used.${terms.length ? ' Dotted-underlined terms open a short explanation.' : ''} Company facts link to their sources.`;
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(company)} screen brief</title>
<style>${fonts}
${assets.css}${accentCss}</style></head>
<body><div class="wrap">
<header class="masthead"><span class="wordmark"${wordmark ? ` aria-label="${esc(wordmark)}"` : ''}>${assets.mark ? `${markSvg(assets.mark)}${wordmarkName(wordmark)}` : esc(wordmark)}</span>
<div class="mast-meta"><span class="kicker">${esc(kicker)} · Interview brief</span><span class="kicker">Private</span></div></header>
<section class="hero" id="top"><p class="eyebrow">${esc(front.call || '')}</p>
<h1>${esc(company)}${role ? `, <em>${esc(role)}</em>` : ''}</h1>
<p class="lede">${lede}</p>
<nav class="toc" aria-label="Sections">${toc.join('')}</nav></section>
${html}
${ids.length ? `<section id="claim-reference"><div class="section-head"><span class="index">${refIdx}</span><h2>Claim reference</h2></div><p class="intro">Every claim this brief leans on. Open one for the exact safe wording from the claim bank, what never to say, and where it is used.</p><div class="chips chip-grid">${grid}</div>${terms.length ? `<h3 id="terms">Terms</h3><p class="intro">Technical terms with a hint. Underlined dotted in the text.</p><div class="chips chip-grid">${termGrid}</div>` : ''}<div class="pops">${[...claimPops, ...termPops].join('\n')}</div></section>` : `<div class="pops">${termPops.join('\n')}</div>`}
<footer>Private prep document${assets.operator ? ` for ${esc(assets.operator)}` : ''}. Source: the brief markdown and collateral/claim-bank.md. Built ${esc(String(builtAt).slice(0, 16).replace('T', ' '))} UTC.</footer>
</div></body></html>
`;
  return { html: page, filledMd: filled, claims: chips.size, sections: toc.length, terms: placed.size, unknown };
}

// Body lines that name a CV variant (`head-of-engineering`) outside a markdown link, so a brief always
// links the exact version sent. Front matter is skipped.
export function unlinkedCvMentions(md, slugs) {
  const fm = /^---\n[\s\S]*?\n---\n/.exec(md);
  const offset = fm ? fm[0].split('\n').length - 1 : 0;
  const body = fm ? md.slice(fm[0].length) : md;
  const hits = [];
  body.split('\n').forEach((line, i) => {
    const bare = line.replace(/\[[^\]]*\]\([^)]*\)/g, '');
    for (const slug of slugs) if (new RegExp(`(^|[^\\w/-])${slug.replace(/[-]/g, '\\-')}(?![\\w-])`).test(bare)) hits.push({ line: i + 1 + offset, slug });
  });
  return hits;
}
