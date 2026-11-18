#!/usr/bin/env node
// Inbox scan CLI (docs/inbox-scan-design.md), run by /hunt-loop step 4c. Read-only: it never
// sends, labels, archives or deletes. config/mail.json `adapter` picks the reader.
//
//   node scripts/mail-scan.mjs pending [--dry-run]
//     New hunt mail since the last scan, plus the user's replies to open drafts, into
//     data/mail/pending-<stamp>.json. The scan state advances here only when there is nothing
//     to judge; otherwise `record` advances it after the threads are written, so a firing that
//     fails between the two calls loses no mail. --dry-run never saves state.
//   node scripts/mail-scan.mjs record --file <results.json> [--sent <pending file>]
//   node scripts/mail-scan.mjs close --thread <id> --status closed|no-reply --note "..."
//
// adapter gws: the bundled gws CLI reads headers first and opens a body only on a hunt signal.
// adapter none: `pending` reports adapter none and does nothing.
// adapter bridge: scripts never fetch; the agent fulfils request files with a mail connector's
// read tools. Headers first stays in code, in three calls:
//   1. pending                                  writes data/mail/requests/<id>.json (kind headers:
//      the query and the time to list after) and exits 6 needs_fetch. The agent lists the
//      matching messages and writes data/mail/responses/<id>.json:
//      { "id": "<id>", "messages": [{ "id", "threadId", "from", "to", "subject", "date", "labels" }] }
//      (headers only, newest first, never a body).
//   2. pending --headers <response file>        computes signals and never_open from the headers
//      alone, then requests the bodies of signal messages and the threads to check for sent
//      replies (kind bodies: ids, threads) and exits 6 again; with no signal it finishes here.
//      The agent writes { "id": "<id>", "bodies": { "<message id>": "<plain text>" },
//      "threads": { "<thread id>": [{ "id", "from", "date", "labels", "text" }] } }.
//   3. pending --bodies <response file>         writes the usual pending file (the bodies request
//      names its headers response; --headers may be passed again). Request and response files
//      are deleted once read, since they hold mail text.
//
// Exit codes: 0 ok; 1 error (nothing written by record); 2 mail reader not signed in;
// 6 needs_fetch (bridge: fulfil the request named in the output, then run the `next` command).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { DATA_DIR, PIPELINE_DIR, COLLATERAL_DIR, ws, display, resolveArgPath } from './lib/paths.mjs';
import { loadConfig } from './lib/config.mjs';
import { claimIdsFromBank } from './lib/cv.mjs';
import { tz } from './lib/profile.mjs';
import { logAction } from './lib/actions-log.mjs';
import { STATE_PATH, loadState } from './lib/state.mjs';
import { openMail, replayMail, writeRequest, readRequest, removeExchange, MailAuthError } from './lib/adapters/mail.mjs';
import { scanPending, scanQuery } from './lib/mail-scan.mjs';
import { companyKey, parseThread, renderThread, renderIndex, recordResults } from './lib/mail.mjs';
import { parseFrontmatter } from './lib/tracker.mjs';

export const MAIL_DIR = join(PIPELINE_DIR, 'mail');
const OPP_DIR = join(PIPELINE_DIR, 'opportunities');
const CONTACTS = join(PIPELINE_DIR, 'channels', 'dice', 'recruiter-contacts.md');
const README = join(MAIL_DIR, 'README.md');
const MAIL_DATA = join(DATA_DIR, 'mail');
const STATE = join(MAIL_DATA, 'state.json');
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const out = (o, code = 0) => { console.log(JSON.stringify(o)); process.exit(code); };

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const stamp = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz() || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour === '24' ? '00' : p.hour}${p.minute}`;
};

// Thread files' frontmatter: the known threads and the open drafts.
export function loadThreadHeads(dir = MAIL_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => ({ file: f, ...parseFrontmatter(readFileSync(join(dir, f), 'utf8')) })).filter((t) => t.thread_id);
}
const loadThreads = () => (existsSync(MAIL_DIR) ? readdirSync(MAIL_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => ({ ...parseThread(readFileSync(join(MAIL_DIR, f), 'utf8')), file: f })).filter((t) => t.thread_id) : []);
const loadOpps = () => (existsSync(OPP_DIR) ? readdirSync(OPP_DIR).filter((f) => f.endsWith('.md')).map((f) => ({ file: f, md: readFileSync(join(OPP_DIR, f), 'utf8') })) : []);
const outboundFiles = () => (existsSync(join(MAIL_DIR, 'outbound')) ? readdirSync(join(MAIL_DIR, 'outbound')).filter((f) => f.endsWith('.md')).sort() : []);
// The index's hand-written tail (from "## Before the scan" on) survives every rewrite, and so
// does its first day.
const indexMd = () => (existsSync(README) ? readFileSync(README, 'utf8') : '');
const indexNotes = () => { const md = indexMd(); const i = md.indexOf('\n## Before the scan'); return i < 0 ? '' : md.slice(i + 1).trim(); };
const indexCreated = () => parseFrontmatter(indexMd()).created || null;
// Writes carry workspace-relative paths (pipeline/mail/<file>, pipeline/opportunities/<file>).
const wsPath = (p) => (p.startsWith('pipeline/') ? join(PIPELINE_DIR, p.slice('pipeline/'.length)) : ws(p));
const writeAll = (writes) => { for (const w of writes) { const p = wsPath(w.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, w.content); } };
const dataRel = (p) => { const r = relative(DATA_DIR, p); return r && !r.startsWith('..') && !isAbsolute(r) ? r : p; };
const dataAbs = (p) => (isAbsolute(p) ? p : join(DATA_DIR, p));

// What the scan needs besides the reader: known threads, open drafts, and the companies the
// user applied to or pursues (a person at that domain is a hunt signal).
function scanContext() {
  const cfg = loadConfig('mail.json');
  const st = readJson(STATE, {});
  const threads = loadThreads();
  const opps = loadOpps().map((o) => parseFrontmatter(o.md));
  const known = new Set([...threads.map((t) => String(t.thread_id)), ...opps.map((o) => o.thread_id).filter(Boolean).map(String)]);
  // An open card is checked for the user's reply after the newest email on its thread.
  const openThreads = threads.map((t) => ({ thread_id: String(t.thread_id), kind: t.kind || null, status: t.status, draft_at: t.draft_at || null, since: t.emails.at(-1)?.at || null }));
  const jobs = loadState(STATE_PATH).jobs || {};
  const companies = new Set(Object.values(jobs).filter((j) => j && (j.application?.status || j.status === 'applied' || j.triage?.decision === 'pursue')).map((j) => companyKey(j.company)).filter((k) => k.length >= 4));
  return { cfg, st, known, openThreads, companies };
}

// The scan result into a pending file; with nothing to judge the state is saved and no file kept.
function finishPending(r, extra = {}) {
  mkdirSync(MAIL_DATA, { recursive: true });
  const file = join(MAIL_DATA, `pending-${stamp()}.json`);
  writeFileSync(file, JSON.stringify({ pending: r.pending, sent: r.sent, st_next: r.st }, null, 2));
  const empty = !r.pending.length && !r.sent.length;
  // Nothing to judge: save the state and drop the file (pending files hold email bodies).
  const save = empty && !flag('dry-run');
  if (save) { writeFileSync(STATE, JSON.stringify(r.st, null, 2)); rmSync(file); }
  out({ success: true, ...extra, count: r.pending.length, sent: r.sent.length, file: save ? null : display(file), state_saved: save, thread_errors: r.thread_errors });
}

const needsFetch = (phase, req, next) => out({
  success: false, status: 'needs_fetch', adapter: 'bridge', phase, request: display(req.request), response: display(req.response), id: req.id, next,
}, 6);

async function pendingBridge(ctx) {
  const headersArg = typeof flag('headers') === 'string' ? resolveArgPath(flag('headers')) : null;
  const bodiesArg = typeof flag('bodies') === 'string' ? resolveArgPath(flag('bodies')) : null;
  if (!headersArg && !bodiesArg) {
    const { after, q } = scanQuery(ctx.cfg, ctx.st);
    const req = writeRequest({
      kind: 'headers', query: q, after, max: ctx.cfg.bridge?.max_list ?? 500,
      instructions: 'Read verbs only. List every message matching query (Gmail search syntax), newest first, at most max. Return headers only: id, threadId, from, to, subject, date, labels. Never open a message body.',
    });
    needsFetch('headers', req, `npm run mail -- pending --headers ${display(req.response)}`);
  }
  let bodiesResp = null;
  let headersPath = headersArg;
  if (bodiesArg) {
    if (!existsSync(bodiesArg)) throw new Error(`no bodies response at ${display(bodiesArg)}`);
    bodiesResp = JSON.parse(readFileSync(bodiesArg, 'utf8'));
    const bodiesReq = readRequest(bodiesResp.id || '') || {};
    headersPath = headersPath || (bodiesReq.headers_file ? dataAbs(bodiesReq.headers_file) : null);
    if (!headersPath) throw new Error('the bodies response names no request with a headers_file; pass --headers <response file> too');
  }
  if (!existsSync(headersPath)) throw new Error(`no headers response at ${display(headersPath)}`);
  const headersResp = JSON.parse(readFileSync(headersPath, 'utf8'));
  const messages = Array.isArray(headersResp) ? headersResp : headersResp.messages || [];
  const reader = replayMail({ messages, bodies: bodiesResp?.bodies || {}, threads: bodiesResp?.threads || {} });
  const r = await scanPending({ gws: reader, ...ctx, now: new Date() });
  const missing = { bodies: [...reader.needs.bodies], threads: [...reader.needs.threads] };
  if (bodiesResp && (missing.bodies.length || missing.threads.length)) {
    out({ success: false, adapter: 'bridge', error: `the bodies response lacks ${missing.bodies.length} bodies and ${missing.threads.length} threads; add them to ${display(bodiesArg)} and run this again`, missing }, 1);
  }
  if (!bodiesResp && (missing.bodies.length || missing.threads.length)) {
    const req = writeRequest({
      kind: 'bodies', ids: missing.bodies, threads: missing.threads, headers_file: dataRel(headersPath), headers_request: headersResp.id || null,
      instructions: 'Read verbs only. For each id in ids, the message text as plain text. For each id in threads, every message of the thread with id, from, date, labels and text. Respond with { "id": <this id>, "bodies": { "<id>": "<text>" }, "threads": { "<thread id>": [...] } }.',
    });
    needsFetch('bodies', req, `npm run mail -- pending --bodies ${display(req.response)}`);
  }
  // Done: the exchange files hold mail text, so they go once the pending file is written.
  for (const id of [headersResp.id, bodiesResp?.id].filter(Boolean)) removeExchange(id);
  for (const p of [headersPath, bodiesArg].filter(Boolean)) rmSync(p, { force: true });
  finishPending(r, { adapter: 'bridge', ...(headersResp.truncated ? { truncated: true } : {}) });
}

async function pending() {
  const ctx = scanContext();
  const kind = ctx.cfg.adapter || 'none';
  if (kind === 'none') out({ success: true, adapter: 'none', count: 0, sent: 0, file: null, state_saved: false, note: 'config/mail.json adapter is none: the inbox scan is off' });
  if (kind === 'bridge') return pendingBridge(ctx);
  const r = await scanPending({ gws: openMail({ cfg: ctx.cfg }), ...ctx, now: new Date() });
  finishPending(r, { adapter: kind });
}

async function record() {
  const file = flag('file');
  if (typeof file !== 'string') throw new Error('record needs --file <results.json>');
  const raw = readJson(resolveArgPath(file), []);
  const sentFile = typeof flag('sent') === 'string' ? resolveArgPath(flag('sent')) : null;
  const pend = sentFile ? readJson(sentFile, {}) : {};
  const bank = join(COLLATERAL_DIR, 'claim-bank.md');
  // Drafts cite only usable claims (cv.mjs claimIdsFromBank: the Claims table, confirmed statuses).
  const claims = existsSync(bank) ? claimIdsFromBank(readFileSync(bank, 'utf8')) : new Set();
  const results = Array.isArray(raw) ? raw : raw.results || [];
  const r = recordResults({
    results, sent: pend.sent || [], threads: loadThreads(), opportunities: loadOpps(),
    contactsMd: existsSync(CONTACTS) ? readFileSync(CONTACTS, 'utf8') : null, outbound: outboundFiles(), notes: indexNotes(), created: indexCreated(), claims, now: new Date(),
  });
  if (r.errors.length) out({ success: false, errors: r.errors }, 1);
  writeAll(r.writes);
  for (const x of results.filter((x) => x.kind !== 'ignore')) logAction({ actor: 'agent', action: 'mail.recorded', source: 'mail-scan', job_id: x.job_id ?? null, ref: x.thread_id, detail: `${x.kind}${x.draft ? ', draft' : ''}` });
  for (const s of pend.sent || []) logAction({ actor: 'user', action: 'mail.reply_sent', source: 'mail-scan', ref: s.thread_id });
  // The state never moves back (re-running an older pending file), and the pending file, which
  // holds email bodies, is deleted once its mail is recorded.
  const cur = readJson(STATE, {});
  const forward = pend.st_next && (!cur.last_scan_at || Date.parse(pend.st_next.last_scan_at) >= Date.parse(cur.last_scan_at));
  if (forward) { mkdirSync(MAIL_DATA, { recursive: true }); writeFileSync(STATE, JSON.stringify({ ...pend.st_next, seen: [...new Set([...(cur.seen || []), ...pend.st_next.seen])].slice(-2000) }, null, 2)); }
  if (sentFile && existsSync(sentFile)) rmSync(sentFile);
  out({ success: true, written: r.writes.map((w) => w.path), notify: r.notify, state_saved: !!forward });
}

async function close() {
  const id = flag('thread'); const status = flag('status'); const note = flag('note');
  if (typeof id !== 'string' || !['closed', 'no-reply'].includes(status) || typeof note !== 'string') throw new Error('close needs --thread <id> --status closed|no-reply --note "..."');
  const threads = loadThreads();
  const t = threads.find((x) => x.thread_id === id);
  if (!t) throw new Error(`no thread ${id} in pipeline/mail`);
  const now = new Date();
  t.status = status;
  t.action = `${t.action || ''}\n\n${now.toISOString().slice(0, 10)}: ${note}`.trim();
  writeAll([{ path: `pipeline/mail/${t.file}`, content: renderThread(t, { now }) }, { path: 'pipeline/mail/README.md', content: renderIndex(threads, { outbound: outboundFiles(), notes: indexNotes(), created: indexCreated(), now }) }]);
  logAction({ actor: 'agent', action: 'mail.closed', source: 'mail-scan', job_id: t.job_id ?? null, ref: id, detail: status });
  out({ success: true, thread: id, status });
}

const commands = { pending, record, close };
if (!commands[cmd]) out({ success: false, error: 'usage: mail-scan.mjs pending [--dry-run] [--headers <response>] [--bodies <response>] | record --file <results.json> [--sent <pending file>] | close --thread <id> --status closed|no-reply --note "..."' }, 1);
commands[cmd]().catch((e) => out({ success: false, error: e.message }, e instanceof MailAuthError || e?.name === 'MailAuthError' ? 2 : 1));
