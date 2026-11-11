// Sweep state: <data>/state/jobs.json keyed by job ID (LinkedIn's numeric ID, or dice-<guid>).
// Cross-run dedup lives here, not only within one sweep. Writes are atomic: temp file, then
// rename, so a crash mid-write never leaves a truncated state file.

import './env.mjs';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './paths.mjs';
import { loadConfig } from './config.mjs';

export { DATA_DIR };
export const STATE_PATH = join(DATA_DIR, 'state', 'jobs.json');
const DEFAULT_REPOST_WINDOW_DAYS = 30;

// prefilter.json repost_window_days: a new ID with the same company and title seen within this
// many days is marked a repost of the earlier one.
export function repostWindowDays() {
  try {
    const n = Number(loadConfig('prefilter.json', { required: false }).repost_window_days);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_REPOST_WINDOW_DAYS;
  } catch {
    return DEFAULT_REPOST_WINDOW_DAYS;
  }
}

// Schema 2 adds the loop-tick fields: per-query window starts, the canary rotation counter,
// the guard streak that spans ticks, and the halt set by an abort.
const SCHEMA2_FIELDS = { query_runs: {}, ticks_since_canary: null, last_tick: null, suspect_streak: 0, halt_until: null, sources: {} };
// The top-level loop fields belong to LinkedIn. Every other source (Dice) keeps
// its own copy under state.sources.<name>, so one source's abort never halts the other.
const LOOP_FIELDS = { query_runs: {}, ticks_since_canary: null, last_tick: null, suspect_streak: 0, halt_until: null };

export function emptyState() {
  return { _schema: 2, last_successful_sweep: null, ...structuredClone(SCHEMA2_FIELDS), jobs: {} };
}

export function loadState(path = STATE_PATH) {
  if (!existsSync(path)) return emptyState();
  const s = JSON.parse(readFileSync(path, 'utf8'));
  if (s._schema === 1) return { ...structuredClone(SCHEMA2_FIELDS), ...s, _schema: 2 };
  if (s._schema !== 2) throw new Error(`unsupported state schema ${s._schema} in ${path}`);
  s.sources = s.sources || {};
  return s;
}

export function sourceState(state, name) {
  state.sources = state.sources || {};
  if (!state.sources[name]) state.sources[name] = structuredClone(LOOP_FIELDS);
  return state.sources[name];
}

export const sourceOf = (j) => j?.source || 'linkedin';

// An apply run loads the state at start and saves at the end, minutes later. Saving its own copy
// would wipe triage recorded meanwhile (a dry run once did). So the run re-reads the file and
// carries over only what it owns: CV uploads, and a halt it set itself (`loaded` holds the halts as
// they were at load). The job's attempt is then recorded on the fresh copy by the caller.
export function carryRun(fresh, run, loaded) {
  fresh.cv_uploads = { ...(fresh.cv_uploads || {}), ...(run.cv_uploads || {}) };
  if ((run.halt_until ?? null) !== (loaded.halt_until ?? null)) fresh.halt_until = run.halt_until;
  const dice = run.sources?.dice?.halt_until ?? null;
  if (dice !== (loaded.dice_halt_until ?? null)) sourceState(fresh, 'dice').halt_until = dice;
  return fresh;
}

export function saveStateAtomic(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

const SUFFIX_RE = /\b(inc|llc|ltd|corp|corporation|co|gmbh|plc|limited)\b/g;
export function normalizeKey(company, title) {
  const n = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX_RE, ' ').replace(/\s+/g, ' ').trim();
  return `${n(company)}|${n(title)}`;
}

function findRepost(state, id, key, now, windowDays) {
  const cutoff = Date.parse(now) - windowDays * 864e5;
  for (const j of Object.values(state.jobs)) {
    if (j.job_id === id || !j.title || !j.company) continue;
    if (Date.parse(j.first_seen) < cutoff) continue;
    if (normalizeKey(j.company, j.title) === key) return j.repost_of || j.job_id;
  }
  return null;
}

const addUnique = (arr, v) => (arr.includes(v) ? arr : [...arr, v]);
// What a Dice card says before any view: the prefilter's G1 reads employment_type.
const diceCard = (c) => ({ employment_type: c.employment_type || null, pay_text: c.pay_text || null, easy_apply: !!c.easy_apply, snippet: c.snippet || null });

export function upsertCards(state, cards, { queryId, scope, sweepId, now, repostDays = repostWindowDays() }) {
  const newIds = [];
  const seenIds = [];
  for (const c of cards) {
    const ex = state.jobs[c.job_id];
    if (ex) {
      if (ex.last_sweep_id !== sweepId) { ex.seen_count += 1; ex.last_sweep_id = sweepId; }
      ex.last_seen = now;
      ex.matched_queries = addUnique(ex.matched_queries, queryId);
      ex.scopes = addUnique(ex.scopes, scope);
      for (const f of ['title', 'company', 'location', 'posted_text', 'applicants_text']) if (!ex[f] && c[f]) ex[f] = c[f];
      if (c.source === 'dice') ex.card = diceCard(c);
      if (!ex.repost_of && ex.seen_count === 1 && ex.title && ex.company) ex.repost_of = findRepost(state, ex.job_id, normalizeKey(ex.company, ex.title), now, repostDays);
      if (!seenIds.includes(c.job_id) && !newIds.includes(c.job_id)) seenIds.push(c.job_id);
      continue;
    }
    state.jobs[c.job_id] = {
      job_id: c.job_id,
      source: c.source || 'linkedin',
      url: c.url || `https://www.linkedin.com/jobs/view/${c.job_id}/`,
      title: c.title || null,
      company: c.company || null,
      location: c.location || null,
      posted_text: c.posted_text || null,
      applicants_text: c.applicants_text || null,
      first_seen: now,
      last_seen: now,
      seen_count: 1,
      last_sweep_id: sweepId,
      matched_queries: [queryId],
      scopes: [scope],
      repost_of: c.title && c.company ? findRepost(state, c.job_id, normalizeKey(c.company, c.title), now, repostDays) : null,
      prefilter: null,
      detail: null,
      status: 'new',
      triage: null,
      ...(c.source === 'dice' ? { card: diceCard(c) } : {}),
    };
    newIds.push(c.job_id);
  }
  return { newIds, seenIds };
}

// Prefilter is re-run every sweep for touched jobs, so a drop is reversible: a job a
// later query re-qualifies goes back to new.
export function setPrefilter(state, id, result) {
  const j = state.jobs[id];
  j.prefilter = result;
  if (result.verdict === 'drop' && j.status === 'new') j.status = 'dropped';
  else if (result.verdict !== 'drop' && j.status === 'dropped') j.status = j.detail ? 'viewed' : 'new';
}

export function touchedIds(state, sweepId) {
  return Object.values(state.jobs).filter((j) => j.last_sweep_id === sweepId).map((j) => j.job_id);
}

// The view page is the canonical record: its title and company replace the card's. A
// card that shifted by one line (title copy in the company slot) also put the company
// in the location slot; that location is dropped.
export function setDetail(state, id, detail) {
  const j = state.jobs[id];
  j.detail = detail;
  if (detail.company && j.location === detail.company) j.location = null;
  for (const f of ['title', 'company']) if (detail[f]) j[f] = detail[f];
  if (!j.location && detail.location) j.location = detail.location;
  if (j.status === 'new') j.status = 'viewed';
}

export function markSweepSuccess(state, now) {
  state.last_successful_sweep = now;
}

// Window start for one query: the time its last ok/empty search began.
export function markQueryRun(state, queryId, startedAt) {
  state.query_runs[queryId] = { last_ok: startedAt };
}

export function recordTick(state, { kind, id, at }) {
  state.ticks_since_canary = kind === 'canary' ? 0 : (state.ticks_since_canary ?? 0) + 1;
  state.last_tick = { kind, id, at };
}

// When a card's role was posted: LinkedIn's relative "N hours ago" (or "Reposted ...") against the
// time the card was last seen. No age shown: the time seen.
const AGE_MS = { minute: 60000, hour: 3600000, day: 86400000, week: 7 * 86400000, month: 30 * 86400000 };
export function postedAt(j) {
  const seen = Date.parse(j.last_seen || j.first_seen || 0) || 0;
  const m = /(\d+)\s*(minute|hour|day|week|month)s?\s+ago/i.exec(String(j.posted_text || ''));
  return m ? seen - Number(m[1]) * AGE_MS[m[2].toLowerCase()] : seen;
}

// Detail-view queue for one source: plausible (keep/review), not yet viewed, not a repost, not
// dropped. Newest posting first: postings close fast, and a scope-first order left roles waiting
// for days. The fractional scope breaks a tie.
export function viewCandidates(state, { limit, source = 'linkedin' }) {
  return Object.values(state.jobs)
    .filter((j) => sourceOf(j) === source && j.prefilter && j.prefilter.verdict !== 'drop' && !j.detail && !j.repost_of && j.status !== 'dropped')
    .sort((a, b) => (postedAt(b) - postedAt(a)) || (b.scopes.includes('fractional') - a.scopes.includes('fractional')) || b.first_seen.localeCompare(a.first_seen))
    .slice(0, limit)
    .map((j) => j.job_id);
}
