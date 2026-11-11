#!/usr/bin/env node
// Comment watch (npm run watch): polls the tracker document and every review document for new
// comments, and prints one JSON line per new thread or new comment, so /hunt-loop can act on
// each one at once (a Monitor keeps this running for the whole loop).
//
//   node scripts/tracker-watch.mjs           # poll every tracker.watch.poll_seconds (default 30) until stopped
//   node scripts/tracker-watch.mjs --once    # one poll, then exit (tests, and a Monitor's until-loop)
//
// Documents: config/tracker.json bikeshed.doc_id (kind "tracker") and each entry of
// <data>/tracker/review-docs.json (one document per part: cv, letter; see adapters/publish.mjs) (kind
// "review", re-read on every poll so a new review document is picked up).
//
// Event line: { doc, kind, job_id?, thread_id, section, quote, text, author, at }. A thread whose
// comments are all still empty prints once as { ..., text: "", typing: true }: the user is still
// typing, and the text arrives as its own line on a later poll. Comments the agent sent through
// the bikeshed CLI (via "cli") are never printed. A failed poll prints
// { doc, kind, error: "auth" | "failed", message } once until the error changes.
// Dedupe state: <data>/tracker/watch-state.json (thread id plus how many comments were printed).
//
// It never replies and never resolves: the agent does, through the bikeshed CLI.
// Exit codes (--once): 0 polled (or nothing to watch); 2 every document failed on sign-in.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './cloak-core.mjs';
import { loadConfig, writeJsonAtomic } from './lib/config.mjs';
import { bikeshedRun, isAuthError, parseJsonOut } from './lib/adapters/bikeshed.mjs';
import { bikeshedCfg, loadReviewDocs, reviewParts, trackerDir } from './lib/adapters/publish.mjs';
import { watchEvents } from './lib/tracker.mjs';

const STATE = join(trackerDir(), 'watch-state.json');
const KEEP_DAYS = 30; // a resolved thread's entry stays this long, in case it is reopened
const { flags } = parseArgs(process.argv.slice(2));
const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const note = (s) => process.stderr.write(`[watch] ${s}\n`);
const readState = () => { try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}; } catch { return {}; } };

const cfg = loadConfig('tracker.json');
if (cfg.publisher === 'local' || cfg.watch?.enabled === false) {
  note(cfg.publisher === 'local' ? 'publisher local: no comments to watch' : 'tracker.watch.enabled is false');
  process.exit(0);
}
const pollSeconds = Math.max(5, Number(cfg.watch?.poll_seconds) || 30);

function docs() {
  const list = [];
  const { doc_id } = bikeshedCfg(cfg);
  if (doc_id) list.push({ doc: doc_id, kind: 'tracker' });
  for (const [job_id, v] of Object.entries(loadReviewDocs())) for (const p of reviewParts(v)) list.push({ doc: p.doc_id, kind: 'review', job_id, part: p.part });
  return list;
}

async function pollOnce() {
  const st = readState();
  const now = new Date();
  const targets = docs();
  let authFails = 0;
  for (const d of targets) {
    const meta = { doc: d.doc, kind: d.kind, ...(d.job_id ? { job_id: d.job_id } : {}), ...(d.part && d.part !== 'docs' ? { part: d.part } : {}) };
    const prev = st[d.doc] || { threads: {} };
    const r = await bikeshedRun(['comments', d.doc, '--json']);
    if (r.code !== 0) {
      const error = isAuthError(r) ? 'auth' : 'failed';
      if (error === 'auth') authFails += 1;
      if (prev.error !== error) emit({ ...meta, error, message: String(r.stderr || r.stdout || '').trim().slice(0, 300) });
      st[d.doc] = { ...prev, error };
      continue;
    }
    const threads = parseJsonOut(r.stdout)?.threads || [];
    const { events, seen } = watchEvents(threads, prev.threads || {}, meta, { now });
    for (const e of events) emit(e);
    const cutoff = now.getTime() - KEEP_DAYS * 864e5;
    st[d.doc] = { kind: d.kind, ...(d.job_id ? { job_id: d.job_id } : {}), threads: Object.fromEntries(Object.entries(seen).filter(([, v]) => !v.at || Date.parse(v.at) >= cutoff)), polled_at: now.toISOString() };
  }
  writeJsonAtomic(STATE, st);
  return { docs: targets.length, authFails };
}

if (flags.once) {
  const r = await pollOnce();
  if (!r.docs) note('no tracker or review document yet');
  process.exit(r.docs && r.authFails === r.docs ? 2 : 0);
}

let stop = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop = true; process.exit(0); });
note(`watching every ${pollSeconds} s`);
while (!stop) {
  try { await pollOnce(); } catch (e) { note(`poll failed: ${e.message}`); }
  await new Promise((res) => setTimeout(res, pollSeconds * 1000));
}
