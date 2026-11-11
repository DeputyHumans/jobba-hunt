// pdf.mjs: page count and size, the font list with types (the "named fonts, no Type 3" gate),
// text in reading order with the footer last, and the Chromium binary lookup. The rendering
// tests use the project's Chromium and skip when none is installed (npm run setup).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import {
  pdfInfo, pageCount, isPageSize, pdfFonts, fontProblems, lineItems, linesOf, pageTexts, pageLines, chromiumPath, launchChromium, ChromiumMissingError,
} from '../scripts/lib/pdf.mjs';
import { assemble, renderHtml, inlineFonts, CV_MARGINS } from '../scripts/lib/cv.mjs';
import { BRAND_DIR, DATA_DIR } from '../scripts/lib/paths.mjs';

const item = (str, x, y, { size = 10, width = str.length * size * 0.5 } = {}) => ({ str, transform: [size, 0, 0, size, x, y], width, hasEOL: false });

test('lines follow stream order, split on a baseline change or a jump back left, and join runs with spaces', () => {
  const items = [
    item('Head of Engineering', 50, 700), item(' · ', 145, 700), item('Acme Corp', 160, 700), item('Mar 2023 – Present', 480, 700),
    item('“Scale the team”', 50, 680), item('Grew engineering from 12 to 45', 300, 680), item('through hiring', 50, 668),
    item('', 0, 0), item(' ', 120, 668),
  ];
  assert.equal(linesOf(items), 'Head of Engineering · Acme Corp Mar 2023 – Present\n“Scale the team” Grew engineering from 12 to 45\nthrough hiring');
});

test('lines in the footer band go last on their page, top to bottom', () => {
  const items = [item('Jordan Example · Head of Engineering', 44, 20), item('1 / 2', 540, 20), item('Jordan Example', 44, 740), item('SUMMARY', 44, 700)];
  const rows = lineItems(items, { footerBandPt: 39.6 });
  assert.deepEqual(rows.map((r) => [r.text, r.footer]), [['Jordan Example', false], ['SUMMARY', false], ['Jordan Example · Head of Engineering 1 / 2', true]]);
  assert.equal(linesOf(items), 'Jordan Example · Head of Engineering 1 / 2\nJordan Example\nSUMMARY', 'without a band, stream order stands');
});

async function synthetic() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [i, lines] of [['Jordan Example', 'SUMMARY'], ['Director of Engineering · Globex', 'Moved 140 services']].entries()) {
    const page = doc.addPage([612, 792]);
    lines.forEach((t, k) => page.drawText(t.replace('·', '-'), { x: 44, y: 740 - k * 14, size: 10, font }));
    page.drawText(`${i + 1} / 2`, { x: 540, y: 20, size: 8, font });
  }
  return doc;
}

test('page count, page size and per-page text from a PDF', async () => {
  const bytes = await (await synthetic()).save();
  const info = await pdfInfo(bytes);
  assert.equal(info.pages, 2);
  assert.equal(await pageCount(bytes), 2);
  assert.ok(isPageSize(info, [612, 792]));
  assert.ok(!isPageSize(info, [595, 842]));
  assert.deepEqual(await pageTexts(bytes, { footerBandPt: 39.6 }), ['Jordan Example\nSUMMARY\n1 / 2', 'Director of Engineering - Globex\nMoved 140 services\n2 / 2']);
  const lines = await pageLines(bytes, { footerBandPt: 39.6 });
  assert.deepEqual(lines[1].map((l) => l.footer), [false, false, true]);
  assert.equal(lines[0][0].y, 740);
});

test('font types: Type 3 and unembedded fonts fail the gate; an embedded CID TrueType passes', async () => {
  const doc = await synthetic();
  const ctx = doc.context;
  ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type3' }));
  const file = ctx.register(ctx.stream(new Uint8Array([0])));
  const desc = ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'ABCDEF+NunitoSans-Regular', FontFile2: file }));
  const kid = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'ABCDEF+NunitoSans-Regular', FontDescriptor: desc }));
  ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'ABCDEF+NunitoSans-Regular', DescendantFonts: [kid] }));
  const fonts = await pdfFonts(await doc.save());
  const by = Object.fromEntries(fonts.map((f) => [f.family || '(none)', f]));
  assert.equal(by['NunitoSans-Regular'].type, 'CID TrueType');
  assert.equal(by['NunitoSans-Regular'].embedded, true);
  assert.equal(by['NunitoSans-Regular'].subset, true);
  assert.equal(by.Helvetica.type, 'Type 1');
  assert.equal(by.Helvetica.embedded, false);
  assert.equal(by['(none)'].type, 'Type 3');
  assert.ok(!fonts.some((f) => f.subtype === 'CIDFontType2'), 'a descendant font is reported through its Type0 parent');
  assert.deepEqual(fontProblems(fonts).sort(), ['Type 3 font embedded', 'font Helvetica not embedded']);
  assert.deepEqual(fontProblems(fonts.filter((f) => f.type === 'CID TrueType')), []);
  assert.equal(PDFName.of('Font'), PDFName.of('Font'), 'names are interned, so lookups by name are stable');
});

test('chromiumPath: CHROME_PATH wins, a missing override fails, an empty cache says "run npm run setup"', async () => {
  const dir = mkdtempSync(join(DATA_DIR, 'chromium-'));
  const fake = join(dir, 'chrome');
  writeFileSync(fake, '');
  assert.equal(await chromiumPath({ env: { CHROME_PATH: fake, CLOAKBROWSER_BINARY_PATH: '/nowhere' } }), fake);
  assert.equal(await chromiumPath({ env: { CLOAKBROWSER_BINARY_PATH: fake } }), fake);
  await assert.rejects(chromiumPath({ env: { CHROME_PATH: join(dir, 'missing') } }), (e) => e instanceof ChromiumMissingError && /CHROME_PATH/.test(e.message) && /run npm run setup/.test(e.message));
  const empty = join(dir, 'cache');
  mkdirSync(empty);
  const saved = process.env.CLOAKBROWSER_CACHE_DIR;
  process.env.CLOAKBROWSER_CACHE_DIR = empty; // binaryInfo() reads the cache dir from the environment
  try {
    await assert.rejects(chromiumPath({ env: { CLOAKBROWSER_CACHE_DIR: empty } }), /no Chromium binary found.*run npm run setup/);
  } finally {
    process.env.CLOAKBROWSER_CACHE_DIR = saved;
  }
});

// ---------- rendered with the project's Chromium ----------
const skip = await chromiumPath().then(() => false, (err) => err.message);
let browser;
before(async () => { if (!skip) browser = await launchChromium(); });
after(async () => { await browser?.close(); });

async function render(html, name) {
  const dir = join(DATA_DIR, 'test-pdf');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);
  const page = await browser.newPage();
  try {
    await page.route('**/*', (r) => (/^(file|data):/.test(r.request().url()) ? r.continue() : r.abort()));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: 'Letter', margin: { top: `${CV_MARGINS.top}in`, bottom: `${CV_MARGINS.bottom}in`, left: '0.62in', right: '0.62in' } });
  } finally { await page.close(); }
}

test('the bundled CV fonts embed as named CID TrueType, never Type 3', { skip }, async () => {
  const css = inlineFonts(readFileSync(join(BRAND_DIR, 'cv', 'template.css'), 'utf8'), (n) => readFileSync(join(BRAND_DIR, 'fonts', n)));
  const model = assemble({
    person: { name: 'Jordan Example', location: 'Springfield, IL', workplace: 'Remote (US)', email: 'jordan@example.com', linkedin: 'linkedin.com/in/jordan-example', claims: ['C01'] },
    bullets: { b: { text: 'Grew engineering from 12 to 45 engineers.', claims: ['C03'] } },
    roles: { acme: { title: 'Head of Engineering', company: 'Acme Corp', dates: 'Mar 2023 – Present', claims: ['C02'], contexts: { default: { text: 'B2B workflow software.', claims: ['C02'] } } } },
    education: [{ degree: 'B.S. Computer Science', school: 'Example State University', year: '2008', claims: ['C19'] }],
  }, {
    headline: 'Head of Engineering · Scaling Teams', target_title: 'Head of Engineering', summary: { text: 'Engineering leader.' },
    highlights: [{ label: 'Scaling', text: 'six teams.' }], skills: [{ label: 'Platform', terms: ['AWS'] }],
    experience: [{ role: 'acme', items: ['b'] }],
  });
  const pdf = await render(renderHtml(model, css), 'fonts');
  const fonts = await pdfFonts(pdf);
  assert.deepEqual(fontProblems(fonts), []);
  assert.deepEqual([...new Set(fonts.map((f) => f.type))], ['CID TrueType']);
  for (const fam of ['Charis-Bold', 'NunitoSans-Regular', 'NunitoSans-Bold', 'NunitoSans-Italic']) assert.ok(fonts.some((f) => f.family === fam), fam);
  const [text] = await pageTexts(pdf);
  assert.match(text, /^Jordan Example\n/);
  assert.match(text, /Head of Engineering · Acme Corp Mar 2023 – Present/);
});

test('a variable font is caught by the gate: Chromium embeds it as Type 3', { skip }, async () => {
  const face = inlineFonts("@font-face{font-family:V;src:url('instrument-sans-latin-wght-normal.woff2') format('woff2');font-weight:400 700}", (n) => readFileSync(join(BRAND_DIR, 'fonts', n)));
  const pdf = await render(`<!doctype html><html><head><style>${face} body{font-family:V}</style></head><body><p>Variable</p></body></html>`, 'variable');
  assert.ok(fontProblems(await pdfFonts(pdf)).includes('Type 3 font embedded'));
});
