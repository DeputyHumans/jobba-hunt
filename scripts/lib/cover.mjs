// Cover letters: a real letter per role, never a CV in the cover-letter slot. Pure: validation
// and HTML. scripts/build-cover.mjs renders the PDF and checks it.
//
// Letter file (<data>/applications/<job_id>/cover-letter.json, in the workspace):
//   { job_id, approach, approach_why?, company, role, ref?, to?, date, greeting, closing, map_left?, map_right?,
//     paragraphs: [ { text, claims: [ids], kind? }        a paragraph; kind "rampup" styles an honest ramp-up line
//                 | { map: [{ ask, answer, claims }] }      the posting's asks verbatim beside the record
//                 | { list: [{ text, claims }], ordered }   a numbered plan (B) or a list of questions (C)
//                 | { ps: text, claims } ] }                 a P.S. after the signature (D)
// Four approaches (docs/tailoring.md "Cover letters"), each with its own structure, checked here:
//   A requirements map, B first two weeks, C three questions, D lean letter plus P.S.
// preferences.tailoring.letter "per-job" lets /hunt-tailor pick per posting (approach_why says why);
// a fixed A to D forces one. B and C carry more honesty risk, so they always wait for the operator's
// review (letterNeedsReview). Every claim cited must be usable; the copy goes through authentic-prose
// before the user sees it.

import { PAPER, pageRuleCss } from './cv.mjs';

// The company part of the letter's file name. Accented letters keep their base letter, so
// "ÉTOILE" names the upload "...-etoile.pdf", not "...-toile.pdf".
export const coverSlug = (company) => String(company || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const LETTER_APPROACHES = ['A', 'B', 'C', 'D'];
// A plan (B) or questions (C) need the operator's eye before any send, whatever tailoring.review says.
export const letterNeedsReview = (letter) => ['B', 'C'].includes(letter?.approach);
const blockText = (p) => (p.map ? p.map.map((r) => `${r.ask} ${r.answer}`).join(' ') : p.list ? p.list.map((i) => i.text).join(' ') : p.ps != null ? `P.S. ${p.ps}` : p.text || '');
const cites = (b) => Array.isArray(b?.claims) && b.claims.length > 0;
const isText = (b) => !b.map && !b.list && b.ps == null;

// The structure each approach needs. Returns errors.
function approachErrors(letter) {
  const e = [];
  const blocks = letter.paragraphs || [];
  const maps = blocks.filter((b) => b.map);
  const lists = blocks.filter((b) => b.list);
  const pss = blocks.filter((b) => b.ps != null);
  const after = (b) => blocks.slice(blocks.indexOf(b) + 1);
  const a = letter.approach;
  if (pss.length && a !== 'D') e.push('a P.S. belongs to approach D');
  if (a === 'A') {
    if (maps.length !== 1 || maps[0].map.length < 3) e.push('approach A: one requirements map with at least 3 rows');
    if (lists.length) e.push('approach A: no list (the map carries the asks)');
    if (blocks.filter((b) => b.kind === 'rampup').length > 1) e.push('approach A: at most one ramp-up line');
  } else if (a === 'B' || a === 'C') {
    const kind = a === 'B' ? 'numbered' : 'question';
    const ok = lists.length === 1 && !!lists[0].ordered === (a === 'B');
    if (maps.length) e.push(`approach ${a}: no requirements map`);
    if (!ok) e.push(a === 'B' ? 'approach B: one numbered list (ordered: true) of plan steps' : 'approach C: one list (ordered: false) of questions');
    else {
      const items = lists[0].list;
      if (items.length < 2 || items.length > 4) e.push(a === 'B' ? 'approach B: 2 to 4 plan steps' : 'approach C: 2 to 4 questions');
      items.forEach((it, i) => {
        if (!it?.text) e.push(`approach ${a}: ${kind} ${i + 1} has no text`);
        if (a === 'B' && !cites(it)) e.push(`approach B: plan step ${i + 1} cites no claim (each step rests on work done before)`);
        if (a === 'C' && !/\?\s*$/.test(it?.text || '')) e.push(`approach C: item ${i + 1} is not a question`);
      });
      if (!after(lists[0]).some((b) => isText(b) && cites(b))) e.push(`approach ${a}: after the list, a paragraph citing the record behind it`);
    }
  } else if (a === 'D') {
    const texts = blocks.filter(isText);
    if (maps.length || lists.length) e.push('approach D: no map or list');
    if (texts.length < 2 || texts.length > 4) e.push('approach D: 2 to 4 paragraphs');
    if (!texts.some(cites)) e.push('approach D: at least one paragraph cites a claim');
    if (pss.length > 1) e.push('approach D: one P.S. at most');
    if (pss.length && blocks.at(-1) !== pss[0]) e.push('approach D: the P.S. comes last');
    if (pss.length && !cites(pss[0])) e.push('approach D: the P.S. cites no claim');
  }
  return e;
}
export const coverWords = (letter) => [letter.greeting, ...letter.paragraphs.map(blockText), letter.closing].join(' ').split(/\s+/).filter(Boolean).length;

// requireWhy: preferences.tailoring.letter is per-job, so the pick names its reason. fixed: the one
// approach a fixed preference allows.
export function validateCover(letter, claimIds, { minWords = 100, maxWords = 260, requireWhy = false, fixed = null } = {}) {
  const e = [];
  for (const k of ['job_id', 'company', 'role', 'date', 'greeting', 'closing']) if (!letter?.[k]) e.push(`missing ${k}`);
  if (!Array.isArray(letter?.paragraphs) || !letter.paragraphs.length) e.push('no paragraphs');
  if (!LETTER_APPROACHES.includes(letter?.approach)) e.push('approach must be A, B, C or D');
  else {
    if (fixed && letter.approach !== fixed) e.push(`approach ${letter.approach}, but preferences tailoring.letter is ${fixed}`);
    if (requireWhy && !String(letter.approach_why || '').trim()) e.push('approach_why: one line on why this approach fits the posting (tailoring.letter per-job)');
    e.push(...approachErrors(letter));
  }
  for (const [i, p] of (letter?.paragraphs || []).entries()) {
    if (p.list) {
      if (!Array.isArray(p.list)) { e.push(`block ${i + 1}: list must be an array`); continue; }
      for (const [r, it] of p.list.entries()) for (const c of it?.claims || []) if (!claimIds.has(c)) e.push(`list item ${r + 1}: unknown claim ${c}`);
      continue;
    }
    if (p.ps != null) {
      if (!String(p.ps).trim()) e.push('P.S.: no text');
      for (const c of p.claims || []) if (!claimIds.has(c)) e.push(`P.S.: unknown claim ${c}`);
      continue;
    }
    if (p.map) {
      for (const [r, row] of p.map.entries()) {
        if (!row.ask || !row.answer) e.push(`map row ${r + 1}: ask and answer required`);
        for (const c of row.claims || []) if (!claimIds.has(c)) e.push(`map row ${r + 1}: unknown claim ${c}`);
        if (!(row.claims || []).length) e.push(`map row ${r + 1}: cite at least one claim`);
      }
      continue;
    }
    if (!p.text) e.push(`paragraph ${i + 1}: no text`);
    if (!Array.isArray(p.claims)) e.push(`paragraph ${i + 1}: claims must be an array (empty only for a line that states no fact: an opening, a ramp-up gap, an invitation)`);
    for (const c of p.claims || []) if (!claimIds.has(c)) e.push(`paragraph ${i + 1}: unknown claim ${c}`);
  }
  const all = coverText(letter || { paragraphs: [] });
  if (/—/.test(all)) e.push('em dash in the letter');
  if (/;/.test(all)) e.push('semicolon in the letter');
  const n = letter?.paragraphs ? coverWords(letter) : 0;
  if (n < minWords || n > maxWords) e.push(`${n} words; keep it between ${minWords} and ${maxWords}`);
  return e;
}

// Plain text, for an application form's cover-letter text box.
export function coverText(letter, person = null) {
  const plain = (p) => (p.map ? p.map.map((r) => `${letter.map_left || 'Your posting'}: "${r.ask}"\n${letter.map_right || 'My record'}: ${r.answer}`).join('\n\n')
    : p.list ? p.list.map((it, i) => `${p.ordered ? `${i + 1}.` : '-'} ${it.text}`).join('\n') : p.text);
  const body = (letter.paragraphs || []).filter((p) => p.ps == null);
  const ps = (letter.paragraphs || []).filter((p) => p.ps != null).map((p) => `P.S. ${p.ps}`);
  return [letter.greeting, ...body.map(plain), `${letter.closing}\n${person?.name || ''}`.trim(), ...ps].filter(Boolean).join('\n\n');
}

// An on-site or hybrid role (its ref line says so) drops the workplace line ("Remote (US)") from
// the header, where it would read as a remote-only condition.
const onsite = (ref) => /\b(on-?site|hybrid|in-?office)\b/i.test(String(ref || ''));

export function renderCoverHtml(letter, person, css) {
  const sep = '<span class="sep"> · </span>';
  const to = letter.to || `${letter.company}, hiring team`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(person.name)}: cover letter, ${esc(letter.role)}</title>
<meta name="author" content="${esc(person.name)}">
<style>${css}</style></head>
<body><main>
<header>
<h1>${esc(person.name)}</h1>
<p class="headline"><span class="ht">Cover letter</span><span class="hsep"> · </span><span class="hs">${esc(letter.company)}</span></p>
<p class="contact">${esc(person.location)}${onsite(letter.ref) ? '' : `${sep}${esc(person.workplace)}`}${sep}<a href="mailto:${esc(person.email)}">${esc(person.email)}</a>${sep}<a href="https://www.${esc(person.linkedin)}/">${esc(person.linkedin)}</a></p>
</header>
<section class="meta">
<dl><dt>To</dt><dd>${esc(to)}</dd><dt>Re</dt><dd>${esc(letter.role)}${letter.ref ? `<span class="ref"> · ${esc(letter.ref)}</span>` : ''}</dd></dl>
<p class="date"><span class="date-label">Date</span><span class="date-value">${esc(letter.date)}</span></p>
</section>
<section class="letter">
<p class="greeting">${esc(letter.greeting)}</p>
${letter.paragraphs.filter((p) => p.ps == null).map((p) => (p.map
    ? `<div class="map"><div class="map-head"><span>${esc(letter.map_left || 'Your posting')}</span><span>${esc(letter.map_right || 'My record')}</span></div>${p.map.map((r) => `<div class="map-row"><p class="ask">${esc(r.ask)}</p><p class="answer">${esc(r.answer)}</p></div>`).join('')}</div>`
    : p.list
      ? (p.ordered ? `<ol class="plan">${p.list.map((it) => `<li>${esc(it.text)}</li>`).join('')}</ol>` : `<ul class="questions">${p.list.map((it) => `<li>${esc(it.text)}</li>`).join('')}</ul>`)
      : `<p${p.kind ? ` class="${esc(p.kind)}"` : ''}>${esc(p.text)}</p>`)).join('\n')}
</section>
<section class="sign">
<p class="closing">${esc(letter.closing)}</p>
<p class="name">${esc(person.name)}</p>
${letter.paragraphs.filter((p) => p.ps != null).map((p) => `<p class="ps"><span class="ps-label">P.S.</span> ${esc(p.ps)}</p>`).join('\n')}
</section>
</main></body></html>
`;
}

// The HTML a published copy shows: the print source inside one sheet (template.css's .page),
// with the PDF's margins as padding and no browser page margin, so it opens and prints like the
// PDF. The PDF is printed from the plain source, so its margins are not doubled. paper is a
// cv.mjs PAPER entry (preferences.cv.paper).
export function coverSheetHtml(html, paper = PAPER.letter) {
  const sheet = `<style>${pageRuleCss(paper)}\n.letter-sheet { padding: 1in 1in 0.8in; }\n`
    + '@media print { .page.letter-sheet { padding: 1in 1in 0.8in; min-height: calc(var(--sheet-h) - 0.01in); } }\n'
    + '@media screen and (max-width: 8.9in) { .page.letter-sheet { padding: 24px 16px 32px; } }</style>';
  return html.replace('</head>', `${sheet}</head>`)
    .replace('<body><main>', '<body><div class="page letter-sheet"><main>')
    .replace('</main></body>', '</main></div></body>');
}
