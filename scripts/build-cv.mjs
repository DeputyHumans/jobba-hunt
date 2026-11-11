#!/usr/bin/env node
// Build the CVs: <workspace>/collateral/cv/master.json + variants/<slug>.json -> designed,
// ATS-safe PDFs, each with a paginated HTML twin and a plain .docx copy. Renders with the
// project's Chromium (CloakBrowser binary, or CHROME_PATH) through playwright-core, network
// blocked, footer drawn by page.pdf. Then it checks the PDF itself (scripts/lib/pdf.mjs): the
// paper size and the page count from preferences.cv (default Letter, 2 pages), named embedded
// fonts with no Type 3, text-layer reading order, the never-claim lint on both the model and the
// extracted text, and keyword coverage. Page PNGs (Chromium screenshots of the paginated HTML)
// go to <data>/cv-preview/ for visual QA. The saved HTML is split at the PDF's own page starts
// into sheets, so a browser (and a published copy) shows the same pages as the PDF.
//
// Usage:
//   npm run cv -- --all                      # all variants
//   npm run cv -- --variant <slug>           # one variant
//   npm run cv -- --all --no-docx            # skip the .docx copy
//   npm run cv -- --match <job_id>           # rank the CVs for a fetched job (jobs.json / data/probes)
//   npm run cv -- --match path/to/jd.txt     # ... or for a job description in a text file
//   npm run cv -- --match <id> --candidate <slug>  # judge a new variant: its own keywords stay out of the vocabulary
//   npm run cv -- --dir <list>/cv --all      # targeted CVs kept in a recruiter list's own folder, outside the standard inventory
//   npm run cv -- --match <jd.txt> --dir <list>/cv --candidate <slug>  # a targeted CV against the standard ones
//   npm run cv -- --match <jd.txt> --terms <jd.terms.txt> [--dir <list>/cv]  # a fixed, JD-derived vocabulary
//     (one term per line, | for alternatives, # comments), written before any CV is drafted for that JD
//   --date YYYYMMDD names the dated folder (default: today in preferences.schedule.tz)
//
// Outputs under <workspace>/data/out/cv (CV_OUT):
//   <YYYYMMDD>/<prefix>-cv-<slug>.{html,pdf,docx}   the dated build
//   share/<prefix>-cv-<share>.{pdf,docx}            the ready-to-attach copies
// With --dir, both go to CV_OUT/<list>/ instead (<list> is the folder holding <list>/cv), so
// share/ and the standard CVs stay untouched. Exit 1 if any check fails or no Chromium is installed.

import './lib/env.mjs';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  claimIdsFromBank, validateVariant, assemble, renderHtml, modelText, lintText, coverage, checkExtracted, rankForJd, checkPageSplit, variantPool, bodySegments, repeatedPhrases,
  cvPerson, inlineFonts, paperOf, sheetCss, pageRuleCss, pdfFooterTemplate, CV_MARGINS,
} from './lib/cv.mjs';
import { pageStarts, paginate } from './lib/cv-pages.mjs';
import { pdfInfo, isPageSize, pdfFonts, fontProblems, pageLines, launchChromium } from './lib/pdf.mjs';
import { cvDocx, docxText } from './lib/docx.mjs';
import { CV_OUT, CV_SRC, COLLATERAL_DIR, DATA_DIR, brandFile, display, resolveArgPath } from './lib/paths.mjs';
import { requireWorkspace } from './lib/config.mjs';
import { cvFileBase, person, preferences, tz } from './lib/profile.mjs';
import { logAction } from './lib/actions-log.mjs';

const PREVIEW = join(DATA_DIR, 'cv-preview');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const finish = (o, code) => { console.log(JSON.stringify(o)); process.exit(code); };

const args = process.argv.slice(2);
const flag = (f) => args.includes(`--${f}`);
const opt = (f) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };

try { requireWorkspace(); } catch (err) { console.error(err.message); finish({ success: false, error: err.message }, 1); }

const master = readJson(join(CV_SRC, 'master.json'));
master.person = cvPerson(person(), master.person);
const rules = readJson(join(CV_SRC, 'never-claim.json'));
const claimIds = claimIdsFromBank(readFileSync(join(COLLATERAL_DIR, 'claim-bank.md'), 'utf8'));
const readVariants = (dir) => (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f)));
const variants = readVariants(join(CV_SRC, 'variants'));
const listDir = opt('dir') ? resolveArgPath(opt('dir')) : null;
const targeted = listDir ? readVariants(listDir) : [];

// ---------- --match ----------
function jdText(ref) {
  const file = resolveArgPath(ref);
  if (file && existsSync(file)) return readFileSync(file, 'utf8');
  const st = join(DATA_DIR, 'state', 'jobs.json');
  if (existsSync(st)) {
    const j = readJson(st).jobs?.[ref];
    if (j?.detail?.description_text) return `${j.title || ''}\n${j.detail.description_text}`;
  }
  // A probe file can hold several views of one job, and a view from an early extractor may hold
  // only a fragment of the description: take the longest.
  const dir = join(DATA_DIR, 'probes');
  const best = (existsSync(dir) ? readdirSync(dir) : [])
    .flatMap((f) => (readJson(join(dir, f)).views || []).filter((x) => x.job_id === ref && x.status === 'ok'))
    .sort((a, b) => (b.description_text || '').length - (a.description_text || '').length)[0];
  if (best && (best.description_text || '').length >= 100) return `${best.title || ''}\n${best.description_text}`;
  throw new Error(`no fetched description for ${ref} (data/state/jobs.json, data/probes) and no such file`);
}

if (opt('match')) {
  // The vocabulary is the union of the CVs' target_keywords. A candidate variant's own keywords
  // would move that yardstick, so --candidate leaves them out.
  // --terms replaces the CVs' own keywords with the JD's must-have terms: when the standard
  // vocabulary barely overlaps a posting, it cannot tell a tailored CV from a generic one.
  const terms = opt('terms') ? readFileSync(resolveArgPath(opt('terms')), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean) : null;
  const cvs = variantPool(variants, targeted, opt('candidate')).map((v) => ({ slug: v.slug, share: v.share, text: modelText(assemble(master, v)), keywords: terms || (v.slug === opt('candidate') ? [] : v.target_keywords) }));
  const ranked = rankForJd(jdText(opt('match')), cvs);
  console.error(`JD ${opt('match')}: ${ranked[0]?.jd_terms ?? 0} vocabulary terms found\n`);
  for (const r of ranked) {
    const share = cvs.find((c) => c.slug === r.slug).share;
    console.error(`${String(r.pct).padStart(3)}%  ${share.padEnd(30)} missing: ${r.missing.join(', ') || '-'}`);
  }
  finish({ match: opt('match'), ranked }, 0);
}

// ---------- build ----------
variantPool(variants, targeted); // throws on a slug collision: previews and published ids are keyed by slug
const source = listDir ? targeted : variants;
const pick = flag('all') ? source : source.filter((v) => v.slug === opt('variant'));
if (!pick.length) { console.error('usage: build-cv.mjs [--dir <list>/cv] --all | --variant <slug> [--no-docx] | --match <job_id|file>'); process.exit(1); }

const cvPrefs = preferences().cv || {};
const wantPages = Number(cvPrefs.pages) || 2;
const paper = paperOf(cvPrefs.paper);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz() || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
const stamp = opt('date') || today;
const outRoot = listDir ? join(CV_OUT, basename(dirname(listDir))) : CV_OUT;
const datedDir = join(outRoot, stamp);
const shareDir = join(outRoot, 'share');
const docx = !flag('no-docx');
mkdirSync(datedDir, { recursive: true });
mkdirSync(shareDir, { recursive: true });
mkdirSync(PREVIEW, { recursive: true });

const readFont = (name) => readFileSync(brandFile('fonts', name));
const css = `${inlineFonts(readFileSync(brandFile('cv', 'template.css'), 'utf8'), readFont)}\n${sheetCss(paper)}`;
const footerFace = inlineFonts('@font-face { font-family: "Nunito Sans"; src: url("nunito-sans-regular.woff2") format("woff2"); font-weight: 400; }', readFont);
const footerBandPt = CV_MARGINS.bottom * 72;
const bodyTopPt = paper.pt[1] - CV_MARGINS.top * 72;
const bodyHeightPt = bodyTopPt - footerBandPt;

let browser;
try {
  browser = await launchChromium();
} catch (err) {
  console.error(err.message);
  finish({ success: false, error: err.message }, 1);
}
const report = [];
let failed = false;

try {
  for (const v of pick) {
    const errs = validateVariant(master, v, claimIds);
    const model = assemble(master, v);
    const srcLint = lintText(modelText(model), rules);
    const base = join(datedDir, cvFileBase(v.slug));
    const sharePdf = join(shareDir, `${cvFileBase(v.share)}.pdf`);
    writeFileSync(`${base}.html`, renderHtml(model, css));

    const page = await browser.newPage({ deviceScaleFactor: 1.25 });
    await page.route('**/*', (r) => (/^(file|data):/.test(r.request().url()) ? r.continue() : r.abort()));
    await page.goto(pathToFileURL(`${base}.html`).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const footLeft = `${model.person.name} · ${v.target_title} · ${model.person.email}`;
    await page.pdf({
      path: `${base}.pdf`,
      format: paper.format,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: pdfFooterTemplate(footLeft, { fontFaceCss: footerFace }),
      margin: { top: `${CV_MARGINS.top}in`, bottom: `${CV_MARGINS.bottom}in`, left: `${CV_MARGINS.x}in`, right: `${CV_MARGINS.x}in` },
    });

    const info = await pdfInfo(`${base}.pdf`);
    const pages = info.pages;
    const sizeOk = isPageSize(info, paper.pt);
    const fonts = await pdfFonts(`${base}.pdf`);
    const fontErrs = fontProblems(fonts);
    const fontNames = [...new Set(fonts.map((f) => f.family).filter(Boolean))];
    const lines = await pageLines(`${base}.pdf`, { footerBandPt });
    const pageText = lines.map((ls) => ls.map((l) => l.text).join('\n'));
    const text = pageText.join('\n');
    const textErrs = checkExtracted(text, model);
    const splitErrs = pageText.slice(1).flatMap((t, i) => checkPageSplit(pageText[i], t, model).map((e) => (pages > 2 ? `pages ${i + 1}/${i + 2}: ${e}` : e)));
    const pdfLint = lintText(text, rules);
    const cov = coverage(text, v.target_keywords);
    const unexplained = cov.missing.filter((k) => !(v.honest_gaps || []).includes(k));
    const bodyLines = lines.map((ls) => ls.filter((l) => !l.footer));
    const p2fill = pages >= 2 ? Math.round((100 * bodyLines[1].length) / Math.max(1, bodyLines[0].length)) : null;
    const pageFill = bodyLines.map((ls) => (ls.length ? Math.round((100 * (bodyTopPt - Math.min(...ls.map((l) => l.y)))) / bodyHeightPt) : 0));

    // The saved HTML shows the PDF's pages on screen: split at each PDF page start, one sheet per
    // page, static (no script). The PDF above was printed from the unsplit HTML.
    const screen = await page.evaluate(paginate, {
      starts: pageStarts(pageText, footLeft),
      footLeft,
      pageHeightPx: (paper.heightIn - CV_MARGINS.top - CV_MARGINS.bottom) * 96,
    });
    const screenErrs = screen.error ? [screen.error]
      : [...(screen.pages === pages ? [] : [`${screen.pages} sheets for ${pages} PDF pages`]), ...screen.overflow.map((o) => `sheet ${o.page} overflows by ${o.px}px`)];
    for (const f of readdirSync(PREVIEW).filter((f) => f.startsWith(`${v.slug}-`))) rmSync(join(PREVIEW, f));
    const previews = [];
    if (!screen.error) {
      // Zero page margins: each sheet carries its own margins and footer, and the browser's URL
      // and date lines get no room. Then print it the way a browser does (a published copy's
      // "save as PDF"): it must give the same page count, with "X / Y" on every page.
      await page.addStyleTag({ content: pageRuleCss(paper) });
      writeFileSync(`${base}.html`, await page.content());
      const sheets = page.locator('.page');
      for (let i = 0; i < screen.pages; i += 1) {
        const png = join(PREVIEW, `${v.slug}-page-${i + 1}.png`);
        await sheets.nth(i).screenshot({ path: png });
        previews.push(display(png));
      }
      const browserPdf = join(PREVIEW, `${v.slug}-browser-print.pdf`);
      await page.pdf({ path: browserPdf, preferCSSPageSize: true, printBackground: true });
      const printed = await pageLines(browserPdf, { footerBandPt });
      if (printed.length !== pages) screenErrs.push(`browser print gives ${printed.length} pages, the PDF ${pages}`);
      printed.forEach((ls, i) => {
        if (!ls.some((l) => l.text.includes(`${i + 1} / ${pages}`))) screenErrs.push(`browser print page ${i + 1} has no "${i + 1} / ${pages}" footer`);
      });
    }
    await page.close();

    copyFileSync(`${base}.pdf`, sharePdf);
    const docxErrs = [];
    let shareDocx = null;
    if (docx) {
      const buf = await cvDocx(model, { paper: paper.name });
      const dtext = docxText(buf);
      if (!dtext.startsWith(model.person.name)) docxErrs.push('docx: the name is not the first line');
      for (const h of ['SUMMARY', 'CAREER HIGHLIGHTS', 'SKILLS', 'EXPERIENCE', 'EDUCATION']) if (!dtext.split('\n').includes(h)) docxErrs.push(`docx: heading ${h} missing`);
      docxErrs.push(...lintText(dtext, rules).map((h) => `lint(docx) ${h.id}: "${h.match}"`));
      writeFileSync(`${base}.docx`, buf);
      shareDocx = join(shareDir, `${cvFileBase(v.share)}.docx`);
      writeFileSync(shareDocx, buf);
    }

    const problems = [
      ...errs.map((e) => `claims: ${e}`),
      ...srcLint.map((h) => `lint(source) ${h.id}: "${h.match}"`),
      ...pdfLint.map((h) => `lint(pdf) ${h.id}: "${h.match}"`),
      ...textErrs.map((e) => `ats: ${e}`),
      ...splitErrs.map((e) => `layout: ${e}`),
      ...screenErrs.map((e) => `screen: ${e}`),
      ...(pages === wantPages ? [] : [`pages: ${pages}, want ${wantPages}`]),
      ...(sizeOk ? [] : [`page size is not ${paper.format}`]),
      ...fontErrs.map((e) => `fonts: ${e}`),
      ...docxErrs,
      ...unexplained.map((k) => `keyword "${k}" missing and not listed in honest_gaps`),
      ...repeatedPhrases(bodySegments(model)).map((r) => `repeat: "${r.phrase}" in ${r.where.join(' and ')}`),
    ];
    if (problems.length) failed = true;
    report.push({
      slug: v.slug, share: v.share, pages, paper: paper.name, page2_fill_pct: p2fill, page_fill_pct: pageFill, fonts: fontNames,
      font_types: [...new Set(fonts.map((f) => f.type))], coverage_pct: cov.pct, missing: cov.missing, problems,
      pdf: display(`${base}.pdf`), html: display(`${base}.html`), share_pdf: display(sharePdf), ...(shareDocx ? { docx: display(`${base}.docx`), share_docx: display(shareDocx) } : {}), previews,
    });
    logAction({ actor: 'script', action: 'cv.built', source: 'build-cv', ref: v.slug, detail: { share: v.share, pages, ok: !problems.length, problems: problems.length } });
    console.error(`${problems.length ? 'FAIL' : 'ok  '} ${v.slug.padEnd(24)} pages ${pages} | fill ${pageFill.join('/')}% | p2 lines ${p2fill}% | coverage ${cov.pct}% | fonts ${fontNames.join(', ')}`);
    for (const p of problems) console.error(`       - ${p}`);
  }
} finally {
  await browser.close();
}

console.error(`\nshare copies: ${display(shareDir)}\npreviews: ${display(PREVIEW)}`);
finish({ success: !failed, report }, failed ? 1 : 0);
