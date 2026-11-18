// Cover letters: claims-only, lean, no em dash or semicolon, one page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCover, renderCoverHtml, coverText, coverWords, coverSheetHtml, coverSlug, LETTER_APPROACHES, letterNeedsReview } from '../scripts/lib/cover.mjs';
import { claimIdsFromBank } from '../scripts/lib/cv.mjs';
import { paperOf } from '../scripts/lib/cv.mjs';

const ids = new Set(['C03', 'C04', 'C27']);
const para = 'I grew the Acme Corp engineering team from 12 to 45 engineers and moved every team to daily releases. Each team owns its own service. ';
const letter = (o = {}) => ({
  job_id: '9000000001', approach: 'D', company: 'Example Co', role: 'VP of Engineering', ref: 'Position ID 1', date: 'November 10, 2026', greeting: 'Hello Example team,', closing: 'Best regards,',
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
  const errs = validateCover(letter({ approach: 'A', paragraphs: [{ text: para.repeat(5), claims: ['C03'] }, map] }), ids);
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

// ---------- approaches A to D (the examples in docs/tailoring.md are these fixture files) ----------
const FIXTURE_LETTERS = { A: 'a-requirements-map', B: 'b-first-two-weeks', C: 'c-three-questions', D: 'd-lean-ps' };
const fixtureLetter = (a) => JSON.parse(readFileSync(new URL(`fixtures/letters/${FIXTURE_LETTERS[a]}.json`, import.meta.url), 'utf8'));
const bankIds = claimIdsFromBank(readFileSync(new URL('fixtures/workspace/collateral/claim-bank.md', import.meta.url), 'utf8'));

test('approaches: the four example letters validate clean against the synthetic claim bank, each as its own approach', () => {
  assert.deepEqual(LETTER_APPROACHES, ['A', 'B', 'C', 'D']);
  for (const a of LETTER_APPROACHES) {
    const l = fixtureLetter(a);
    assert.equal(l.approach, a);
    assert.deepEqual(validateCover(l, bankIds, { requireWhy: true }), [], a);
  }
});

test('approaches: the letter names its approach, and a fixed preference or a per-job pick is enforced', () => {
  const { approach, ...none } = fixtureLetter('A');
  assert.ok(validateCover(none, bankIds).some((e) => /approach must be A, B, C or D/.test(e)));
  const { approach_why, ...noWhy } = fixtureLetter('A');
  assert.ok(validateCover(noWhy, bankIds, { requireWhy: true }).some((e) => /approach_why/.test(e)), 'per-job: the pick says why');
  assert.deepEqual(validateCover(noWhy, bankIds), [], 'a fixed approach needs no reason');
  assert.ok(validateCover(fixtureLetter('B'), bankIds, { fixed: 'A' }).some((e) => /tailoring.letter is A/.test(e)));
});

test('approach A: one requirements map of at least three rows, and no list or P.S.', () => {
  const l = fixtureLetter('A');
  const short = { ...l, paragraphs: l.paragraphs.map((p) => (p.map ? { map: p.map.slice(0, 2) } : p)) };
  assert.ok(validateCover(short, bankIds).some((e) => /approach A: one requirements map with at least 3 rows/.test(e)));
  assert.ok(validateCover({ ...l, paragraphs: [...l.paragraphs, { ps: 'More.', claims: ['C03'] }] }, bankIds).some((e) => /P\.S\. belongs to approach D/.test(e)));
});

test('approach B: one numbered plan of 2 to 4 steps, each resting on a claim, then the record', () => {
  const l = fixtureLetter('B');
  const plan = l.paragraphs.find((p) => p.list);
  const bare = { ...l, paragraphs: l.paragraphs.map((p) => (p.list ? { ...p, list: [{ text: 'Map every deploy path.', claims: [] }, ...p.list.slice(1)] } : p)) };
  assert.ok(validateCover(bare, bankIds).some((e) => /approach B: plan step 1 cites no claim/.test(e)));
  const unordered = { ...l, paragraphs: l.paragraphs.map((p) => (p.list ? { ...p, ordered: false } : p)) };
  assert.ok(validateCover(unordered, bankIds).some((e) => /approach B: one numbered list/.test(e)));
  const noRecord = { ...l, paragraphs: l.paragraphs.slice(0, l.paragraphs.indexOf(plan) + 1).concat({ text: 'Happy to talk.', claims: [] }) };
  assert.ok(validateCover(noRecord, bankIds).some((e) => /approach B: after the list, a paragraph citing the record/.test(e)));
});

test('approach C: 2 to 4 questions, each a question, then the record that answers them', () => {
  const l = fixtureLetter('C');
  const notQ = { ...l, paragraphs: l.paragraphs.map((p) => (p.list ? { ...p, list: [{ text: 'Deploys need a person.', claims: [] }, ...p.list.slice(1)] } : p)) };
  assert.ok(validateCover(notQ, bankIds).some((e) => /approach C: item 1 is not a question/.test(e)));
  const five = { ...l, paragraphs: l.paragraphs.map((p) => (p.list ? { ...p, list: [...p.list, ...p.list.slice(0, 2)] } : p)) };
  assert.ok(validateCover(five, bankIds).some((e) => /approach C: 2 to 4 questions/.test(e)));
});

test('approach D: 2 to 4 paragraphs, one at least citing claims, an optional P.S. last that cites a claim', () => {
  const l = fixtureLetter('D');
  assert.ok(validateCover({ ...l, paragraphs: l.paragraphs.map((p) => (p.ps ? { ...p, claims: [] } : p)) }, bankIds).some((e) => /P\.S\. cites no claim/.test(e)));
  const psFirst = { ...l, paragraphs: [l.paragraphs.at(-1), ...l.paragraphs.slice(0, -1)] };
  assert.ok(validateCover(psFirst, bankIds).some((e) => /P\.S\. comes last/.test(e)));
  assert.ok(validateCover({ ...l, paragraphs: [...l.paragraphs.slice(0, -1), { map: fixtureLetter('A').paragraphs[1].map }] }, bankIds).some((e) => /approach D: no map or list/.test(e)));
});

test('approaches: lists and the P.S. render in the page and in the text twin; B and C always wait for review', () => {
  const b = renderCoverHtml(fixtureLetter('B'), person, '');
  assert.match(b, /<ol class="plan"><li>Map how code reaches production/);
  assert.match(coverText(fixtureLetter('B'), person), /\n1\. Map how code reaches production[^\n]*\n2\. Set service level/);
  const c = renderCoverHtml(fixtureLetter('C'), person, '');
  assert.match(c, /<ul class="questions"><li>Which deploys still need a person/);
  assert.match(coverText(fixtureLetter('C'), person), /\n- Which deploys still need a person/);
  const d = renderCoverHtml(fixtureLetter('D'), person, '');
  assert.ok(d.indexOf('<p class="ps">') > d.indexOf('<p class="name">'), 'the P.S. follows the signature');
  assert.match(d, /<p class="ps"><span class="ps-label">P\.S\.<\/span> I also report DORA metrics/);
  assert.match(coverText(fixtureLetter('D'), person), /Jordan Example\n\nP\.S\. I also report DORA metrics/);
  assert.deepEqual(LETTER_APPROACHES.map((a) => letterNeedsReview({ approach: a })), [false, true, true, false]);
  for (const a of LETTER_APPROACHES) assert.ok(coverWords(fixtureLetter(a)) >= 100 && coverWords(fixtureLetter(a)) <= 260, `${a}: ${coverWords(fixtureLetter(a))} words`);
});

