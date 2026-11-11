// Cover letters sent with an application get their own private bikeshed document, like the
// CVs, so the tracker can link each sent letter from its card. A letter is published once it
// went out (a submit, or a hand-off the user finished by hand); unchanged HTML is a no-op.
// Doc ids and versions live in <data>/letters-bikeshed/state.json (company names: workspace only).
// With config/tracker.json publisher "local", nothing is published.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { CODE_ROOT, DATA_DIR, HOME } from './paths.mjs';
import { loadConfig } from './config.mjs';
import { applicationEmail } from './profile.mjs';
import { bikeshedRun } from './adapters/bikeshed.mjs';
import { logAction } from './actions-log.mjs';

export const LETTERS_ST = join(DATA_DIR, 'letters-bikeshed', 'state.json');
const SENT = new Set(['submitted', 'submitted-by-hand']);

export const loadLetters = (path = LETTERS_ST) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
// job id -> the letter's bikeshed URL, for the tracker.
export const letterUrls = (st) => Object.fromEntries(Object.entries(st).filter(([, v]) => v?.cfg?.url).map(([id, v]) => [id, v.cfg.url]));

// A stored document path: absolute; "$JOBBA_HOME/..." or "$JOBBA_DATA_DIR/..." (paths.mjs display);
// else repo-relative, falling back to workspace-relative.
export function docPath(p, { repo = CODE_ROOT, home = HOME, data = DATA_DIR } = {}) {
  const s = String(p);
  if (isAbsolute(s)) return s;
  if (s.startsWith('$JOBBA_HOME/')) return join(home, s.slice('$JOBBA_HOME/'.length));
  if (s.startsWith('$JOBBA_DATA_DIR/')) return join(data, s.slice('$JOBBA_DATA_DIR/'.length));
  const fromRepo = resolve(repo, s);
  if (existsSync(fromRepo) || existsSync(fromRepo.replace(/\.pdf$/, '.html'))) return fromRepo;
  const fromHome = resolve(home, s);
  return existsSync(fromHome) || existsSync(fromHome.replace(/\.pdf$/, '.html')) ? fromHome : fromRepo;
}

// The letter's HTML render sits next to its PDF (scripts/build-cover.mjs).
export function sentLetters(state, opts = {}) {
  return Object.values(state.jobs || {}).flatMap((j) => {
    const app = j.application;
    const pdf = app?.cover_pdf;
    // A posting that closed before the submit never got its letter, hand-off or not.
    if (!pdf || app.status === 'closed') return [];
    const handOff = (app.attempts || []).at(-1)?.outcome === 'manual';
    if (!SENT.has(app.status) && !handOff) return [];
    const html = docPath(pdf, opts).replace(/\.pdf$/, '.html');
    return [{ id: j.job_id, company: j.company, title: j.title, html }];
  });
}

// The letter carries one address (the application email) and no phone; anything else means the
// wrong data got in.
export function letterPrivacy(html, allow = [applicationEmail()]) {
  const ok = new Set(allow.map((e) => String(e || '').toLowerCase()).filter(Boolean));
  const bad = [];
  for (const e of new Set(html.match(/[\w.+-]+@[\w-]+\.[a-z][\w.-]*/gi) || [])) if (!ok.has(e.toLowerCase())) bad.push(`email ${e}`);
  if (/\(?\b\d{3}\)?[ .-]?\d{3}[ .-]\d{4}\b/.test(html.replace(/<style>[\s\S]*?<\/style>/g, ''))) bad.push('phone number');
  return bad;
}

const isLocal = () => {
  try { return loadConfig('tracker.json', { required: false }).publisher === 'local'; } catch { return false; }
};

// run: the bikeshed runner (adapters/bikeshed.mjs bikeshedRun; tests inject a fake).
export async function publishLetters({ state, folderId, run = bikeshedRun, path = LETTERS_ST, repo = CODE_ROOT, local = isLocal(), log = () => {} }) {
  const st = loadLetters(path);
  if (local) return { st, results: [], published: false, reason: 'publisher local' };
  const { publishTracker } = await import('./tracker.mjs');
  const allow = [applicationEmail()];
  const results = [];
  for (const l of sentLetters(state, { repo })) {
    if (!existsSync(l.html)) { results.push({ id: l.id, status: 'no-render' }); continue; }
    const html = readFileSync(l.html, 'utf8');
    const bad = letterPrivacy(html, allow);
    if (bad.length) { results.push({ id: l.id, status: 'refused-privacy', bad }); continue; }
    const prev = st[l.id] || {};
    const r = await publishTracker({ html, file: l.html, cfg: { folder_id: folderId, ...(prev.cfg || {}) }, st: prev.st || {}, run, title: `Cover letter · ${l.company} · ${l.title}` });
    st[l.id] = { cfg: { doc_id: r.cfg.doc_id || prev.cfg?.doc_id, url: r.cfg.url || prev.cfg?.url }, st: r.st };
    results.push({ id: l.id, status: r.status, url: st[l.id].cfg.url || null });
    if (r.status === 'created' || r.status === 'updated') logAction({ actor: 'script', action: 'letter.published', source: 'tracker', job_id: l.id, detail: { status: r.status } });
    if (!['unchanged'].includes(r.status)) log(`letter ${r.status.padEnd(9)} ${l.company} ${st[l.id].cfg.url || ''}`);
    if (r.status === 'auth') break;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(st, null, 2));
  return { st, results, published: true };
}
