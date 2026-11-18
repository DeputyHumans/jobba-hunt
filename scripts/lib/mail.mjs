// Inbox scan logic (docs/inbox-scan-design.md). Pure functions: which mail may be opened
// (huntSignal), what is noise, and what a draft may say. Rates are never written into a draft:
// the draft carries [RATE] (and [TIMES] for call slots) and the user fills it in before sending.

// ignore: opened on a signal but not about the hunt (client mail that slipped through). Marked
// seen, nothing written.
export const KINDS = ['reply', 'interview', 'outreach-fit', 'outreach-nofit', 'blast', 'rejection', 'receipt', 'security', 'platform-message', 'ignore'];
const DRAFTED = new Set(['reply', 'interview', 'outreach-fit', 'outreach-nofit']);

const inDomain = (addr, d) => addr === d || addr.endsWith(`@${d}`) || addr.endsWith(`.${d}`);
const anyDomain = (addr, list) => (list || []).some((d) => inDomain(String(addr).toLowerCase(), d.toLowerCase()));

// The signal that lets a message body be opened, or null. never_open beats every signal.
// A company the user applied to, as the bare name a sender domain would carry ("Umbrella Labs" -> "umbrellalabs").
export const companyKey = (name) => String(name || '').toLowerCase().replace(/\b(inc|llc|ltd|corp|co|gmbh|the)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

export function huntSignal(h, cfg, known, companies = new Set()) {
  const addr = String(h.fromAddr || '').toLowerCase();
  if (anyDomain(addr, cfg.never_open?.domains) || (cfg.never_open?.senders || []).map((s) => s.toLowerCase()).includes(addr)) return null;
  if (known.has(h.threadId)) return 'known-thread';
  if (anyDomain(addr, cfg.security?.senders) && new RegExp(cfg.security.subject, 'i').test(h.subject || '')) return 'security';
  if (anyDomain(addr, cfg.hunt_senders)) return 'sender';
  // A person at a company the user applied to: a recruiter's "We'd love to talk to you!" from the
  // company's own domain carries no job word, so without this it is never opened. The domain's
  // name part must equal the company key.
  const dom = (addr.split('@')[1] || '').split('.').slice(-2, -1)[0] || '';
  if (dom.length >= 4 && companies.has(dom)) return 'company';
  // A subject opens mail only with a recruiter cue (c2c, w2, position...) or two job words
  // ("Remote Role :: Principal Architect"): one everyday word ("Contract for the sprint") is not enough.
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hits = (list) => new Set((list || []).filter((w) => new RegExp(`\\b${esc(w)}\\b`, 'i').test(h.subject || '')).map((w) => w.toLowerCase())).size;
  if (hits(cfg.subject_strong) >= 1 || hits(cfg.subject_words) >= 2) return 'subject';
  return null;
}

export function isNoise(h, cfg) {
  const addr = String(h.fromAddr || '').toLowerCase();
  if ((cfg.noise?.senders || []).map((s) => s.toLowerCase()).includes(addr)) return true;
  const subj = String(h.subject || '').toLowerCase();
  return (cfg.noise?.subjects || []).some((s) => subj.includes(s.toLowerCase()));
}

// Money or rate figures. Claim counts ("25+ years", "100M+ MAU") and years ("2026") pass.
// A number next to a money word, either side. Bare ids and zips ("Job ID 9130571") pass.
const RATE = [/[$€£]\s?\d|\d\s?[$€£]/, /\b\d[\d,.]*\s?k\b/i, /\b\d{1,3}(,\d{3})+\b/,
  /\b\d[\d,.]*\s*(usd|dollars?|an hour|hourly|a (year|month|week|day)|(\/|per)\s*(hr|hour|h|day|week|month|year|yr|annum))\b/i,
  /\b(rate|usd|salary|pay|compensation)\b[^.\n\d]{0,20}\d/i];

export function validateMailResult(r, claimIds) {
  const errors = [];
  const id = r.thread_id || '(no thread_id)';
  if (!r.thread_id) errors.push('missing thread_id');
  if (!KINDS.includes(r.kind)) errors.push(`${id}: unknown kind ${r.kind}`);
  if (DRAFTED.has(r.kind) && !r.draft) errors.push(`${id}: kind ${r.kind} needs a draft`);
  if (!DRAFTED.has(r.kind) && r.draft) errors.push(`${id}: kind ${r.kind} takes no draft`);
  if (r.draft) {
    const text = r.draft.replaceAll('[RATE]', '.'); // a break, so "rate is [RATE] on 1099" is not a figure
    if (RATE.some((re) => re.test(text))) errors.push(`${id}: draft states a rate or money figure; use [RATE]`);
    if (text.includes(';')) errors.push(`${id}: draft has a semicolon`);
    if (text.includes('—')) errors.push(`${id}: draft has an em dash`);
  }
  for (const c of r.claims || []) if (!claimIds.has(c)) errors.push(`${id}: unknown claim ${c}`);
  if (r.match != null && !MATCHES.includes(r.match)) errors.push(`${id}: match must be ${MATCHES.join(', ')}`);
  return errors;
}

// ---------- thread files (pipeline/mail/) ----------
// One file per email thread, named like its opportunity file. Scalar fields sit in the
// frontmatter as JSON values (valid YAML, safe for subjects with ": "). The email history, the
// draft, what the user sent and the suggested action sit in body sections. mail_status: draft
// means the card is open (a draft to send, or a Close?, Security or Read-it card).
// Dates are days in the user's time zone (preferences.schedule.tz); the owner line is the
// user's name (profile/person.json). Both are read when a function is called, never at import.

import { belowIcFloor } from './rate.mjs';
import { tierFor } from './triage.mjs';
import { CV_FILE_RE, operatorName, person, tz as profileTz } from './profile.mjs';

const dayIn = (zone) => (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const ownerOf = (owner) => owner || person().name || operatorName();
// The CV's share name from its file name (<prefix>-cv-<share>.pdf), else the bare file name.
export const cvShare = (cv) => {
  if (!cv) return '';
  const base = String(cv).split('/').pop();
  const m = base.match(CV_FILE_RE);
  return m ? m[2] : base.replace(/\.(pdf|docx|html)$/, '');
};
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const slug = (s, words = 6) => oneLine(s).toLowerCase().replace(/^(re|fwd?|fw):\s*/g, '').replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean).slice(0, words).join('-');
const FENCE = '````';
const OPEN_KINDS = new Set(['reply', 'interview', 'outreach-fit', 'outreach-nofit', 'rejection', 'security', 'platform-message']);
const FIELDS = ['mail_status', 'thread_id', 'kind', 'firm', 'sender_name', 'reply_to', 'subject', 'job_id', 'match', 'opportunity', 'cv', 'new_cv', 'draft_at', 'notified', 'claims'];
// How sure the session is that the email belongs to job_id: sure, probable (shown as "Probably
// <job>" and noted in the stage log, never silently merged) or none.
const MATCHES = ['sure', 'probable', 'none'];

export function threadFileName({ opportunityFile, date, firm, topic }) {
  return opportunityFile || `${String(date).replaceAll('-', '')}-${slug(firm, 3)}-${slug(topic)}.md`;
}

export function renderThread(t, { now = new Date(), tz = profileTz(), owner = null } = {}) {
  const dayOf = dayIn(tz);
  // The two enumerated fields stay bare for readability; every other value is JSON, so ids made
  // of digits come back as strings.
  const val = (k) => (k === 'mail_status' ? t.status : k === 'kind' ? t.kind : JSON.stringify(t[k] ?? null));
  const first = t.emails[0]?.at || now.toISOString();
  const fm = ['---', `title: ${JSON.stringify(`${t.firm}: ${oneLine(t.subject)}`)}`, `created: ${dayOf(first)}`, `updated: ${dayOf(now.toISOString())}`, `owner: ${ownerOf(owner)}`, 'status: Draft',
    `tags: [job-hunt, mail, ${t.kind}]`, 'related_docs:', '  - README.md', ...(t.opportunity ? [`  - ../opportunities/${t.opportunity}`] : []), ...FIELDS.filter((k) => k !== 'match' || t.match != null).map((k) => `${k}: ${val(k)}`), '---'];
  const emails = t.emails.map((e) => `- \`${e.at}\` ${oneLine(e.from_name)}: ${oneLine(e.summary)}`).join('\n');
  const draft = t.draft ? `${FENCE}text\n${t.draft}\n${FENCE}${t.audit ? `\nAudit: ${oneLine(t.audit)}` : ''}` : `None.${t.audit ? `\nAudit: ${oneLine(t.audit)}` : ''}`;
  const sent = t.sent.length ? t.sent.map((s) => `### \`${s.at}\`\n${FENCE}text\n${s.text}\n${FENCE}`).join('\n\n') : 'None yet.';
  return `${fm.join('\n')}\n\n# ${t.firm}: ${oneLine(t.subject)}\n\n## Emails\n${emails}\n\n## Draft\n${draft}\n\n## Sent\n${sent}\n\n## Action\n${t.action || ''}\n`;
}

const section = (md, name) => { const m = md.match(new RegExp(`\\n## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`)); return m ? m[1].replace(/\n+$/, '') : ''; };
const fenced = (s) => [...s.matchAll(new RegExp(`${FENCE}text\\n([\\s\\S]*?)\\n${FENCE}`, 'g'))].map((m) => m[1]);

export function parseThread(md) {
  const fmText = (md.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const fm = {};
  for (const line of fmText.split('\n')) {
    const kv = line.match(/^([a-z_]+):\s?(.*)$/);
    if (kv && FIELDS.includes(kv[1])) { try { fm[kv[1]] = JSON.parse(kv[2]); } catch { fm[kv[1]] = kv[2]; } }
  }
  const draftSec = section(md, 'Draft');
  const sentSec = section(md, 'Sent');
  const { mail_status: status, ...rest } = fm;
  return {
    ...rest, status,
    emails: section(md, 'Emails').split('\n').map((l) => l.match(/^- `([^`]+)` (.*?): (.*)$/)).filter(Boolean).map((m) => ({ at: m[1], from_name: m[2], summary: m[3] })),
    draft: fenced(draftSec)[0] ?? null,
    audit: (draftSec.match(/^Audit: (.*)$/m) || [])[1] ?? null,
    sent: [...sentSec.matchAll(new RegExp(`### \`([^\`]+)\`\\n${FENCE}text\\n([\\s\\S]*?)\\n${FENCE}`, 'g'))].map((m) => ({ at: m[1], text: m[2] })),
    action: section(md, 'Action'),
  };
}

// created: the index's first day, kept from the existing file (the CLI reads it); a new index
// takes today.
export function renderIndex(threads, { outbound = [], notes = '', now = new Date(), tz = profileTz(), owner = null, created = null } = {}) {
  const dayOf = dayIn(tz);
  const last = (t) => t.emails.at(-1)?.at || '';
  const rows = [...threads].sort((a, b) => last(b).localeCompare(last(a)))
    .map((t) => `| ${last(t) ? dayOf(last(t)) : ''} | ${oneLine(t.firm)} | ${oneLine(t.subject).replace(/\|/g, '/')} | ${t.kind} | ${t.status} | [${t.file}](${t.file}) |`);
  return ['---', 'title: Hunt Mail Index', `created: ${created || dayOf(now.toISOString())}`, `updated: ${dayOf(now.toISOString())}`, `owner: ${ownerOf(owner)}`, 'status: Draft', 'tags: [job-hunt, mail, index]',
    'related_docs:', '  - ../opportunities', '---', '', '# Hunt Mail',
    '', 'One file per email thread about the hunt, newest first. A thread file has the same name as its opportunity file. Status `draft` means a card is open on the tracker.',
    '', '| Date | Firm | Role | Kind | Status | File |', '|---|---|---|---|---|---|', ...rows,
    ...(outbound.length ? ['', '## Outbound', '', 'Intro and outreach emails sent unprompted.', '', ...outbound.map((f) => `- [${f}](outbound/${f})`)] : []),
    ...(notes ? ['', notes] : []), ''].join('\n');
}

// ---------- opportunity file edits ----------
const fmEnd = (md) => md.indexOf('\n---', 4);
export function addRelatedDoc(md, rel) {
  if (md.includes(`  - ${rel}\n`)) return md;
  const lines = md.split('\n');
  const i = lines.findIndex((l, n) => n < md.slice(0, fmEnd(md)).split('\n').length && /^related_docs:/.test(l));
  if (i < 0) return md;
  let j = i + 1;
  while (/^ {2}- /.test(lines[j] || '')) j++;
  lines.splice(j, 0, `  - ${rel}`);
  return lines.join('\n');
}
export function appendStageLog(md, row) {
  const lines = md.split('\n');
  const h = lines.findIndex((l) => /^## Stage log/.test(l));
  if (h < 0) return `${md.replace(/\n*$/, '')}\n\n## Stage log\n| Date | Stage | Note |\n|---|---|---|\n${row}\n`;
  let j = h + 1;
  while (j < lines.length && !/^## /.test(lines[j])) j++;
  let k = j - 1;
  while (k > h && !lines[k].startsWith('|')) k--;
  lines.splice(k + 1, 0, row);
  return lines.join('\n');
}
const setField = (md, key, value) => md.replace(new RegExp(`^${key}:.*$`, 'm'), value === '' ? `${key}:` : `${key}: ${value}`);

function emailOpportunity(r, file, threadFile, day, owner) {
  const o = r.opportunity;
  const tier = tierFor(o.score, o.gates || {});
  const share = cvShare(r.cv);
  return ['---', `title: ${JSON.stringify(`${o.title} @ ${o.company}`)}`, `created: ${day}`, `updated: ${day}`, `owner: ${owner}`, 'status: Draft', `tags: [job-hunt, opportunity, email, ${o.archetype || 'inbound'}]`,
    'related_docs:', '  - ../../fit-profile.md', `  - ../mail/${threadFile}`, `role: ${JSON.stringify(o.title)}`, `company: ${JSON.stringify(o.company)}`, `cv: ${share}`, 'stage: inbound', `tier: ${tier}`, `score: ${o.score}`, `job_id: "email-${r.thread_id}"`, 'url:', 'source: email',
    `fetched_at: ${r.at}`, `archetype: ${o.archetype || ''}`, 'applied_on:', 'next_action: Reply on the thread (card on the tracker)', `next_action_due: ${day}`, 'cv_note:', 'offer_folder:', '---', '',
    `# ${o.title} @ ${o.company}`, '', '## Role snapshot', '| Field | Value |', '|---|---|', `| Company | ${o.company} |`, `| Comp seen (not scored) | ${o.comp_seen || 'Not stated'} |`, '',
    '## Triage', `- **Score:** ${o.score}, tier ${tier}. Gates: ${Object.entries(o.gates || {}).map(([g, v]) => `${g} ${v}`).join(', ')}.`, '',
    '## Stage log', '| Date | Stage | Note |', '|---|---|---|', `| ${day} | inbound | Recruiter email, scored from the email text (thread \`pipeline/mail/${threadFile}\`) |`, ''].join('\n');
}

// The record step: validate every result first, then return the file writes. Pure; the CLI writes.
// tz, owner (the frontmatter name), who (the name in stage-log rows) and created (the index's
// first day) default to the workspace profile.
export function recordResults({ results = [], sent = [], threads = [], opportunities = [], contactsMd = null, outbound = [], notes = '', claims, now = new Date(), tz = profileTz(), owner = null, who = null, created = null }) {
  const dayOf = dayIn(tz);
  const by = { tz, owner: ownerOf(owner) };
  const replier = who || operatorName();
  const errors = results.flatMap((r) => validateMailResult(r, claims));
  for (const r of results) {
    if (r.kind === 'outreach-fit' && r.opportunity?.lane === 'hands-on' && r.opportunity.comp_seen && belowIcFloor(r.opportunity.comp_seen)) errors.push(`${r.thread_id}: rate under the IC floor; record it as outreach-nofit with a redirect draft`);
  }
  for (const s of sent) if (!threads.some((t) => t.thread_id === s.thread_id) && !results.some((r) => r.thread_id === s.thread_id)) errors.push(`${s.thread_id}: sent reply for an unknown thread`);
  if (errors.length) return { writes: [], errors, notify: [] };
  const day = dayOf(now.toISOString());
  const byId = new Map(threads.map((t) => [t.thread_id, structuredClone(t)]));
  const opps = new Map(opportunities.map((o) => [o.file, o.md]));
  const oppOf = (jobId) => jobId && [...opps].find(([, md]) => String((md.match(/^job_id:\s*"?([^"\n]*)"?/m) || [])[1]) === String(jobId))?.[0];
  const touched = new Set(); const touchedOpps = new Set(); const notify = [];
  let contacts = contactsMd;
  for (const r of results) {
    if (r.kind === 'ignore') continue;
    let t = byId.get(r.thread_id);
    const oppFile = t?.opportunity || oppOf(r.job_id) || null;
    if (!t) {
      // The opportunity's name, plus the firm when another firm writes about the same role (two
      // staffing firms pitching one seat), so two threads never share a file.
      let file = threadFileName({ opportunityFile: oppFile, date: dayOf(r.at || now.toISOString()), firm: r.firm, topic: r.subject });
      if (oppFile && !oppFile.includes(slug(r.firm, 1))) file = file.replace(/\.md$/, `--${slug(r.firm, 3)}.md`);
      const taken = (f) => [...byId.values()].some((x) => x.file === f);
      // A short id suffix can collide too (two thread ids sharing their first six characters
      // once let a calendar invite overwrite an interview card), so the full thread id is the
      // last resort: a new thread never overwrites an existing card.
      if (taken(file)) { const base = file; file = base.replace(/\.md$/, `-${String(r.thread_id).slice(0, 6)}.md`); if (taken(file)) file = base.replace(/\.md$/, `-${r.thread_id}.md`); }
      t = { thread_id: r.thread_id, emails: [], sent: [], notified: false, draft: null, draft_at: null, file };
    }
    Object.assign(t, { kind: r.kind, firm: r.firm, sender_name: r.sender_name, reply_to: r.reply_to ?? null, subject: r.subject, job_id: r.job_id ?? t.job_id ?? null, match: r.match ?? t.match ?? null, opportunity: oppFile,
      cv: r.cv ?? null, new_cv: !!r.new_cv, action: r.action || '', claims: r.claims || [], audit: r.audit ?? null });
    // A re-record of the same email (a changed draft) adds no second row.
    const repeat = t.emails.some((e) => e.at === (r.at || now.toISOString()));
    if (!repeat) t.emails.push({ at: r.at || now.toISOString(), from_name: r.sender_name, summary: oneLine(r.summary) });
    // A result without a draft (a rejection after a reply) clears the old one.
    t.draft = r.draft ?? null;
    t.draft_at = r.draft ? now.toISOString() : null;
    t.status = r.mail_status || (OPEN_KINDS.has(r.kind) ? 'draft' : 'no-reply');
    if (r.kind === 'interview' && !t.notified) { notify.push(r.thread_id); t.notified = true; }
    if (r.kind === 'outreach-fit' && r.opportunity && !t.opportunity) {
      const file = `${day.replaceAll('-', '')}-${slug(r.opportunity.company, 3)}-${slug(r.opportunity.title)}.md`;
      if (opps.has(file)) { errors.push(`${r.thread_id}: opportunity ${file} exists; probable match, set job_id`); continue; }
      opps.set(file, emailOpportunity(r, file, t.file, day, by.owner));
      Object.assign(t, { opportunity: file, job_id: `email-${r.thread_id}` });
      touchedOpps.add(file);
    } else if (!repeat && t.opportunity && opps.has(t.opportunity)) {
      opps.set(t.opportunity, appendStageLog(addRelatedDoc(opps.get(t.opportunity), `../mail/${t.file}`), `| ${day} | mail | ${r.kind}${r.match === 'probable' ? ' (probable match)' : ''}: ${oneLine(r.summary)} (thread \`pipeline/mail/${t.file}\`) |`));
      touchedOpps.add(t.opportunity);
    }
    if (r.dice_contact && contacts) {
      const c = r.dice_contact;
      // Into the table, after its last row: a note under the table stays below it.
      const lines = contacts.split('\n');
      const last = lines.reduce((k, l, i) => (l.startsWith('|') ? i : k), lines.length - 1);
      lines.splice(last + 1, 0, `| ${day} | ${r.firm} | ${c.role} | ${c.structure} | ${c.location} | ${c.gates} | Card on the tracker (\`pipeline/mail/${t.file}\`) | inferred Dice |`);
      contacts = lines.join('\n');
    }
    byId.set(t.thread_id, t); touched.add(t.thread_id);
  }
  for (const s of sent) {
    const t = byId.get(s.thread_id);
    if (!t || t.sent.some((x) => x.at === s.at)) continue;
    t.sent.push({ at: s.at, text: s.text });
    t.status = 'sent';
    touched.add(t.thread_id);
    if (t.opportunity && opps.has(t.opportunity)) {
      let md = appendStageLog(opps.get(t.opportunity), `| ${dayOf(s.at)} | reply sent | ${replier} replied on the thread (\`pipeline/mail/${t.file}\`) |`);
      if (t.kind === 'outreach-fit' && /^stage: inbound$/m.test(md)) {
        md = setField(setField(md, 'stage', 'applied'), 'applied_on', `${dayOf(s.at)}\napplied_at: ${s.at}`);
      }
      // The reply was the task, whatever kind the thread has become since (a recruiter's answer
      // turns it into "reply"). No follow-up date is set after it: the loop never chases.
      if (/^next_action: Reply on the thread/m.test(md)) md = setField(setField(md, 'next_action', ''), 'next_action_due', '');
      opps.set(t.opportunity, md); touchedOpps.add(t.opportunity);
    }
  }
  if (errors.length) return { writes: [], errors, notify: [] };
  const writes = [...touched].map((id) => byId.get(id)).map((t) => ({ path: `pipeline/mail/${t.file}`, content: renderThread(t, { now, ...by }) }));
  for (const f of touchedOpps) writes.push({ path: `pipeline/opportunities/${f}`, content: opps.get(f) });
  if (contacts !== contactsMd) writes.push({ path: 'pipeline/channels/dice/recruiter-contacts.md', content: contacts });
  if (touched.size) writes.push({ path: 'pipeline/mail/README.md', content: renderIndex([...byId.values()], { outbound, notes, now, created, ...by }) });
  return { writes, errors: [], notify };
}
