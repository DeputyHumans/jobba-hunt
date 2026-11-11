#!/usr/bin/env node
// Render a recruiter list's two pages from pipeline/recruiter/<list>/roles.json, the index and the role
// analysis, and with --publish update their private bikeshed documents in the list's subfolder
// (bikeshed.json: folder_id, docs.index, docs.analysis). Never the bikeshed root.
// CV links on the index: the 7-day share links in <data>/cv-bikeshed/<list>-share-links.json while open,
// else the member links in bikeshed.json. The renders hold share links, so they live in <data>/recruiter.
// Brand: neutral. Wordmark preferences.brand.wordmark (else the display name), accent
// preferences.brand.accent, a mark only when the workspace brand folder holds mark.json. Fit-score
// weights from preferences.recruiter_weights, tiers from preferences.tiers.
//
//   npm run recruiter-pages -- --dir pipeline/recruiter/<list> [--publish]
//
// With config/tracker.json publisher "local", --publish writes the pages and skips bikeshed
// (published: false).
// Exit: 0 written (and published), 1 refused (role check, guard, missing CV link, no folder) or bikeshed failed.

import './lib/env.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { renderIndexHtml, renderAnalysisHtml, pageViolations, checkRoles, resolveLinks, dimsFrom } from './lib/recruiter-pages.mjs';
import { DATA_DIR, brandFile, display, resolveArgPath } from './lib/paths.mjs';
import { loadConfig } from './lib/config.mjs';
import { applicationEmail, person, preferences, tiers, tz } from './lib/profile.mjs';
import { bikeshedRunSync, parseJsonOut } from './lib/adapters/bikeshed.mjs';
import { logAction } from './lib/actions-log.mjs';

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const out = (o, code) => { console.log(JSON.stringify(o)); process.exit(code); };

const args = process.argv.slice(2);
const arg = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
let listDir = arg('--dir') ? resolveArgPath(arg('--dir')) : null;
if (!listDir) out({ success: false, error: 'usage: recruiter-pages.mjs --dir pipeline/recruiter/<list> [--publish]' }, 1);
if (basename(listDir) === 'cv') listDir = dirname(listDir);
const list = basename(listDir);

const page = readJson(join(listDir, 'roles.json'), null);
if (!page) out({ success: false, error: `no roles.json in ${display(listDir)}` }, 1);
const prefs = preferences();
const dims = dimsFrom(prefs.recruiter_weights);
const roleErrs = checkRoles(page.roles, dims);
if (roleErrs.length) out({ success: false, refused: roleErrs }, 1);
const cfgPath = join(listDir, 'bikeshed.json');
const cfg = readJson(cfgPath, { docs: {} });
cfg.docs ||= {};
const share = readJson(join(DATA_DIR, 'cv-bikeshed', `${list}-share-links.json`), null);
const links = resolveLinks(page.roles, { docs: cfg.docs, share });

const roles = page.roles.map((r) => {
  const v = readJson(join(listDir, 'cv', `${r.cv}.json`), {});
  return { ...r, cvUrl: links.cvUrls[r.cv], cvTitle: v.target_title || r.cv };
});
const missing = roles.filter((r) => !r.cvUrl).map((r) => r.cv);
if (missing.length) out({ success: false, error: `no CV link for ${missing.join(', ')}` }, 1);

const b64 = (f) => readFileSync(brandFile('fonts', f)).toString('base64');
const markPath = brandFile('mark.json');
const assets = {
  css: readFileSync(brandFile('recruiter-pages.css'), 'utf8'),
  mark: existsSync(markPath) ? readJson(markPath) : null,
  wordmark: prefs.brand?.wordmark || person().display_name || person().name || '',
  accent: prefs.brand?.accent || null,
  tiers: tiers(),
  zone: tz(),
  dims,
  fontsCss: `@font-face{font-family:'Instrument Sans Variable';src:url(data:font/woff2;base64,${b64('instrument-sans-latin-wght-normal.woff2')}) format('woff2');font-weight:400 700;font-style:normal;font-display:swap}`
    + `@font-face{font-family:'Geist Mono Variable';src:url(data:font/woff2;base64,${b64('geist-mono-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900;font-style:normal;font-display:swap}`,
};
const pages = {
  index: renderIndexHtml(page, roles, { ...assets, linksUntil: links.until, analysisUrl: links.analysisUrl }),
  analysis: renderAnalysisHtml(page, roles, { ...assets, indexUrl: links.indexUrl }),
};

const allow = [applicationEmail()];
const refused = Object.entries(pages).flatMap(([k, html]) => pageViolations(html, page.never_show || [], allow).map((b) => `${k}: ${b}`));
if (refused.length) out({ success: false, refused }, 1);
const dir = join(DATA_DIR, 'recruiter');
mkdirSync(dir, { recursive: true });
const files = Object.fromEntries(Object.entries(pages).map(([k, html]) => {
  const file = join(dir, `${list}-${k}.html`);
  writeFileSync(file, html);
  return [k, file];
}));
const base = { files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, display(f)])), share_links: !!links.until, analysis_link: links.analysisUrl?.includes('?k=') ? 'share' : 'member', roles: roles.length };
if (!args.includes('--publish')) out({ success: true, ...base }, 0);

const publisher = loadConfig('tracker.json', { required: false }).publisher || 'bikeshed';
if (publisher === 'local') {
  console.error('publisher is local (config/tracker.json): pages written, nothing published');
  out({ success: true, ...base, published: false, reason: 'publisher local' }, 0);
}
if (!cfg.folder_id) out({ success: false, ...base, error: `no folder_id in ${display(cfgPath)}` }, 1);
const titles = { index: `Roles to consider · ${page.date}`, analysis: `Role analysis · ${page.date}` };
const ids = { index: `${page.date}-roles-to-consider`, analysis: `${page.date}-role-analysis` };
const published = {};
for (const [k, file] of Object.entries(files)) {
  const doc = cfg.docs[k];
  const r = doc
    ? bikeshedRunSync(['update', doc.doc_id, file])
    : bikeshedRunSync(['publish', file, '--id', ids[k], '--title', titles[k], '--folder', cfg.folder_id, '--json']);
  if (r.code !== 0) out({ success: false, ...base, published, error: `${k}: ${(r.stderr || r.stdout).trim().split('\n').pop()}` }, 1);
  if (!doc) {
    const j = parseJsonOut(r.stdout) || {};
    cfg.docs[k] = { doc_id: j.id || j.docId || j.doc_id || String(j.url || '').split('/d/')[1], url: j.url };
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  }
  published[k] = { url: cfg.docs[k].url, result: (r.stdout || '').trim().split('\n').pop() };
}
logAction({ actor: 'script', action: 'recruiter.pages.published', source: 'recruiter-pages', ref: list, detail: { roles: roles.length, pages: Object.keys(published).length } });
out({ success: true, ...base, published }, 0);
