// Cover letters: a real letter per role, never a CV in the cover-letter slot. Pure: validation
// and HTML. scripts/build-cover.mjs renders the PDF and checks it.
//
// Letter file (<data>/applications/<job_id>/cover-letter.json, in the workspace):
//   { job_id, company, role, ref?, to?, date, greeting, closing, map_left?, map_right?,
//     paragraphs: [{ text, claims: [ids], kind? } | { map: [{ ask, answer, claims }] }] }
// A map block quotes the posting's asks verbatim beside the claim-backed record (the
// "requirements map" letter); kind "rampup" styles an honest ramp-up line.
// Every paragraph cites the claim-bank IDs it rests on; the copy goes through authentic-prose
// before the user sees it, and the user's approval of the role (or of the tailored documents)
// approves the letter.

import { PAPER, pageRuleCss } from './cv.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const blockText = (p) => (p.map ? p.map.map((r) => `${r.ask} ${r.answer}`).join(' ') : p.text || '');
export const coverWords = (letter) => [letter.greeting, ...letter.paragraphs.map(blockText), letter.closing].join(' ').split(/\s+/).filter(Boolean).length;

export function validateCover(letter, claimIds, { minWords = 100, maxWords = 260 } = {}) {
  const e = [];
  for (const k of ['job_id', 'company', 'role', 'date', 'greeting', 'closing']) if (!letter?.[k]) e.push(`missing ${k}`);
  if (!Array.isArray(letter?.paragraphs) || !letter.paragraphs.length) e.push('no paragraphs');
  for (const [i, p] of (letter?.paragraphs || []).entries()) {
    if (p.map) {
      for (const [r, row] of p.map.entries()) {
        if (!row.ask || !row.answer) e.push(`map row ${r + 1}: ask and answer required`);
        for (const c of row.claims || []) if (!claimIds.has(c)) e.push(`map row ${r + 1}: unknown claim ${c}`);
        if (!(row.claims || []).length) e.push(`map row ${r + 1}: cite at least one claim`);
      }
      continue;
    }
    if (!p.text) e.push(`paragraph ${i + 1}: no text`);
    if (!Array.isArray(p.claims)) e.push(`paragraph ${i + 1}: claims must be an array (empty only for the opening line)`);
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
  const plain = (p) => (p.map ? p.map.map((r) => `${letter.map_left || 'Your posting'}: "${r.ask}"\n${letter.map_right || 'My record'}: ${r.answer}`).join('\n\n') : p.text);
  return [letter.greeting, ...(letter.paragraphs || []).map(plain), `${letter.closing}\n${person?.name || ''}`.trim()].filter(Boolean).join('\n\n');
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
${letter.paragraphs.map((p) => (p.map
    ? `<div class="map"><div class="map-head"><span>${esc(letter.map_left || 'Your posting')}</span><span>${esc(letter.map_right || 'My record')}</span></div>${p.map.map((r) => `<div class="map-row"><p class="ask">${esc(r.ask)}</p><p class="answer">${esc(r.answer)}</p></div>`).join('')}</div>`
    : `<p${p.kind ? ` class="${esc(p.kind)}"` : ''}>${esc(p.text)}</p>`)).join('\n')}
</section>
<section class="sign">
<p class="closing">${esc(letter.closing)}</p>
<p class="name">${esc(person.name)}</p>
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
