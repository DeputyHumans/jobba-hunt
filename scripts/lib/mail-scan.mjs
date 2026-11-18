// Inbox scan orchestration (docs/inbox-scan-design.md). scanPending lists new mail, reads
// headers, opens a body only on a hunt signal, and checks open drafts for the user's reply.
// It never mutates the state it is given: a failure mid-scan leaves last_scan_at where it was,
// so the next firing reads the same mail again. The reader is any adapter with list, headers,
// body and thread (adapters/mail.mjs: gws, or replayMail over bridge responses).

import { huntSignal, isNoise } from './mail.mjs';
import { person } from './profile.mjs';

const SEEN_MAX = 2000;
// An hour of overlap covers Gmail's index lag at the boundary. Seen ids dedupe signal mail,
// and re-reading a header writes nothing.
export const OVERLAP_S = 3600;

// The search a scan runs: the configured query after the last scan, minus the overlap.
export function scanQuery(cfg, st = {}) {
  const after = st.last_scan_at || cfg.first_scan_after;
  if (!after || Number.isNaN(Date.parse(after))) throw new Error('config/mail.json needs first_scan_after (ISO date) before the first scan');
  return { after, q: `${cfg.query} after:${Math.floor(Date.parse(after) / 1000) - OVERLAP_S}` };
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The names a signature block starts with: the user's full name and display name.
export const signatureNames = (p = person()) => [...new Set([p.name, p.display_name].map((s) => String(s || '').trim()).filter((s) => s.length >= 3))];

// The user's own text: cut at a signature block (a line that is the user's full or display
// name, or the "-- " delimiter), at the quote header (Gmail wraps "On <date> <name> <\naddress>
// wrote:" over two lines) or at the first quoted line. A first-name sign-off stays.
export function ownText(text, names = signatureNames()) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const sig = names.length ? new RegExp(`\\n[ \\t]*(?:${names.map(reEsc).join('|')})[ \\t]*(?:[|,·][^\\n]*)?(?:\\n|$)`, 'i') : null;
  const cuts = [sig ? t.search(sig) : -1, t.search(/\n-- ?\n/), t.search(/\nOn [^\n]*(\n[^\n]*)?wrote:[ \t]*(\n|$)/), t.search(/\n>/)].filter((i) => i >= 0);
  return (cuts.length ? t.slice(0, Math.min(...cuts)) : t).trim();
}

// A reply that went out: Gmail's SENT label, never a saved DRAFT (any alias the user sends from).
const isSent = (m) => (m.labels || []).includes('SENT') && !(m.labels || []).includes('DRAFT');

export async function scanPending({ gws, cfg, st = {}, known = new Set(), openThreads = [], now = new Date(), companies = new Set(), names }) {
  const { after, q } = scanQuery(cfg, st);
  const sigNames = names || signatureNames();
  const seen = new Set(st.seen || []);
  const pending = [];
  let latest = after;
  // Gmail lists newest first: read the backlog oldest first, at most max_per_run a firing, and
  // move last_scan_at only as far as what was read, so a big backlog is never skipped.
  const fresh = (await gws.list(q, { max: 5000 })).filter((m) => !seen.has(m.id)).reverse().slice(0, cfg.max_per_run || 200);
  for (const { id } of fresh) {
    const h = await gws.headers(id);
    if (Date.parse(h.date) > Date.parse(latest)) latest = h.date;
    const signal = huntSignal(h, cfg, known, companies);
    // Mail without a signal leaves no trace: no body read, no id kept.
    if (!signal || isNoise(h, cfg)) continue;
    // A security notice's body (reset links, codes) is never read: the headers make the card.
    pending.push({ ...h, signal, text: signal === 'security' ? '' : await gws.body(id) });
  }
  const sent = [];
  const threadErrors = [];
  const repliesAfter = async (threadId, since) => {
    try {
      return (await gws.thread(threadId)).filter((m) => isSent(m) && Date.parse(m.date) > Date.parse(since));
    } catch (e) { threadErrors.push({ thread_id: threadId, error: e.message }); return []; }
  };
  // Open cards: any reply after the newest email on the thread, even one sent before the draft. A
  // Security card's thread is never fetched: the fetch would read the notice's body.
  for (const t of openThreads.filter((x) => x.status === 'draft' && x.kind !== 'security' && (x.since || x.draft_at))) {
    for (const m of await repliesAfter(t.thread_id, t.since || t.draft_at)) sent.push({ thread_id: t.thread_id, at: m.date, text: ownText(m.text, sigNames) });
  }
  // New mail the user already answered (from a phone, over a weekend) is recorded as sent. A
  // security notice's thread is never fetched: the fetch would read the notice's body.
  const newest = {};
  for (const p of pending) if (p.signal !== 'security' && !openThreads.some((t) => t.thread_id === p.threadId) && (!newest[p.threadId] || p.date > newest[p.threadId])) newest[p.threadId] = p.date;
  for (const [tid, since] of Object.entries(newest)) {
    for (const m of await repliesAfter(tid, since)) sent.push({ thread_id: tid, at: m.date, text: ownText(m.text, sigNames) });
  }
  const next = {
    last_scan_at: new Date(Math.min(Date.parse(latest), now.getTime())).toISOString(),
    seen: [...seen, ...pending.map((p) => p.id)].slice(-SEEN_MAX),
  };
  return { pending, sent, st: next, thread_errors: threadErrors };
}
