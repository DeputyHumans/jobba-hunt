// docx.mjs: the Word copy of a CV from the same model, ATS-plain, read back with the built-in zip reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cvDocx, docxText, zipEntry } from '../scripts/lib/docx.mjs';
import { assemble, cvPerson } from '../scripts/lib/cv.mjs';

const FIX = new URL('./fixtures/workspace/', import.meta.url);
const master = JSON.parse(readFileSync(new URL('collateral/cv/master.json', FIX), 'utf8'));
master.person = cvPerson(JSON.parse(readFileSync(new URL('profile/person.json', FIX), 'utf8')), master.person);
const variant = JSON.parse(readFileSync(new URL('collateral/cv/variants/head-of-engineering.json', FIX), 'utf8'));
const model = assemble(master, variant);

test('the .docx holds the CV in reading order: name, headline, contact, then the sections', async () => {
  const buf = await cvDocx(model);
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const lines = docxText(buf).split('\n');
  assert.equal(lines[0], 'Jordan Example');
  assert.equal(lines[1], 'Head of Engineering · Scaling Teams, Delivery and Platform');
  assert.equal(lines[2], 'Springfield, IL · Remote (US) · jordan@example.com · linkedin.com/in/jordan-example');
  const at = (h) => lines.indexOf(h);
  const heads = ['SUMMARY', 'CAREER HIGHLIGHTS', 'SKILLS', 'EXPERIENCE', 'EDUCATION'].map(at);
  assert.ok(heads.every((i, k) => i > 0 && (k === 0 || i > heads[k - 1])), 'every heading, in order');
  const role = lines.findIndex((l) => l.startsWith('Head of Engineering · Acme Corp'));
  assert.ok(role > at('EXPERIENCE'));
  assert.match(lines[role], /Mar 2023 – Present$/, 'dates follow the title on the same line (a right tab)');
  assert.ok(lines.includes('Platform and reliability 2019 – 2023'), 'sub-heads keep their dates');
  assert.ok(lines.some((l) => l.startsWith('Software Engineer · Soylent Systems · 2008 – 2010. ')), 'earlier roles are one paragraph each');
  assert.ok(lines.some((l) => /^Scaling: turned a 12-person team/.test(l)), 'highlights keep their labels');
});

test('display text matches the HTML: curly quotes and the nobreak phrases', async () => {
  const v = structuredClone(variant);
  v.summary.text = 'One team\'s "ship daily" rule, with SOC 2 controls.';
  const text = docxText(await cvDocx(assemble(master, v)));
  assert.match(text, /team’s “ship daily” rule, with SOC 2 controls\./);
});

test('ATS-plain: real list numbering, no tables, images or text boxes', async () => {
  const buf = await cvDocx(model);
  const xml = zipEntry(buf, 'word/document.xml').toString('utf8');
  assert.doesNotMatch(xml, /<w:tbl>|<w:drawing>|<w:txbxContent>|<w:pict>/);
  assert.match(xml, /<w:numPr>/);
  assert.match(zipEntry(buf, 'word/numbering.xml').toString('utf8'), /w:lvlText w:val="•"/);
});

test('paper: Letter by default, A4 on request', async () => {
  const size = async (paper) => zipEntry(await cvDocx(model, { paper }), 'word/document.xml').toString('utf8').match(/<w:pgSz [^>]*>/)[0];
  assert.match(await size(), /w:w="12240"[^>]*w:h="15840"/);
  assert.match(await size('a4'), /w:w="11906"[^>]*w:h="16838"/);
});

test('zipEntry finds an entry, returns null for a missing one, and refuses a non-zip', async () => {
  const buf = await cvDocx(model);
  assert.match(zipEntry(buf, '[Content_Types].xml').toString('utf8'), /wordprocessingml/);
  assert.equal(zipEntry(buf, 'nope.xml'), null);
  assert.throws(() => zipEntry(Buffer.from('not a zip at all, just some bytes that are long enough'), 'x'), /not a zip/);
});

test('the practice section, a shown phone and an education note reach the .docx', async () => {
  const m2 = structuredClone(master);
  m2.roles.studio = { title: 'Fractional CTO', company: 'Example Studio', dates: 'Jan 2024 – Present', claims: ['C02'],
    contexts: { default: { text: 'Fractional CTO practice for seed-stage teams.', claims: ['C02'] } }, clients: [{ name: 'Hooli', claims: ['C17'] }] };
  m2.education = [{ ...m2.education[0], note: 'with honors' }];
  const v = { ...structuredClone(variant), practice: { role: 'studio', clients: true } };
  const lines = docxText(await cvDocx(assemble(m2, v, { phone: '+1 (555) 555-0100' }))).split('\n');
  assert.equal(lines[2], 'Springfield, IL · Remote (US) · +1 (555) 555-0100 · jordan@example.com · linkedin.com/in/jordan-example');
  const pr = lines.indexOf('INDEPENDENT PRACTICE');
  assert.ok(pr > lines.indexOf('EXPERIENCE') && pr < lines.indexOf('EDUCATION'), 'practice sits between Experience and Education');
  assert.ok(lines.includes('Featured clients: Hooli'));
  assert.ok(lines.some((l) => l.startsWith('B.S. Computer Science (with honors) · Example State University')));
});
