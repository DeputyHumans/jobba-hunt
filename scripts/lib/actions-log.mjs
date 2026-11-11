// The action log: one JSON line per state change, appended to <workspace>/data/log/actions.jsonl.
// It answers "what did the hunt do, when, and on whose word" for the tracker's Recent activity
// section and `npm run log`. The limiter log stays the source for cap enforcement; this log is
// the human-readable history. Values are short: ids, outcomes, counts. Never a message body,
// a password, an address or an answer-bank value.
//
// Entry: { at, actor, action, source?, job_id?, detail?, ref? }
//   actor   "script" (a runner decided), "agent" (a skill acted), "user" (the user's word)
//   action  dotted verb, e.g. tick.done, triage.recorded, apply.submitted, mail.recorded

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOG_DIR } from './paths.mjs';

export const ACTIONS_LOG = process.env.JOBBA_ACTIONS_LOG || join(LOG_DIR, 'actions.jsonl');

const clip = (v, n = 240) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n - 1)}…` : v);

export function logAction(entry, { path = ACTIONS_LOG, now = new Date() } = {}) {
  if (!entry || !entry.action) throw new Error('logAction needs an action');
  const row = { at: now.toISOString(), actor: entry.actor || 'script', action: entry.action };
  for (const k of ['source', 'job_id', 'ref']) if (entry[k] != null) row[k] = clip(String(entry[k]));
  if (entry.detail != null) row.detail = typeof entry.detail === 'string' ? clip(entry.detail, 400) : entry.detail;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(row)}\n`);
  } catch {
    // Logging never breaks a run: a read-only or missing workspace just skips the line.
  }
  return row;
}

export function readActions({ path = ACTIONS_LOG, since = null, job = null, limit = null } = {}) {
  if (!existsSync(path)) return [];
  const t0 = since ? Date.parse(since) : null;
  const rows = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (t0 && Date.parse(r.at) < t0) continue;
    if (job && r.job_id !== job) continue;
    rows.push(r);
  }
  return limit ? rows.slice(-limit) : rows;
}
