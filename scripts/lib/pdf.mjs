// PDF inspection and rendering without poppler or a system browser.
//   pdfInfo / pageCount / isPageSize   page count and page sizes (pdf-lib)
//   pdfFonts / fontProblems            every font dictionary with its type, named the way pdffonts
//                                      names them ("CID TrueType", "Type 3", ...), and the gate a
//                                      build applies: named, embedded, no Type 3 (glyph procedures
//                                      an ATS cannot read reliably)
//   pageLines / pageTexts / pdfText    per-page text in reading order (pdfjs-dist, legacy Node build)
//   chromiumPath / launchChromium      the Chromium that renders CVs and letters: CHROME_PATH, else
//                                      CLOAKBROWSER_BINARY_PATH, else the CloakBrowser binary in the
//                                      project cache. Pages are loaded with goto(file URL): the
//                                      bundled build never finishes page.setContent.
//
// Reading order: Chromium writes text into the content stream in DOM paint order, so items are
// taken in stream order and grouped into lines by baseline. A new line starts when the baseline
// moves or the text jumps back to the left (the next row of a grid, or a footer drawn in its own
// pass). Lines whose baseline sits in the bottom margin band (the page footer) go last, so a
// page's text opens with its first content line, as pdftotext's did.

import './env.mjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';

const bytesOf = (src) => (typeof src === 'string' ? readFileSync(src) : src);

// ---------- structure ----------
export async function pdfInfo(src) {
  const doc = await PDFDocument.load(bytesOf(src), { updateMetadata: false });
  const sizes = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width: Math.round(width), height: Math.round(height) };
  });
  return { pages: sizes.length, sizes };
}

export const pageCount = async (src) => (await pdfInfo(src)).pages;

// True when every page has the given size in points, 1 pt tolerance (A4 is 595.28 x 841.89).
export const isPageSize = (info, [w, h]) => info.pages > 0 && info.sizes.every((s) => Math.abs(s.width - w) <= 1 && Math.abs(s.height - h) <= 1);

// ---------- fonts ----------
const nameOf = (v) => (v && typeof v.decodeText === 'function' ? v.decodeText() : null);

function fontFileKind(ctx, descriptor) {
  if (!(descriptor instanceof PDFDict)) return { embedded: false, file: null };
  for (const k of ['FontFile', 'FontFile2', 'FontFile3']) {
    const ref = descriptor.get(PDFName.of(k));
    if (!ref) continue;
    const stream = ctx.lookup(ref);
    return { embedded: true, file: k, sub: nameOf(stream?.dict?.get(PDFName.of('Subtype'))) };
  }
  return { embedded: false, file: null };
}

// One row per top-level font dictionary: { name, family, type, subtype, embedded, subset }.
// family is the name without the six-letter subset tag ("ABCDEF+Charis-Bold" -> "Charis-Bold").
export async function pdfFonts(src) {
  const doc = await PDFDocument.load(bytesOf(src), { updateMetadata: false });
  const ctx = doc.context;
  const look = (v) => (v instanceof PDFRef ? ctx.lookup(v) : v);
  const rows = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || nameOf(obj.get(PDFName.of('Type'))) !== 'Font') continue;
    const subtype = nameOf(obj.get(PDFName.of('Subtype')));
    if (subtype === 'CIDFontType0' || subtype === 'CIDFontType2') continue; // reached through its Type0 parent
    const name = nameOf(look(obj.get(PDFName.of('BaseFont')))) || nameOf(look(obj.get(PDFName.of('Name')))) || null;
    let type = subtype;
    let file = { embedded: subtype === 'Type3', file: null };
    if (subtype === 'Type0') {
      const kids = look(obj.get(PDFName.of('DescendantFonts')));
      const kid = kids instanceof PDFArray ? look(kids.get(0)) : null;
      const kidType = nameOf(kid?.get(PDFName.of('Subtype')));
      file = fontFileKind(ctx, look(kid?.get(PDFName.of('FontDescriptor'))));
      type = kidType === 'CIDFontType2' ? 'CID TrueType' : file.sub === 'OpenType' ? 'CID Type 0C (OT)' : 'CID Type 0C';
    } else if (subtype === 'Type3') {
      type = 'Type 3';
    } else if (subtype === 'TrueType') {
      file = fontFileKind(ctx, look(obj.get(PDFName.of('FontDescriptor'))));
      type = 'TrueType';
    } else if (subtype === 'Type1' || subtype === 'MMType1') {
      file = fontFileKind(ctx, look(obj.get(PDFName.of('FontDescriptor'))));
      type = file.file === 'FontFile3' ? 'Type 1C' : 'Type 1';
    }
    rows.push({ name, family: name ? name.replace(/^[A-Z]{6}\+/, '') : null, type, subtype, embedded: file.embedded, subset: !!name && /^[A-Z]{6}\+/.test(name) });
  }
  return rows;
}

// The build's font gate: every font named and embedded, none Type 3.
export function fontProblems(fonts) {
  const out = [];
  if (fonts.some((f) => f.type === 'Type 3')) out.push('Type 3 font embedded');
  for (const f of fonts) {
    if (f.type === 'Type 3') continue;
    if (!f.name) out.push(`unnamed ${f.type} font`);
    else if (!f.embedded) out.push(`font ${f.family} not embedded`);
  }
  return out;
}

// ---------- text ----------
let pdfjsMod = null;
async function pdfjs() {
  pdfjsMod ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsMod;
}

// Items (pdfjs getTextContent) -> lines [{ text, y, size, footer }], y the baseline in points
// from the bottom edge. Body lines keep stream order; footer lines (baseline under footerBandPt)
// follow, top to bottom. Exported for tests.
export function lineItems(items, { footerBandPt = 0 } = {}) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const [a, b, , , x, y] = it.transform;
    const size = Math.hypot(a, b) || 10;
    if (!it.str.trim()) {
      if (cur && it.str.length) cur.pendingSpace = true;
      continue;
    }
    const newLine = !cur || Math.abs(y - cur.y) > Math.max(1.5, size * 0.3) || x < cur.endX - size * 0.5;
    if (newLine) {
      cur = { y, size, text: it.str, endX: x + it.width, pendingSpace: false };
      lines.push(cur);
    } else {
      const gap = x - cur.endX;
      if ((cur.pendingSpace || gap > size * 0.12) && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
      cur.text += it.str;
      cur.endX = x + it.width;
      cur.size = Math.max(cur.size, size);
      cur.pendingSpace = false;
    }
  }
  const rows = lines.map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), y: Math.round(l.y * 100) / 100, size: Math.round(l.size * 100) / 100, footer: !!footerBandPt && l.y < footerBandPt }))
    .filter((l) => l.text);
  return [...rows.filter((l) => !l.footer), ...rows.filter((l) => l.footer).sort((p, q) => q.y - p.y)];
}

export const linesOf = (items, opts) => lineItems(items, opts).map((l) => l.text).join('\n');

// Lines of every page (index 0 is page 1), as lineItems returns them.
export async function pageLines(src, { footerBandPt = 0 } = {}) {
  const { getDocument } = await pdfjs();
  const data = new Uint8Array(bytesOf(src)); // a copy: pdfjs detaches the buffer it is given
  const task = getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      out.push(lineItems(tc.items, { footerBandPt }));
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}

// Text of every page, index 0 is page 1. footerBandPt: baselines below this height (points from
// the bottom edge) are the footer and come last on their page.
export async function pageTexts(src, opts) {
  return (await pageLines(src, opts)).map((ls) => ls.map((l) => l.text).join('\n'));
}

export const pdfText = async (src, opts) => (await pageTexts(src, opts)).join('\n');

// ---------- Chromium ----------
export class ChromiumMissingError extends Error {
  constructor(detail) {
    super(`no Chromium binary found${detail ? ` (${detail})` : ''}: run npm run setup`);
    this.chromiumMissing = true;
  }
}

const newerFirst = (p, q) => {
  const a = p.split('.').map(Number);
  const b = q.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((b[i] || 0) !== (a[i] || 0)) return (b[i] || 0) - (a[i] || 0);
  return 0;
};

// The binary that renders documents. CHROME_PATH overrides; then CLOAKBROWSER_BINARY_PATH; then
// the CloakBrowser build pinned by CLOAKBROWSER_VERSION, else the newest one installed in
// CLOAKBROWSER_CACHE_DIR (set to <repo>/.cache/cloakbrowser by env.mjs). Never a system browser.
// cloakbrowser's binaryInfo() reads the cache dir from process.env, so env here only selects.
export async function chromiumPath({ env = process.env } = {}) {
  for (const k of ['CHROME_PATH', 'CLOAKBROWSER_BINARY_PATH']) {
    if (!env[k]) continue;
    if (!existsSync(env[k])) throw new ChromiumMissingError(`${k} points at a missing file`);
    return env[k];
  }
  let cloak;
  try {
    cloak = await import('cloakbrowser');
  } catch (err) {
    throw new ChromiumMissingError(`cloakbrowser package not installed: ${err.message}`);
  }
  const tried = [];
  const pinned = env.CLOAKBROWSER_VERSION;
  if (pinned) {
    const info = cloak.binaryInfo(pinned);
    if (info.installed) return info.binaryPath;
    tried.push(pinned);
  }
  const cacheDir = env.CLOAKBROWSER_CACHE_DIR;
  const versions = cacheDir && existsSync(cacheDir)
    ? readdirSync(cacheDir).map((d) => /^chromium-(\d+(?:\.\d+){3,4})$/.exec(d)?.[1]).filter(Boolean).sort(newerFirst)
    : [];
  for (const v of versions) {
    const info = cloak.binaryInfo(v);
    if (info.installed) return info.binaryPath;
    tried.push(v);
  }
  if (!cacheDir) throw new ChromiumMissingError('CLOAKBROWSER_CACHE_DIR unset');
  const info = cloak.binaryInfo();
  if (info.installed) return info.binaryPath;
  throw new ChromiumMissingError(`nothing installed in the CloakBrowser cache${tried.length ? `, tried ${tried.join(', ')}` : ''}`);
}

// A headless Chromium for rendering local files, network blocked by the caller per page.
export async function launchChromium({ env = process.env } = {}) {
  const executablePath = await chromiumPath({ env });
  const { chromium } = await import('playwright-core');
  return chromium.launch({ executablePath, headless: true });
}
