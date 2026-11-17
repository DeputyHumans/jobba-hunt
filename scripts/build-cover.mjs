#!/usr/bin/env node
// Cover letter builder. Renders <data>/applications/<job_id>/cover-letter.json into a one-page PDF
// in the CV's typography (paper from preferences.cv.paper, Letter by default), then checks the
// PDF itself (scripts/lib/pdf.mjs): one page, named embedded fonts with no Type 3, and the
// never-claim lint on the text layer. The letter's claims must exist in
// <workspace>/collateral/claim-bank.md, and it must run 100 to 260 words. The person block is
// profile/person.json with master.json's person fields over it, the same block the CV prints.
//
// Usage: node scripts/build-cover.mjs --job <job_id>
// Outputs, next to the JSON: <prefix>-cover-letter-<company-slug>.{html,pdf,png} and
// cover-letter.txt (for text-box forms). The PDF is what goes into a cover-letter upload slot;
// the HTML is the one-sheet page a published copy shows; the PNG is a screenshot of that sheet.

import './lib/env.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { claimIdsFromBank, lintText, cvPerson, inlineFonts, paperOf, sheetCss } from './lib/cv.mjs';
import { validateCover, renderCoverHtml, coverText, coverWords, coverSheetHtml, coverSlug } from './lib/cover.mjs';
import { pdfInfo, pdfFonts, fontProblems, pdfText, launchChromium } from './lib/pdf.mjs';
import { CV_SRC, COLLATERAL_DIR, DATA_DIR, brandFile, display } from './lib/paths.mjs';
import { requireWorkspace } from './lib/config.mjs';
import { coverFileBase, person as profilePerson, preferences } from './lib/profile.mjs';
import { logAction } from './lib/actions-log.mjs';
import { parseArgs, out, fail } from './cloak-core.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const { flags } = parseArgs(process.argv.slice(2));
const id = String(flags.job || '');
try { requireWorkspace(); } catch (err) { fail(err.message); }
const dir = join(DATA_DIR, 'applications', id);
const src = join(dir, 'cover-letter.json');
if (!id || !existsSync(src)) fail(`no letter at ${display(src)}`);

const letter = readJson(src);
const person = cvPerson(profilePerson(), readJson(join(CV_SRC, 'master.json')).person);
const rules = readJson(join(CV_SRC, 'never-claim.json'));
const claimIds = claimIdsFromBank(readFileSync(join(COLLATERAL_DIR, 'claim-bank.md'), 'utf8'));
const errs = validateCover(letter, claimIds);
const text = coverText(letter, person);
const srcLint = lintText(text, rules);
if (errs.length || srcLint.length) fail('letter checks failed', { errors: errs, lint: srcLint });

const paper = paperOf(preferences().cv?.paper);
const slug = coverSlug(letter.company);
const base = join(dir, coverFileBase(slug));
const readFont = (name) => readFileSync(brandFile('fonts', name));
const css = `${inlineFonts(`${readFileSync(brandFile('cv', 'template.css'), 'utf8')}\n${readFileSync(brandFile('cv', 'cover.css'), 'utf8')}`, readFont)}\n${sheetCss(paper)}`;
writeFileSync(`${base}.html`, renderCoverHtml(letter, person, css));
writeFileSync(join(dir, 'cover-letter.txt'), `${text}\n`);

const browserPdf = `${base}-browser-print.pdf`;
let browser;
try {
  browser = await launchChromium();
} catch (err) {
  fail(err.message);
}
try {
  const page = await browser.newPage({ deviceScaleFactor: 1.25 });
  await page.route('**/*', (r) => (/^(file|data):/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto(pathToFileURL(`${base}.html`).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: `${base}.pdf`, format: paper.format, printBackground: true, margin: { top: '1in', bottom: '0.8in', left: '1in', right: '1in' } });
  // The saved HTML (what a published copy shows) is the same letter on one sheet, like a CV page.
  // A browser print of it ("save as PDF") must still be one page.
  writeFileSync(`${base}.html`, coverSheetHtml(readFileSync(`${base}.html`, 'utf8'), paper));
  await page.goto(pathToFileURL(`${base}.html`).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.page.letter-sheet').screenshot({ path: `${base}.png` });
  await page.pdf({ path: browserPdf, preferCSSPageSize: true, printBackground: true });
} finally {
  await browser.close();
}

const problems = [];
const pages = (await pdfInfo(`${base}.pdf`)).pages;
if (pages !== 1) problems.push(`${pages} pages; a cover letter is one page`);
problems.push(...fontProblems(await pdfFonts(`${base}.pdf`)));
const sheetPages = (await pdfInfo(browserPdf)).pages;
if (sheetPages !== 1) problems.push(`the page view prints as ${sheetPages} pages; it must be one`);
const pdfLint = lintText(await pdfText(`${base}.pdf`), rules);
problems.push(...pdfLint.map((h) => `lint(pdf) ${h.id}: "${h.match}"`));
logAction({ actor: 'script', action: 'letter.built', source: 'build-cover', job_id: id, detail: { pages, words: coverWords(letter), ok: !problems.length } });
if (problems.length) fail('PDF checks failed', { problems, pdf: display(`${base}.pdf`) });
out({ success: true, job_id: id, words: coverWords(letter), pages, paper: paper.name, pdf: display(`${base}.pdf`), txt: display(join(dir, 'cover-letter.txt')), png: display(`${base}.png`) });
