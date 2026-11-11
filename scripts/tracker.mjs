#!/usr/bin/env node
// Applications tracker: renders the dashboard from the hunt state and publishes it through the
// tracker publisher (config/tracker.json publisher: bikeshed, one private document updated in
// place; or local, data/tracker/tracker.html only). Run by /hunt-loop on every firing; safe to
// run any time (unchanged HTML is a no-op).
//
// Usage:
//   node scripts/tracker.mjs --dry-run [--next-check "YYYY-MM-DD HH:MM"]   # write data/tracker/tracker.html only
//   node scripts/tracker.mjs --publish [--next-check "YYYY-MM-DD HH:MM"]   # render, then create or update the document
//   (local time in preferences.schedule.tz; a bare HH:MM means today)
//
// Exit codes: 0 published, updated, unchanged, or written locally (publisher local:
// published false); 1 error or privacy guard; 2 not signed in to bikeshed (the user runs
// `npm run bikeshed -- login`); 3 update refused (doc open in the editor, pending suggestion, base
// moved): retry next tick; 4 open comments on the doc: the loop acts on them, replies,
// resolves, then runs this again.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, out } from './cloak-core.mjs';
import { STATE_PATH, loadState } from './lib/state.mjs';
import { COLLATERAL_DIR, CV_SRC, DATA_DIR, PIPELINE_DIR, display } from './lib/paths.mjs';
import { loadConfig, loadOwnConfig, saveConfig } from './lib/config.mjs';
import { answers, applicationEmail, person } from './lib/profile.mjs';
import { logAction, readActions } from './lib/actions-log.mjs';
import { getUsageSummary } from './rate-limiter.mjs';
import { parseThread } from './lib/mail.mjs';
import { buildTracker, renderTrackerHtml, parseFrontmatter, runLabels, runLabel } from './lib/tracker.mjs';
import { trackerPublisher, loadReviewDocs, trackerDir } from './lib/adapters/publish.mjs';
import { publishLetters, loadLetters, letterUrls } from './lib/letters.mjs';

const TDIR = trackerDir();
const HTML_PATH = join(TDIR, 'tracker.html');
const ST_PATH = join(TDIR, 'state.json');
const readJson = (p, dflt) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt);
const mdFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md') : []);
const log = (s) => process.stderr.write(`${s}\n`);
const { flags } = parseArgs(process.argv.slice(2));

// Run labels come from the query ids, or a query's own `label` (searches.json, dice-searches.json).
const LABELS = runLabels(['searches.json', 'dice-searches.json'].map((n) => loadConfig(n, { required: false })));

function loadRuns() {
  const dir = join(DATA_DIR, 'raw');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /-(tick|sweep)\.json$/.test(f)).map((f) => {
    const s = readJson(join(dir, f), {});
    const tick = f.endsWith('-tick.json');
    const dice = s.source === 'dice';
    // Dice sweeps are written as <stamp>-dice-sweep.json with a dice-sweep-<iso> tick_id.
    const at = String(s.tick_id || '').replace(/^(dice-)?(tick|sweep)-/, '') || s.sweep_id;
    const label = tick || dice ? `${dice ? 'Dice: ' : ''}${runLabel(LABELS, s.pick?.id)}` : 'Full sweep';
    const cards = Array.isArray(s.per_query) ? s.per_query.reduce((n, q) => n + (q.ids || 0), 0) : null;
    return { kind: tick ? 'tick' : 'sweep', source: dice ? 'dice' : 'linkedin', at, label, cards, summary: s.summary || {}, aborted: s.aborted || null };
  }).filter((r) => r.at);
}

const loadOpportunities = () => {
  const dir = join(PIPELINE_DIR, 'opportunities');
  return mdFiles(dir).map((f) => parseFrontmatter(readFileSync(join(dir, f), 'utf8'))).filter((o) => o.job_id);
};

// Open hunt-mail threads become Needs-you cards (docs/inbox-scan-design.md).
const loadMail = () => {
  const dir = join(PIPELINE_DIR, 'mail');
  return mdFiles(dir).map((f) => ({ ...parseThread(readFileSync(join(dir, f), 'utf8')), file: f })).filter((t) => t.thread_id);
};

function loadClaims() {
  const p = join(COLLATERAL_DIR, 'claim-bank.md');
  if (!existsSync(p)) return {};
  return Object.fromEntries([...readFileSync(p, 'utf8').matchAll(/^\|\s*(C\d+)\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => [m[1], m[2]]));
}

// Each CV's private bikeshed render (npm run cv-publish), so every CV reference is a link.
function loadVariants() {
  const dir = join(CV_SRC, 'variants');
  const docs = loadConfig('cv-bikeshed.json', { required: false }).docs || {};
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f))).map((v) => ({ slug: v.slug, share: v.share, url: docs[v.slug]?.url || null }));
}

function loadOverrides() {
  const p = process.env.JOBBA_LIMITS_LOG || join(DATA_DIR, 'state', 'limits-log.json');
  return readJson(p, []).filter((e) => e.cap_override).map((e) => ({ at: e.timestamp, cap: e.actionType, reason: e.cap_override }));
}

// Defence in depth on the real page (the model never reads private data): no email but the
// application address, no phone from the profile or the answer bank, no annual standing rate,
// no street address. Fonts and CSS excluded.
function privacyViolations(html) {
  const text = html.replace(/<style>[\s\S]*?<\/style>/, '');
  const bad = [];
  const allowed = applicationEmail();
  for (const e of new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])) if (e.toLowerCase() !== allowed) bad.push(`email ${e}`);
  const bank = answers();
  const me = person();
  for (const raw of new Set([bank.profile?.phone, me.phone].filter(Boolean).map(String))) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 7 && (text.includes(raw) || text.includes(digits))) { bad.push('phone number'); break; }
  }
  const annual = String(bank.facts?.rate_annual || '').replace(/\D/g, '');
  if (annual.length >= 5 && text.includes(annual)) bad.push('standing annual rate');
  const street = String(bank.profile?.street_address || '').trim();
  if (street.length >= 6 && text.toLowerCase().includes(street.toLowerCase())) bad.push('street address');
  return bad;
}

const cfg = loadConfig('tracker.json');
const publisher = trackerPublisher({ cfg });
const bs = publisher.cfg;
const state = loadState(STATE_PATH);

// Sent cover letters go to their own private docs first, so the cards can link them.
let letterSt = loadLetters();
if (flags.publish && publisher.kind === 'bikeshed' && bs.folder_id) letterSt = (await publishLetters({ state, folderId: bs.letters_folder_id || bs.folder_id, run: publisher.run, log })).st;

const model = buildTracker({
  state, opportunities: loadOpportunities(), usage: getUsageSummary(), runs: loadRuns(), claims: loadClaims(),
  variants: loadVariants(), overrides: loadOverrides(), letters: letterUrls(letterSt), mail: loadMail(), actions: readActions({ limit: 50 }),
  reviews: loadReviewDocs(), nextCheck: typeof flags['next-check'] === 'string' ? flags['next-check'] : null,
});
const html = renderTrackerHtml(model, { title: cfg.title });
mkdirSync(TDIR, { recursive: true });
writeFileSync(HTML_PATH, html);
const brief = { applied: model.status.applied_total, needs: model.status.needs_you, not_a_fit: model.not_a_fit.length, as_of: model.as_of, bytes: html.length };

const bad = privacyViolations(html);
if (bad.length) {
  log(`REFUSED: private data in the rendered page: ${bad.join(', ')}. Nothing published.`);
  out({ success: false, privacy: bad, file: display(HTML_PATH) });
  process.exit(1);
}
if (!flags.publish) {
  log(`tracker -> ${display(HTML_PATH)} (${Math.round(html.length / 1024)} KB)`);
  out({ success: true, dry_run: true, file: display(HTML_PATH), ...brief });
  process.exit(0);
}

if (publisher.kind === 'local') {
  const r = await publisher.publish({ html });
  log(`tracker: publisher local, not published; the page is ${display(r.path)}`);
  out({ success: true, status: 'local', published: false, path: display(r.path), url: null, threads: [], ...brief });
  process.exit(0);
}

const r = await publisher.publish({ html, file: HTML_PATH, st: readJson(ST_PATH, {}), title: cfg.title });
// A new document's id and url go into the workspace file only (never the template defaults).
if (r.cfg.doc_id !== bs.doc_id || r.cfg.url !== bs.url) {
  const own = loadOwnConfig('tracker.json', {});
  saveConfig('tracker.json', { ...own, bikeshed: { ...(own.bikeshed || {}), doc_id: r.cfg.doc_id, url: r.cfg.url } });
}
writeFileSync(ST_PATH, JSON.stringify(r.st, null, 2));
if (['created', 'updated'].includes(r.status)) logAction({ actor: 'script', action: `tracker.${r.status}`, source: 'tracker', ref: r.url || r.cfg.url || null, detail: `${brief.applied} applied, ${brief.needs} waiting` });
const CODE = { created: 0, updated: 0, unchanged: 0, 'no-folder': 1, error: 1, auth: 2, refused: 3, comments: 4 };
const threads = (r.threads || []).map((t) => ({ threadId: t.threadId, section: t.section ?? null, quote: t.quote ?? null, comments: (t.comments || []).map((c) => ({ author: c.author?.name ?? c.author ?? null, body: c.body ?? c.text ?? '' })) }));
log(`tracker: ${r.status}${r.url ? ` ${r.url}` : ''}${r.message ? ` (${r.message})` : ''}${threads.length ? ` | ${threads.length} open comment(s)` : ''}`);
out({ success: CODE[r.status] === 0, status: r.status, published: CODE[r.status] === 0, url: r.url || r.cfg.url || null, version: r.st.version ?? null, threads, message: r.message ?? null, threadsLeftBehind: r.threadsLeftBehind ?? 0, ...brief });
process.exit(CODE[r.status] ?? 1);
