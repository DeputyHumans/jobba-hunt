// Cover letters: claims-only, lean, no em dash or semicolon, one page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCover, renderCoverHtml, coverText, coverWords, coverSheetHtml, coverSlug } from '../scripts/lib/cover.mjs';
import { paperOf } from '../scripts/lib/cv.mjs';

const ids = new Set(['C03', 'C04', 'C27']);
const para = 'I grew the Acme Corp engineering team from 12 to 45 engineers and moved every team to daily releases. Each team owns its own service. ';
const letter = (o = {}) => ({
  job_id: '9000000001', company: 'Example Co', role: 'VP of Engineering', ref: 'Position ID 1', date: 'November 10, 2026', greeting: 'Hello Example team,', closing: 'Best regards,',
  paragraphs: [{ text: "I'm applying for the VP of Engineering role.", claims: [] }, { text: para.repeat(5).trim(), claims: ['C03', 'C04'] }], ...o,
});
const person = { name: 'Jordan Example', location: 'Springfield, IL', workplace: 'Remote (US)', email: 'jordan@example.com', linkedin: 'linkedin.com/in/jordan-example' };

test('a clean letter passes; unknown claims, em dashes, semicolons and length fail', () => {
  assert.deepEqual(validateCover(letter(), ids), []);
  assert.ok(validateCover(letter({ paragraphs: [{ text: para.repeat(4), claims: ['C99'] }] }), ids).some((e) => /unknown claim C99/.test(e)));
  assert.ok(validateCover(letter({ greeting: 'Hello — team,' }), ids).some((e) => /em dash/.test(e)));
  assert.ok(validateCover(letter({ closing: 'Thanks; best,' }), ids).some((e) => /semicolon/.test(e)));
  assert.ok(validateCover(letter({ paragraphs: [{ text: 'Too short.', claims: [] }] }), ids).some((e) => /words; keep it between 100 and 260/.test(e)));
  assert.ok(validateCover(letter({ paragraphs: [{ text: para.repeat(14), claims: ['C03'] }] }), ids).some((e) => /words/.test(e)), 'over 260 words fails');
});

test('a requirements map cites a claim on every row', () => {
  const map = { map: [{ ask: 'Scale the team', answer: 'Grew engineering from 12 to 45.', claims: ['C03'] }, { ask: 'Ship AI features', answer: 'Shipped an LLM triage feature.', claims: [] }] };
  const errs = validateCover(letter({ paragraphs: [{ text: para.repeat(5), claims: ['C03'] }, map] }), ids);
  assert.ok(errs.some((e) => /map row 2: cite at least one claim/.test(e)));
  const html = renderCoverHtml(letter({ map_left: 'Your posting', map_right: 'My record', paragraphs: [map] }), person, '');
  assert.match(html, /<div class="map"><div class="map-head"><span>Your posting<\/span><span>My record<\/span><\/div><div class="map-row"><p class="ask">Scale the team<\/p>/);
  assert.match(coverText(letter({ paragraphs: [map] }), person), /Your posting: "Scale the team"\nMy record: Grew engineering from 12 to 45\./);
});

test('render: company in the headline, the role once in the Re line, contact only in the header', () => {
  const html = renderCoverHtml(letter(), person, '');
  assert.match(html, /<span class="ht">Cover letter<\/span><span class="hsep"> · <\/span><span class="hs">Example Co<\/span>/);
  assert.match(html, /<dt>Re<\/dt><dd>VP of Engineering<span class="ref"> · Position ID 1<\/span>/);
  assert.equal(html.split('jordan@example.com').length - 1, 2); // mailto href + text, header only
  assert.match(coverText(letter(), person), /^Hello Example team,\n\nI'm applying/);
  assert.match(coverText(letter(), person), /Best regards,\nJordan Example$/);
  assert.ok(coverWords(letter()) > 100);
});

test('coverSheetHtml: the published letter is one sheet with the PDF\'s margins, like a CV page', () => {
  const html = coverSheetHtml(renderCoverHtml(letter(), person, 'body{margin:0}'));
  assert.equal((html.match(/<div class="page letter-sheet">/g) || []).length, 1);
  assert.match(html, /<body><div class="page letter-sheet"><main>/);
  assert.match(html, /<\/main><\/div><\/body>/);
  assert.match(html, /@page \{ size: letter; margin: 0; \}/);
  assert.match(html, /\.letter-sheet \{[^}]*padding: 1in 1in 0\.8in/);
  assert.match(html, /min-height: calc\(var\(--sheet-h\) - 0\.01in\)/, 'the print sheet follows the paper size');
  assert.match(coverSheetHtml(renderCoverHtml(letter(), person, ''), paperOf('a4')), /@page \{ size: A4; margin: 0; \}/);
  // The print source keeps no sheet, so the PDF's own margins are not doubled.
  assert.doesNotMatch(renderCoverHtml(letter(), person, ''), /letter-sheet/);
});

test('render: an on-site or hybrid role drops the workplace line from the header, a remote role keeps it', () => {
  const contact = (ref) => renderCoverHtml(letter({ ref }), person, '').match(/<p class="contact">[^\n]*/)[0];
  assert.doesNotMatch(contact('Full-time, Springfield, on-site'), /Remote \(US\)/);
  assert.doesNotMatch(contact('Full-time, Springfield area, hybrid'), /Remote \(US\)/);
  assert.doesNotMatch(contact('Full-time, Springfield, in-office'), /Remote \(US\)/);
  assert.match(contact('Full-time, remote (US)'), /Springfield, IL<span class="sep"> · <\/span>Remote \(US\)/);
  assert.match(contact('Position ID 1'), /Remote \(US\)/);
});

test('file slug keeps accented letters as their base letter', () => {
  assert.equal(coverSlug('ÉTOILE Example'), 'etoile-example');
  assert.equal(coverSlug('Société Générale Labs'), 'societe-generale-labs');
  assert.equal(coverSlug('Example Co.'), 'example-co');
  assert.equal(coverSlug(''), '');
});
