#!/usr/bin/env node
// Publish each CV's rendered HTML to its own private bikeshed document, in the hunt's private
// folder, never the bikeshed root. Doc ids live in config/cv-bikeshed.json (workspace; not
// secret); versions and hashes in <data>/cv-bikeshed/state.json. Unchanged HTML is skipped before
// any call; open comments stop that CV's update, since they would stay behind on the old version.
// With config/tracker.json publisher "local", nothing is published (exit 0, published: false).
//
// Usage (after npm run cv -- --all):
//   npm run cv-publish                        # every variant
//   npm run cv-publish -- --variant <slug>    # one variant
//   npm run cv-publish -- --dir <list>/cv     # a recruiter list's targeted CVs (build-cv --dir), into the
//     bikeshed folder named in <list>/bikeshed.json, which also keeps their doc ids. Without a folder_id it refuses
//
// Exit codes: 0 all published or unchanged, 1 a CV was refused (no rendered HTML, private
// data, open comments, bikeshed refused), 2 not signed in to bikeshed (the user signs in; see
// docs/setup.md).

import './lib/env.mjs';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CV_OUT, CV_SRC, DATA_DIR, display, resolveArgPath } from './lib/paths.mjs';
import { loadConfig, saveConfig } from './lib/config.mjs';
import { applicationEmail, cvFileBase, cvPhone, person } from './lib/profile.mjs';
import { wantsPhone, withoutPhone } from './lib/cv.mjs';
import { bikeshedRun } from './lib/adapters/bikeshed.mjs';
import { logAction } from './lib/actions-log.mjs';

const args = process.argv.slice(2);
const only = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : null;
const listDir = args.includes('--dir') ? resolveArgPath(args[args.indexOf('--dir') + 1]) : null;
const list = listDir ? basename(dirname(listDir)) : null;

const OUT = list ? join(CV_OUT, list) : CV_OUT;
const LIST_CFG = list ? join(dirname(listDir), 'bikeshed.json') : null;
const ST_DIR = join(DATA_DIR, 'cv-bikeshed');
const ST_PATH = join(ST_DIR, list ? `${list}.json` : 'state.json');
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const finish = (o, code) => { console.log(JSON.stringify(o)); process.exit(code); };

const SRC = listDir || join(CV_SRC, 'variants');
const variants = (existsSync(SRC) ? readdirSync(SRC) : []).filter((f) => f.endsWith('.json')).sort()
  .map((f) => readJson(join(SRC, f)))
  .filter((v) => !only || v.slug === only);
if (!variants.length) { console.error(`no variant ${only || `in ${display(SRC)}`}`); process.exit(1); }

const tracker = loadConfig('tracker.json', { required: false });
if ((tracker.publisher || 'bikeshed') === 'local') {
  console.error('publisher is local (config/tracker.json): nothing published');
  finish({ success: true, published: false, reason: 'publisher local', results: [] }, 0);
}

// The newest dated render of a variant: CV_OUT/<YYYYMMDD>/<prefix>-cv-<slug>.html
function latestHtml(slug) {
  const name = `${cvFileBase(slug)}.html`;
  const days = (existsSync(OUT) ? readdirSync(OUT) : []).filter((d) => /^\d{8}$/.test(d)).sort().reverse();
  const day = days.find((d) => existsSync(join(OUT, d, name)));
  return day ? join(OUT, day, name) : null;
}

// The CV carries one address (the application email) and no phone; anything else means the
// wrong data got in. A CV that shows the phone (wantsPhone) may carry that one number only.
function privacyViolations(html, allow = applicationEmail()) {
  const bad = [];
  for (const e of new Set(html.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])) if (e.toLowerCase() !== allow) bad.push(`email ${e}`);
  if (/\(?\b\d{3}\)?[ .-]?\d{3}[ .-]\d{4}\b/.test(html.replace(/<style>[\s\S]*?<\/style>/g, ''))) bad.push('phone number');
  return bad;
}

const { publishTracker } = await import('./lib/tracker.mjs');
const cfg = list ? readJson(LIST_CFG, { docs: {} }) : loadConfig('cv-bikeshed.json', { required: false });
cfg.docs ||= {};
// A list's CVs go only to the folder its bikeshed.json names; the tracker's folder is the fallback for the standard CVs alone.
if (!list) cfg.folder_id ||= tracker.bikeshed?.folder_id || tracker.folder_id || null;
const st = readJson(ST_PATH, {});
const name = person().name || 'CV';
const results = [];
let worst = 0;

for (const v of variants) {
  const file = latestHtml(v.slug);
  if (!file) { results.push({ slug: v.slug, status: 'no-render' }); worst = Math.max(worst, 1); continue; }
  const html = readFileSync(file, 'utf8');
  const bad = privacyViolations(withoutPhone(html, wantsPhone(v, person().show_phone_on_cv) ? cvPhone() : null));
  if (bad.length) { results.push({ slug: v.slug, status: 'refused-privacy', bad }); worst = Math.max(worst, 1); continue; }
  const title = `${name} CV · ${v.share}`;
  const r = await publishTracker({ html, file, cfg: { folder_id: cfg.folder_id, ...(cfg.docs[v.slug] || {}) }, st: st[v.slug] || {}, run: bikeshedRun, title });
  if (r.cfg.doc_id) cfg.docs[v.slug] = { doc_id: r.cfg.doc_id, url: r.cfg.url || cfg.docs[v.slug]?.url };
  st[v.slug] = r.st;
  results.push({ slug: v.slug, status: r.status, url: cfg.docs[v.slug]?.url, file: display(file), ...(r.message ? { message: r.message } : {}), ...(r.threads ? { open_comments: r.threads.length } : {}) });
  if (r.status === 'created' || r.status === 'updated') logAction({ actor: 'script', action: 'cv.published', source: 'publish-cvs', ref: v.slug, detail: { status: r.status, ...(list ? { list } : {}) } });
  console.error(`${r.status.padEnd(10)} ${v.slug.padEnd(24)} ${cfg.docs[v.slug]?.url || ''}${r.message ? ` (${r.message})` : ''}`);
  if (r.status === 'auth') { worst = 2; break; }
  if (!['created', 'updated', 'unchanged'].includes(r.status)) worst = Math.max(worst, 1);
}

const saved = { _comment: cfg._comment || 'Private bikeshed documents holding each CV render (npm run cv-publish). Ids are not secrets, but they are the user\'s: workspace only.', folder_id: cfg.folder_id ?? null, docs: cfg.docs };
if (list) writeFileSync(LIST_CFG, `${JSON.stringify(saved, null, 2)}\n`);
else saveConfig('cv-bikeshed.json', saved);
mkdirSync(ST_DIR, { recursive: true });
writeFileSync(ST_PATH, JSON.stringify(st, null, 2));
finish({ success: worst === 0, results }, worst);
