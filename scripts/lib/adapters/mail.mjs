// Mail readers for the read-only inbox scan (scripts/mail-scan.mjs) and the apply-time code
// waits (security codes, one-time passwords, verify links). config/mail.json `adapter` picks one:
//   gws     the bundled Google Workspace CLI (node_modules/.bin/gws, or mail.gws.bin, or
//           JOBBA_GWS_BIN), with its config under <workspace>/.secrets/gws (env.mjs childEnv).
//           Only `list` and `get` verbs are ever called: anything else throws MailWriteRefused
//           before a process starts.
//   bridge  scripts never fetch. A request goes to <data>/mail/requests/<id>.json; the agent
//           fulfils it with a mail connector's read tools and writes <data>/mail/responses/<id>.json
//           (same id). A timeout returns nothing, never a guess: the caller hands off.
//   none    no mail access. A scan reports adapter none; a code wait returns [] at once.
//
// openMail({ cfg }) -> { kind, list(q, {max}), headers(id), body(id), thread(threadId), fetchRecent(opts) }
// fetchRecent({ query, after, max = 5, purpose, job_id, wait_seconds }) resolves
// [{ id, threadId, from, fromAddr, subject, date, text }] newest first, or [] (bridge timeout:
// the array carries timedOut: true). Auth failures throw MailAuthError.

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { childEnv } from '../env.mjs';
import { DATA_DIR, toolBin, display } from '../paths.mjs';
import { loadConfig } from '../config.mjs';

// Each class sets `name`, so a caller can test err.name across module copies too.
export class MailWriteRefused extends Error { constructor(m) { super(m); this.name = 'MailWriteRefused'; } }
export class MailAuthError extends Error { constructor(m) { super(m); this.name = 'MailAuthError'; } }
// The adapter is bridge or none: the caller runs the request/response handshake instead.
export class MailNeedsFetch extends Error { constructor(m) { super(m); this.name = 'MailNeedsFetch'; } }
// Names kept for the earlier gws-only module.
export { MailWriteRefused as GwsWriteRefused, MailAuthError as GwsAuthError };

const READ = new Set(['list', 'get']);
const MAIL_DATA = () => join(DATA_DIR, 'mail');

// ---------- gws ----------
export const gwsBin = (cfg = {}) => process.env.JOBBA_GWS_BIN || cfg.gws?.bin || toolBin('gws');
export const GWS_BIN = () => gwsBin();

// The real runner. The CLI may print a keyring banner ("Using keyring backend: file") before
// the JSON; parse() skips it.
export const execRun = (bin = gwsBin(), env = childEnv('gws')) => (args) => new Promise((resolve) => {
  if (!existsSync(bin)) { resolve({ code: 127, stdout: '', stderr: `gws CLI not found at ${bin}: run npm ci` }); return; }
  execFile(bin, args, { env, maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
});

const decode = (data) => Buffer.from(String(data || ''), 'base64url').toString('utf8');
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const unescape = (s) => s.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);
// A link keeps its target: <a href="URL">label</a> becomes "label (URL)" (just "URL" when the
// label is the URL), so verification links in HTML-only mail survive the tag strip.
const linkText = (html) => html.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_, d, q, b, inner) => {
  const url = unescape(String(d ?? q ?? b ?? '').trim());
  const label = unescape(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  if (!/^(https?:|mailto:)/i.test(url)) return label;
  return !label || label === url ? url : `${label} (${url})`;
});
const htmlToText = (html) => unescape(linkText(html).replace(/<(br\s*\/?|\/p|\/div|\/li|\/tr)>/gi, '\n').replace(/<[^>]+>/g, ''))
  .replace(/[ \t]+\n/g, '\n').replace(/\n\s*\n+/g, '\n').trim();

const partsOf = (p, mime) => (p.mimeType === mime && p.body?.data ? [p] : (p.parts || []).flatMap((c) => partsOf(c, mime)));
// Plain text of a Gmail payload: text/plain when any exists, else the HTML parts turned to text.
export function plainText(payload) {
  const plain = partsOf(payload, 'text/plain');
  if (plain.length) return plain.map((p) => decode(p.body.data)).join('\n').replace(/\r\n/g, '\n').trim();
  return partsOf(payload, 'text/html').map((p) => htmlToText(decode(p.body.data))).join('\n').trim();
}

const isoDate = (v, fallbackMs = 0) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : new Date(Number(fallbackMs || 0)).toISOString());
const splitFrom = (from) => {
  const m = String(from || '').match(/^\s*"?(.*?)"?\s*<([^>]+)>\s*$/);
  return (m ? m[2] : String(from || '')).trim().toLowerCase();
};

const header = (msg) => {
  const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
  const from = h.from || '';
  return { id: msg.id, threadId: msg.threadId, from, fromAddr: splitFrom(from), to: h.to || '', subject: h.subject || '', date: isoDate(h.date, msg.internalDate), labels: msg.labelIds || [] };
};

const parse = (stdout) => { const i = stdout.indexOf('{'); return JSON.parse(i < 0 ? stdout : stdout.slice(i)); };
const tryParse = (s) => { try { return parse(String(s || '')); } catch { return null; } };
// gws exits 2 on missing or invalid credentials. An API 401, or a 403 about scopes or
// permissions, is a sign-in problem too; a 403 rate limit is not.
const AUTH_RE = /credentials|log ?in|invalid_grant|401|unauthori[sz]ed|REFUSED|identity check|Not authenticated|insufficient authentication|authentication scopes|insufficientPermissions/i;
export function isMailAuthFailure(r) {
  if (r.code === 2) return true;
  const err = tryParse(r.stdout)?.error;
  if (err && (err.code === 401 || (err.code === 403 && /scope|permission|auth/i.test(`${err.message} ${err.reason || ''}`)))) return true;
  return AUTH_RE.test(`${r.stderr}\n${r.stdout}`) && !/rateLimitExceeded|quota/i.test(`${r.stderr}\n${r.stdout}`);
}

export function makeGws(run) {
  // Throws synchronously on anything but a read, so a write never reaches a process.
  const call = (args, params) => {
    if (!READ.has(args.at(-1))) throw new MailWriteRefused(`gws ${args.join(' ')} is not a read`);
    return run([...args, '--params', JSON.stringify(params)]).then((r) => {
      if (r.code !== 0) {
        const msg = `${r.stderr || r.stdout}`.trim();
        throw isMailAuthFailure(r) ? new MailAuthError(msg) : new Error(msg || `gws exit ${r.code}`);
      }
      return parse(r.stdout);
    });
  };
  const getFull = (id) => call(['gmail', 'users', 'messages', 'get'], { userId: 'me', id, format: 'full' });
  const api = {
    kind: 'gws',
    call,
    async list(q, { max = 200 } = {}) {
      const out = [];
      let pageToken;
      do {
        const r = await call(['gmail', 'users', 'messages', 'list'], { userId: 'me', q, maxResults: Math.min(100, max - out.length), ...(pageToken ? { pageToken } : {}) });
        out.push(...(r.messages || []).map((m) => ({ id: m.id, threadId: m.threadId })));
        pageToken = r.nextPageToken;
      } while (pageToken && out.length < max);
      return out;
    },
    async headers(id) {
      return header(await call(['gmail', 'users', 'messages', 'get'], { userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] }));
    },
    async body(id) {
      return plainText((await getFull(id)).payload || {});
    },
    async thread(threadId) {
      const t = await call(['gmail', 'users', 'threads', 'get'], { userId: 'me', id: threadId, format: 'full' });
      return (t.messages || []).map((m) => ({ ...header(m), text: plainText(m.payload || {}) }));
    },
    // Recent messages for a code wait: one full read per message (headers and text together).
    async fetchRecent({ query = '', after = null, max = 5 } = {}) {
      const ids = await api.list(withAfter(query, after), { max });
      const out = [];
      for (const { id } of ids.slice(0, max)) {
        const m = await getFull(id);
        const h = header(m);
        out.push({ id: h.id, threadId: h.threadId, from: h.from, fromAddr: h.fromAddr, subject: h.subject, date: h.date, text: plainText(m.payload || {}) });
      }
      return newestFirst(out);
    },
  };
  return api;
}

const epochOf = (after) => (typeof after === 'number' ? Math.floor(after > 1e12 ? after / 1000 : after) : Math.floor(Date.parse(after) / 1000));
export function withAfter(query, after) {
  const e = after == null || after === '' ? NaN : epochOf(after instanceof Date ? after.getTime() : after);
  return [String(query || '').trim(), Number.isFinite(e) ? `after:${e}` : ''].filter(Boolean).join(' ');
}
const newestFirst = (xs) => [...xs].sort((a, b) => String(b.date).localeCompare(String(a.date)));

// ---------- bridge: request and response files ----------
export const bridgeDirs = (dir = MAIL_DATA()) => ({ requests: join(dir, 'requests'), responses: join(dir, 'responses') });
export const newRequestId = (prefix = 'mail') => `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

const writeJson = (p, obj) => {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, p);
};

// One request file. The agent reads it, fulfils it with read tools only, and writes the
// response to `respond_to`. Returns the request with its paths.
export function writeRequest(req, { dir = MAIL_DATA() } = {}) {
  const d = bridgeDirs(dir);
  const id = req.id || newRequestId(req.kind || 'mail');
  const request = join(d.requests, `${id}.json`);
  const response = join(d.responses, `${id}.json`);
  const row = { id, ...req, created_at: req.created_at || new Date().toISOString(), respond_to: response };
  mkdirSync(d.responses, { recursive: true }); // the agent writes straight into it
  writeJson(request, row);
  // The agent fulfils the request with the mail connector's read tools; say where, on stderr, so
  // the JSON last line on stdout stays the contract.
  process.stderr.write(`[mail-bridge] request ${id}: read ${display(request)}, write the answer to ${display(response)}\n`);
  return { ...row, request, response };
}

export function readResponse(pathOrId, { dir = MAIL_DATA() } = {}) {
  const p = String(pathOrId).endsWith('.json') ? pathOrId : join(bridgeDirs(dir).responses, `${pathOrId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function readRequest(id, { dir = MAIL_DATA() } = {}) {
  const p = join(bridgeDirs(dir).requests, `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function removeExchange(id, { dir = MAIL_DATA() } = {}) {
  const d = bridgeDirs(dir);
  for (const p of [join(d.requests, `${id}.json`), join(d.responses, `${id}.json`)]) rmSync(p, { force: true });
}

// A connector's message, in the gws header shape. `from` may be "Name <addr>" or an address.
export function normalizeMessage(m = {}) {
  const from = String(m.from || m.sender || '');
  const fromAddr = String(m.fromAddr || m.from_addr || splitFrom(from)).toLowerCase();
  return {
    id: String(m.id ?? ''), threadId: String(m.threadId ?? m.thread_id ?? ''), from, fromAddr, to: String(m.to || ''),
    subject: String(m.subject || ''), date: isoDate(m.date || m.internalDate, m.internalDate), labels: Array.isArray(m.labels || m.labelIds) ? (m.labels || m.labelIds) : [],
    ...(m.text != null || m.body != null ? { text: String(m.text ?? m.body ?? '') } : {}),
  };
}

// A gws-like reader over bridge responses, for scanPending. A body or thread that the responses
// do not hold reads as empty and is recorded in `needs`, so one dry pass over the headers tells
// the CLI which bodies and threads to request (headers first, bodies of signal ids only).
export function replayMail({ messages = [], bodies = {}, threads = {} } = {}) {
  const heads = newestFirst(messages.map(normalizeMessage).filter((m) => m.id));
  const byId = new Map(heads.map((m) => [m.id, m]));
  const needs = { bodies: new Set(), threads: new Set() };
  return {
    kind: 'bridge',
    needs,
    async list() { return heads.map((m) => ({ id: m.id, threadId: m.threadId })); },
    async headers(id) {
      const h = byId.get(String(id));
      if (!h) throw new Error(`bridge headers response has no message ${id}`);
      const { text, ...rest } = h;
      return rest;
    },
    async body(id) {
      if (Object.hasOwn(bodies, id)) return String(bodies[id] ?? '');
      needs.bodies.add(String(id));
      return '';
    },
    async thread(threadId) {
      if (Object.hasOwn(threads, threadId)) return (threads[threadId] || []).map((m) => ({ text: '', ...normalizeMessage(m) }));
      needs.threads.add(String(threadId));
      return [];
    },
  };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function bridgeMail(cfg, { dir = MAIL_DATA(), sleep = sleepMs, pollMs = 2000 } = {}) {
  const refuse = async () => { throw new MailNeedsFetch('bridge adapter: scripts never fetch; run the request/response handshake (npm run mail -- pending)'); };
  return {
    kind: 'bridge',
    list: refuse, headers: refuse, body: refuse, thread: refuse,
    // A code wait: one fetch request, then poll for its response until wait_seconds.
    async fetchRecent({ query = '', after = null, max = 5, purpose = null, job_id = null, wait_seconds = cfg.bridge?.wait_seconds ?? 180 } = {}) {
      const req = writeRequest({
        kind: 'fetch', query, after: after == null ? null : new Date(typeof after === 'number' && after < 1e12 ? after * 1000 : after).toISOString(), max, purpose, job_id,
        expires_at: new Date(Date.now() + wait_seconds * 1000).toISOString(),
        instructions: 'Read verbs only. Find the newest messages matching query received after `after`, at most max. Respond with { "id": <this id>, "messages": [{ "id", "threadId", "from", "subject", "date", "text" }] }, newest first. Write [] when nothing matches.',
      }, { dir });
      const deadline = Date.now() + wait_seconds * 1000;
      for (;;) {
        const r = readResponse(req.response);
        if (r) {
          removeExchange(req.id, { dir }); // codes and links never stay on disk
          const list = Array.isArray(r) ? r : r.messages || [];
          return newestFirst(list.map(normalizeMessage).map((m) => ({ id: m.id, threadId: m.threadId, from: m.from, fromAddr: m.fromAddr, subject: m.subject, date: m.date, text: m.text || '' }))).slice(0, max);
        }
        if (Date.now() >= deadline) break;
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      }
      removeExchange(req.id, { dir });
      const none = [];
      none.timedOut = true;
      return none;
    },
  };
}

function noneMail() {
  const empty = async () => [];
  return { kind: 'none', list: empty, headers: async () => null, body: async () => '', thread: empty, fetchRecent: empty };
}

export function openMail({ cfg = loadConfig('mail.json', { required: false }), run = null, dir, sleep, pollMs } = {}) {
  const kind = cfg.adapter || 'none';
  if (kind === 'gws') return makeGws(run || execRun(gwsBin(cfg)));
  if (kind === 'bridge') return bridgeMail(cfg, { ...(dir ? { dir } : {}), ...(sleep ? { sleep } : {}), ...(pollMs != null ? { pollMs } : {}) });
  if (kind === 'none') return noneMail();
  throw new Error(`config/mail.json adapter must be gws, bridge or none (got ${kind})`);
}
