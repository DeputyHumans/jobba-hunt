// The screen HTML shows the PDF's pages: pageStarts reads each page's first line from the PDF
// text (pdf.mjs pageTexts), paginate splits the DOM there (the project's Chromium, no network).
// The browser tests skip when no Chromium is installed (npm run setup installs it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR } from '../scripts/lib/paths.mjs';
import { pageStarts, paginate } from '../scripts/lib/cv-pages.mjs';
import { chromiumPath, launchChromium } from '../scripts/lib/pdf.mjs';

const skip = await chromiumPath().then(() => false, (err) => err.message);

test('pageStarts takes each later page\'s first content line and skips the footer', () => {
  const p1 = 'Jordan Example\nHead of Engineering\n\nJordan Example · Head of Engineering · jordan@example.com\n1 / 2\n';
  const p2 = '\nJordan Example · Head of Engineering · jordan@example.com\n2 / 2\nPlatform and reliability\n2019 – 2023\n• Moved 140 services\n';
  assert.deepEqual(pageStarts([p1, p2], 'Jordan Example · Head of Engineering'), ['Platform and reliability']);
  assert.deepEqual(pageStarts([p1], 'x'), []);
  const footerLast = 'Data platform 2020 – 2023\n• Led the streaming data platform\nJordan Example · Head of Engineering · jordan@example.com 2 / 2';
  assert.deepEqual(pageStarts([p1, footerLast], 'Jordan Example · Head of Engineering'), ['Data platform 2020 - 2023'], 'the footer line last on the page (pdf.mjs order) is never a start');
});

const HTML = `<!doctype html><html><head><style>.role{margin:0}</style></head><body><main>
<header><h1>Jordan Example</h1></header>
<section class="experience"><h2>Experience</h2>
<div class="role"><div class="role-head"><span>Director of Engineering · Globex</span><span class="dates">Jan 2019 – Feb 2023</span></div>
<ul class="bul"><li><span class="b">• </span>First bullet.</li><li><span class="b">• </span>Second bullet.</li></ul>
<div class="sub-group"><div class="sub-head"><span>Data platform</span><span class="dates">2020 – 2023</span></div><ul class="bul"><li><span class="b">• </span>Led a “streams first” team.</li></ul></div>
</div>
<p class="role early"><span class="role-title">Software Engineer</span> · Soylent Systems · 2008 – 2010. Supply chain.</p>
</section>
<section class="education"><h2>Education</h2><ul class="bul"><li>Bachelor’s Degree</li></ul></section>
</main></body></html>`;

// The page loads from a file URL: the bundled Chromium never finishes page.setContent.
const FILE = join(DATA_DIR, 'test-cv-pages', 'cv.html');
let browser;
before(async () => {
  if (skip) return;
  mkdirSync(join(DATA_DIR, 'test-cv-pages'), { recursive: true });
  writeFileSync(FILE, HTML);
  browser = await launchChromium();
});
after(async () => { await browser?.close(); });

async function run(starts) {
  const page = await browser.newPage();
  try {
    await page.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
    await page.goto(pathToFileURL(FILE).href);
    const r = await page.evaluate(paginate, { starts, footLeft: 'Jordan Example · Head of Engineering', pageHeightPx: 955 });
    const sheets = await page.evaluate(() => [...document.querySelectorAll('.page')].map((p) => ({
      text: p.querySelector('.page-body').textContent.replace(/\s+/g, ' ').trim(), foot: p.querySelector('.page-foot').textContent,
    })));
    const trimmed = await page.evaluate(() => [...document.querySelectorAll('.page-body')].map((b) => ({
      lastBottom: b.lastElementChild.style.marginBottom, firstTop: b.firstElementChild.style.marginTop,
    })));
    return { r, sheets, trimmed, scripts: await page.evaluate(() => document.scripts.length) };
  } finally { await page.close(); }
}

test('a break inside a role moves the whole sub-group and everything after it, inside cloned role and section shells', { skip }, async () => {
  const { r, sheets, scripts } = await run(['Data platform']);
  assert.equal(r.pages, 2);
  assert.match(sheets[0].text, /First bullet\. ?• Second bullet\.$/);
  assert.match(sheets[1].text, /^Data platform ?2020 – 2023 ?• Led a “streams first” team\. ?Software Engineer · Soylent Systems/);
  assert.match(sheets[1].text, /Education ?Bachelor’s Degree$/);
  assert.match(sheets[1].foot, /Jordan Example · Head of Engineering\s*2 \/ 2/);
  assert.equal(scripts, 0, 'static: no script in the saved HTML');
});

test('margins at a sheet break are trimmed as print layout trims them at a page break', { skip }, async () => {
  const { trimmed } = await run(['Data platform']);
  assert.deepEqual(trimmed.map((t) => t.lastBottom), ['0px', '0px'], 'every sheet ends without a trailing margin');
  assert.equal(trimmed[0].firstTop, '', 'sheet 1 keeps its top margin');
  assert.equal(trimmed[1].firstTop, '0px', 'a continued sheet starts flush, like page 2 of the PDF');
});

test('a page that starts at a role head breaks before the whole role; quotes, dashes and spaces are matched loosely', { skip }, async () => {
  const { r, sheets } = await run(['Director of Engineering · Globex Jan 2019 - Feb 2023']);
  assert.equal(r.pages, 2);
  assert.equal(sheets[0].text, 'Jordan Example Experience');
  assert.match(sheets[1].text, /^Director of Engineering · Globex/);
  assert.deepEqual((await run(['• Led a "streams first" team.'])).sheets.length, 2);
});

test('a page start that is missing or ambiguous is an error, never a guess', { skip }, async () => {
  assert.match((await run(['Nowhere in this CV'])).r.error, /not found/);
  assert.match((await run(['• '])).r.error, /ambiguous/);
});

test('a page that opens on a sub-head starts at the sub-head label; a stray bullet glyph is dropped', () => {
  const p1 = 'Jordan Example\nSUMMARY';
  assert.deepEqual(pageStarts([p1, 'Organisation and hiring • Built a structured interview loop\n2019 – 2023'], 'Jordan Example ·'), ['Organisation and hiring']);
  assert.deepEqual(pageStarts([p1, '• Led a 60-engineer platform group'], 'Jordan Example ·'), ['Led a 60-engineer platform group']);
  assert.deepEqual(pageStarts([p1, 'Senior Software Engineer · Umbrella Labs'], 'Jordan Example ·'), ['Senior Software Engineer · Umbrella Labs']);
});
