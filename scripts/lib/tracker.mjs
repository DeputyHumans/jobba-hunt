// Applications tracker: one HTML dashboard (published to bikeshed, or written locally), rebuilt
// from the hunt state on every loop tick. Pure functions only: buildTracker (state -> model),
// renderTrackerHtml (model -> one self-contained HTML file, no script), publishTracker (bikeshed
// CLI calls through an injected runner) and watchEvents (comment-watch dedupe). scripts/tracker.mjs
// does the file and process work. Private data (answer bank, form values, account emails, phone,
// standing rate) is never read into the model, so it cannot reach the page.
//
// Workspace values (time zone, business hours, caps, silent days, the operator's name, brand)
// are read only when a function runs and no value was passed, never at import, so tests inject
// their own.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseComp } from './rate.mjs';
import { brandFile } from './paths.mjs';
import { loadConfig } from './config.mjs';
import { CV_FILE_RE, applicationEmail, operatorName, person, preferences, schedule, tz as profileTz } from './profile.mjs';
import { loadMark, markSvg, wordmarkName } from './brand-mark.mjs';

// Generic marketing clichés: never in generated prose (summary, headings, chart labels).
// preferences.voice.banned extends the list (bannedWords).
export const BANNED = ['seamless', 'robust', 'leverage', 'comprehensive', 'cutting-edge', 'transformative', 'synergy', 'world-class',
  'best-in-class', 'state-of-the-art', 'empower', 'unlock', 'delve', 'holistic', 'innovative', 'turnkey', 'game-changer', 'revolutionary',
  'disruptive', 'groundbreaking', 'next-level', 'paradigm', 'passionate', 'guaranteed', 'journey', 'navigate', 'landscape', 'elevate',
  'streamline', 'harness', 'crucial', 'pivotal', 'realm', 'testament', 'foster', 'furthermore', 'moreover', 'additionally', 'simply', 'truly'];
export const bannedWords = (extra = preferences().voice?.banned) => [...new Set([...BANNED, ...(Array.isArray(extra) ? extra.map((w) => String(w).toLowerCase()) : [])])];

// ---------- parsing ----------
export { parseComp };

export function parseFrontmatter(md) {
  const m = String(md || '').match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

// ---------- time ----------
// Every day, time and clock on the page is in the user's time zone (preferences.schedule.tz).
// buildTracker and renderTrackerHtml set CLK for the zone of the model they work on.
const CLOCKS = new Map();
function clock(zone) {
  if (CLOCKS.has(zone)) return CLOCKS.get(zone);
  const fmt = (locale, o) => new Intl.DateTimeFormat(locale, { timeZone: zone, ...o });
  const DAY = fmt('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const TIME = fmt('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const SHORT = fmt('en-GB', { day: 'numeric', month: 'short' });
  const LONG = fmt('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const WALL = fmt('en-US', { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const WD = fmt('en-US', { weekday: 'short' });
  const c = { zone, DAY, TIME, SHORT, LONG, WALL, WD };
  CLOCKS.set(zone, c);
  return c;
}
let CLK = clock('UTC');
const dayOf = (iso) => CLK.DAY.format(new Date(iso));
const timeOf = (iso) => CLK.TIME.format(new Date(iso));
const minuteOf = (iso) => { const [h, m] = timeOf(iso).split(':').map(Number); return h * 60 + m; };
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const shortDate = (iso) => CLK.SHORT.format(new Date(iso));
const dueDay = (ymd) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${ymd}T12:00:00Z`));
const longDate = (iso) => CLK.LONG.format(new Date(iso));
// A local wall-clock time ("2026-11-09T13:00") as a UTC instant, DST included. A bare local
// date takes noon, so it lands on that local day in every window.
const wallMs = (ms) => { const p = Object.fromEntries(CLK.WALL.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:00Z`); };
function localIso(local) {
  const guess = Date.parse(`${local.length === 10 ? `${local}T12:00` : local}:00Z`);
  let ms = guess - (wallMs(guess) - guess);
  ms = guess - (wallMs(ms) - ms); // a second pass settles a time next to the DST change
  return new Date(ms).toISOString();
}
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// The zone's short name for labels: "PT", "ET", "CT" where one exists, else "GMT+2" or "UTC".
export function zoneLabel(zone, at = new Date()) {
  if (/^(UTC|Etc\/UTC|Etc\/GMT|GMT|Etc\/Zulu|Zulu)$/i.test(zone)) return 'UTC';
  const part = (style) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style }).formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } };
  const generic = part('shortGeneric');
  if (/^[A-Z]{1,5}$/.test(generic)) return generic;
  return part('short') || zone;
}

// Business hours for the pulse, from the tick schedule: minutes after local midnight and the
// weekdays (0 = Sunday) the loop runs on.
const toMin = (s) => { const t = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return t ? Number(t[1]) * 60 + Number(t[2]) : null; };
export const hoursFrom = (s = schedule() || {}) => ({ open: toMin(s.tick_start) ?? 480, close: toMin(s.tick_end) ?? 1080, days: Array.isArray(s.days) && s.days.length ? s.days : [1, 2, 3, 4, 5] });

// ---------- interviews ----------
// One optional opportunity line, a JSON array kept as a string by parseFrontmatter:
// interviews: [{"at":"2026-11-09T13:00","booked_on":"2026-11-06","status":"held","round":"...","with":"..."}]
// `at` is local time, `booked_on` a local date. A missing or broken line means none.
const IV_STATUS = { booked: 'booked', held: 'held', canceled: 'canceled', cancelled: 'canceled' };
const okLocal = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}:00Z`));
const okDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
export function parseInterviews(raw) {
  let list = raw;
  if (!Array.isArray(list)) { try { list = JSON.parse(String(raw ?? '')); } catch { return []; } }
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && typeof x === 'object' && okLocal(String(x.at ?? '').slice(0, 16)) && IV_STATUS[String(x.status ?? '').toLowerCase()])
    .map((x) => ({ at: String(x.at).slice(0, 16), booked_on: okDay(String(x.booked_on ?? '')) ? String(x.booked_on) : null, status: IV_STATUS[String(x.status).toLowerCase()],
      round: x.round ? String(x.round) : null, with: x.with ? String(x.with) : null }));
}
// A booked or held interview shows the card as a screen while the file still says applied.
const stageOf = (stage, ivs) => (!stage || stage === 'applied') && ivs.some((i) => i.status !== 'canceled') ? 'screening' : stage || 'applied';

// ---------- run labels ----------
// A tick's label comes from its query: the query's `label` when set, else its id in words.
// Each config is searches.json or dice-searches.json (the canary included).
const idWords = (id) => String(id || '').replace(/^dice-/, '').replace(/[-_]+/g, ' ').trim();
export function runLabels(configs = []) {
  const out = { 'dice-sweep': 'every Dice query' };
  for (const cfg of configs) {
    const canary = cfg?.canary?.id ? [cfg.canary] : [];
    for (const q of [...canary, ...(cfg?.queries || [])]) {
      if (!q?.id) continue;
      const words = idWords(q.id);
      out[q.id] = q.label || (q === cfg.canary && !/canary/i.test(words) ? `canary: ${words}` : words);
    }
  }
  return out;
}
export const runLabel = (labels, id) => labels[id] || idWords(id) || 'unnamed query';

// ---------- caps ----------
// The caps shown on the page: every cap in config/limits.json, named here when known.
const CAP_LABELS = [
  ['linkedin_jobs', 'ticks_per_day', 'ticks_per_day', 'Loop checks'], ['linkedin_jobs', 'searches_per_day', 'searches_per_day', 'Searches'],
  ['linkedin_jobs', 'job_views_per_day', 'job_views_per_day', 'Job views'], ['linkedin_jobs', 'sweeps_per_day', 'sweeps_per_day', 'Full sweeps'],
  ['linkedin_apply', 'applications_per_day', 'easy_applications', 'Easy Apply applications'],
  ['linkedin_apply', 'apply_page_loads_per_day', 'apply_page_loads', 'Apply page loads'], ['ats_apply', 'applications_per_day', 'ats_applications', 'ATS applications'],
  ['dice_jobs', 'ticks_per_day', 'dice_ticks', 'Dice checks'], ['dice_jobs', 'searches_per_day', 'dice_searches', 'Dice searches'],
  ['dice_jobs', 'job_views_per_day', 'dice_views', 'Dice job views'], ['dice_jobs', 'sweeps_per_day', 'dice_sweeps', 'Dice full sweeps'],
  ['dice_apply', 'applications_per_day', 'dice_applications', 'Dice Easy Apply applications'], ['dice_apply', 'apply_page_loads_per_day', 'dice_apply_page_loads', 'Dice apply page loads'],
];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function capRows(limits = {}) {
  const has = (p, a) => isObj(limits?.[p]?.[a]);
  const known = CAP_LABELS.filter(([p, a]) => has(p, a));
  const extra = Object.entries(limits || {}).filter(([p, v]) => !p.startsWith('_') && isObj(v))
    .flatMap(([p, acts]) => Object.keys(acts).filter((a) => !a.startsWith('_') && isObj(acts[a]) && !CAP_LABELS.some(([pp, aa]) => pp === p && aa === a))
      .map((a) => [p, a, `${p}.${a}`, cap(`${p} ${a}`.replace(/_/g, ' ').replace(/ per day$/, ''))]));
  return [...known, ...extra];
}

// ---------- model ----------
const FINAL_APPLIED = new Set(['submitted', 'submitted-by-hand']);
const REPLY_STAGES = new Set(['screening', 'nda', 'proposal', 'negotiating', 'won']);
const CHANNEL = { easy: 'Easy Apply', 'dice-easy': 'Dice Easy Apply', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', appcast: 'appcast form', workday: 'Workday', paycor: 'Paycor', paylocity: 'Paylocity', workable: 'Workable', rippling: 'Rippling', walmart: 'Walmart careers' };
const SOURCE = { linkedin: 'LinkedIn', dice: 'Dice' };
const srcOf = (j) => j.source || 'linkedin';
const GATE_LABEL = { G1: 'the engagement structure', G2: 'location', G3: 'seniority', G4: 'a must-have outside the record' };
const dropLabels = (who) => ({
  'company-excluded': 'Expert network or excluded company', 'title-excluded': 'Title out of scope', onsite: 'On-site',
  'not-leadership': 'Not a leadership role', 'not-senior': 'Not senior or not engineering', 'outside-record': 'Stack outside the record',
  'stack-excluded': 'Excluded stack', 'full-time-excluded': 'Full-time, not accepted', 'structure-excluded': 'Engagement structure not accepted',
  'rate-below-floor': 'Rate under the IC floor', 'salary-below-ft-floor': 'Full-time pay under the floor',
  'full-time-no-scope-signal': 'Full-time, no fractional signal', 'canary-only': 'Canary only', 'hybrid-check-travel': 'Hybrid, travel unclear',
  'onsite-metro-ask': `Office in the home metro, ${who} decides`,
  'full-time-ask': `Full-time leadership, ${who} decides`, 'full-time-ic-ask': `Full-time IC, ${who} decides`, 'location-unclear': 'Location unclear', 'scope-unconfirmed': 'Scope unconfirmed',
});
const DECISIVE = ['company-excluded', 'title-excluded', 'onsite', 'not-leadership', 'not-senior', 'outside-record', 'stack-excluded', 'full-time-excluded', 'structure-excluded', 'rate-below-floor', 'salary-below-ft-floor', 'full-time-no-scope-signal', 'canary-only'];
// The funnel sits right under Status: it is the first question the page answers.
export const HEADINGS = ['Status', 'Funnel', 'Summary', 'Loop pulse', 'Applications', 'Needs you', 'Pipeline', 'Not a fit', 'Passed on', 'Filtered before review', 'Market read', 'Loop health', 'Recent activity', 'CV inventory'];
export const EMPTY = {
  applications: 'No applications yet.', needs: 'Nothing waiting on you.', not_a_fit: 'No roles failed a gate.', logged: 'Nothing logged below the bar.',
  passed: 'Nothing passed on yet.', filtered: 'Nothing filtered yet.', market: 'No comp figures seen yet.', interviews: 'No interviews yet.', activity: 'Nothing logged yet.', cvs: 'No CV variants yet.',
};

// Every role ends in exactly one outcome, the one encoding the charts share: the accent is
// still in play, gray is out, and a darker gray got further (tracker.css).
export const OUTCOMES = [['applied', 'Applied'], ['waiting', 'Waiting on you'], ['pending', 'Not yet scored'], ['passed', 'Passed on'],
  ['below', 'Below the bar'], ['notfit', 'Not a fit'], ['filtered', 'Filtered before review']];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES);
const STAGE_LABEL = { applied: 'Applied', screening: 'Screen', nda: 'NDA', proposal: 'Proposal', negotiating: 'Terms', won: 'Won', lost: 'Lost', withdrawn: 'Withdrawn', rejected: 'Rejected' };
const IV_LABEL = { booked: 'Booked', held: 'Held', canceled: 'Canceled' };
const LANE_GAP = 4; // score points between two dots in one lane of the strip plot

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const tally = (vals) => vals.reduce((m, v) => ({ ...m, [v]: (m[v] || 0) + 1 }), {});
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stripIds = (s) => String(s).replace(/^\s*(C\d+\s*,\s*)*C\d+\s*:\s*/, '').trim();
const isBareId = (s) => /^\s*C\d+\s*$/.test(String(s));

// Retired claims (claim-bank "Retired") never surface: a retired bare ID is skipped, and so
// is any reason that cites one.
let RETIRED = new Set();
const citesRetired = (s) => [...String(s).matchAll(/\bC\d+\b/g)].some((m) => RETIRED.has(m[0]));
function whyOf(t, claims) {
  const wf = t?.why_fit;
  const items = (Array.isArray(wf) ? wf : wf ? [String(wf)] : []).filter((s) => !(isBareId(s) ? RETIRED.has(s.trim()) : citesRetired(s)));
  if (!items.length) return null;
  if (items.every(isBareId)) return items.slice(0, 2).map((id) => claims[id.trim()]).filter(Boolean).join(' ') || null;
  const first = items.find((s) => !isBareId(s));
  return first ? stripIds(first) : null;
}
const quoted = (s) => (String(s).match(/'([^']{8,})'/) || String(s).match(/"([^"]{8,})"/) || [])[1];
function rejectReason(t) {
  const flag = (t.red_flags || []).find((f) => /^G\d[^:]*fail/i.test(f)) || (t.red_flags || [])[0] || (t.gaps || [])[0] || '';
  return (quoted(flag) || flag.replace(/^G\d[^:]*:\s*/i, '')).trim();
}
// The CV's share name from its file name (<prefix>-cv-<share>.pdf, any prefix).
const shareOf = (cv) => {
  if (!cv) return null;
  const base = String(cv).split('/').pop();
  const m = base.match(CV_FILE_RE);
  return m ? m[2] : base.replace(/\.(pdf|docx|html)$/, '');
};
// When the posting went up, so the page can say how soon after posting the application went
// out. Dice gives the post date. LinkedIn gives "3 hours ago" as of the page fetch, which means
// 3 to 4 hours: `at` is the latest the posting can have gone up, and `unit` is LinkedIn's precision.
const UNIT_MS = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 };
const UNIT_SHORT = { hour: 'h', day: 'd', week: 'w', month: 'mo' };
function postedOf(j) {
  const d = j.detail || {};
  if (d.date_posted && !Number.isNaN(Date.parse(d.date_posted))) return { at: new Date(d.date_posted).toISOString(), unit: null, reposted: false };
  const m = String(d.posted_text || '').trim().match(/^(reposted\s+)?(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i);
  if (!m || !d.fetched_at || Number.isNaN(Date.parse(d.fetched_at))) return null;
  const unit = m[3].toLowerCase();
  return { at: new Date(Date.parse(d.fetched_at) - Number(m[2]) * UNIT_MS[unit]).toISOString(), unit: unit === 'minute' ? null : unit, reposted: !!m[1],
    text: m[0], seen: d.fetched_at };
}
const lastAttempt = (j) => (j.application?.attempts || []).at(-1) || null;
const compOf = (j) => j.triage?.comp_seen || j.detail?.comp_text || null;
// A company field that is an email address (some boards list the recruiter's address there)
// shows only its domain: the page never carries a third party's address.
export const coName = (c) => String(c || '').replace(/[\w.+-]+@([\w-]+\.[\w.-]+)/g, '$1');
const role = (j) => ({ id: j.job_id, title: j.title, company: coName(j.company), url: j.url, tier: j.triage?.tier ?? null, score: j.triage?.score ?? null, source: srcOf(j), lane: j.triage?.lane || null });
const stats = (ranges) => {
  if (!ranges.length) return { n: 0 };
  const mids = ranges.map((r) => (r.min + r.max) / 2).sort((a, b) => a - b);
  const h = Math.floor(mids.length / 2);
  return { n: ranges.length, min: Math.min(...ranges.map((r) => r.min)), max: Math.max(...ranges.map((r) => r.max)), median: mids.length % 2 ? mids[h] : (mids[h - 1] + mids[h]) / 2 };
};

// A tailored CV and letter waiting for the user's approval: application.docs_review (a status
// string, or { status, url }) not yet approved, or a review doc listed in
// data/tracker/review-docs.json for the job, with no application.docs_approved_at.
function docsReviewOf(j, reviews) {
  const app = j.application || {};
  if (app.docs_approved_at) return null;
  const dr = app.docs_review;
  const status = typeof dr === 'string' ? dr : dr?.status;
  const listed = reviews?.[j.job_id];
  if (!dr && !listed) return null;
  if (status === 'approved' || status === 'superseded' || status === 'auto') return null;
  const parts = listed ? (listed.doc_id ? { docs: listed } : listed) : {};
  return {
    url: (dr && typeof dr === 'object' && dr.url) || parts.cv?.url || parts.docs?.url || null,
    letter_url: (dr && typeof dr === 'object' && dr.letter_url) || parts.letter?.url || null,
  };
}

// One action-log row for the page: short values only, addresses and phones scrubbed.
const ACTOR_LABEL = { user: 'You', agent: 'Agent', script: 'Script' };
function detailText(d) {
  if (d == null) return '';
  const s = typeof d === 'string' ? d : isObj(d) ? Object.entries(d).filter(([, v]) => v == null || typeof v !== 'object').map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') : String(d);
  const t = scrub(s).replace(/\s+/g, ' ').trim();
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

export function buildTracker({
  state, opportunities = [], usage = null, runs = [], claims = {}, retired = null, variants = [], overrides = [], letters = {}, mail = [],
  actions = [], reviews = {}, nextCheck = null, hours = null, tz = null, limits = null, silentDays = null, readCardDays = null, resetHour = null, operator = null,
  allowEmail = null, now = new Date(),
}) {
  const zone = tz || profileTz() || 'UTC';
  CLK = clock(zone);
  const sched = (!hours || resetHour == null) ? (schedule() || {}) : {};
  const biz = { ...hoursFrom(sched), ...(hours || {}) };
  const capsCfg = limits || loadConfig('limits.json', { required: false });
  const trackerCfg = (silentDays == null || readCardDays == null) ? loadConfig('tracker.json', { required: false }) : {};
  const SILENT_DAYS = silentDays ?? trackerCfg.silent_days ?? 5;
  // A "Read it on <board>" card (platform-message) clears after this many business days.
  const READ_CARD_DAYS = readCardDays ?? trackerCfg.read_card_days ?? 5;
  const RESET_HOUR = resetHour ?? sched.reset_hour ?? 4;
  const who = operator || operatorName();
  ALLOW_EMAIL = (allowEmail ?? applicationEmail()) || null;
  const DROP_LABEL = dropLabels(who);
  let m_pulse = null;
  RETIRED = retired || new Set(Object.keys(claims).filter((id) => /^\**retired/i.test(claims[id])));
  const jobs = Object.values(state.jobs);
  const today = dayOf(now);
  const weekAgo = now.getTime() - 7 * 864e5;
  const opp = Object.fromEntries(opportunities.map((o) => [String(o.job_id), o]));
  const cvUrl = Object.fromEntries(variants.filter((v) => v.url).map((v) => [v.share, v.url]));

  const searched = jobs.filter((j) => FINAL_APPLIED.has(j.application?.status))
    .map((j) => {
      const t = j.triage || {};
      const o = opp[j.job_id] || {};
      const att = (j.application.attempts || []).filter((a) => FINAL_APPLIED.has(a.outcome)).at(-1) || lastAttempt(j) || {};
      const cv = shareOf(j.application.cv);
      return {
        ...role(j), date: j.application.submitted_at, posted: postedOf(j), comp: compOf(j), hours: t.hours_seen || null, cv, cv_url: cvUrl[cv] || null, cv_note: o.cv_note || null,
        letter: !!(j.application.cover_pdf || j.application.cover_note), letter_url: letters[j.job_id] || null,
        channel: att.mode === 'by-hand' ? 'By hand' : CHANNEL[att.channel] || SOURCE[srcOf(j)], stage: stageOf(o.stage, parseInterviews(o.interviews)), updated: o.updated || null,
        why: whyOf(t, claims),
        gaps: (t.gaps || []).slice(0, 2), flags: (t.red_flags || []).slice(0, 2), archetype: t.archetype || null,
        evidence: att.outcome === 'submitted' ? `${SOURCE[srcOf(j)]} confirmation captured` : att.mode === 'by-hand' ? `Submitted by ${who}` : null,
      };
    });
  // Inbound recruiter roles have no search record: the opportunity file is the card.
  const known = new Set(jobs.map((j) => String(j.job_id)));
  const inbound = opportunities.filter((o) => !known.has(String(o.job_id)) && (o.applied_at || o.applied_on)).map((o) => ({
    id: String(o.job_id), title: o.role || o.title, company: o.company || '', url: o.url || null, tier: null, score: null, source: 'email', lane: null,
    date: o.applied_at || (o.applied_on ? localIso(o.applied_on) : null), date_only: !o.applied_at && !!o.applied_on, posted: null, comp: o.comp_seen || null, hours: null, cv: o.cv || null, cv_url: cvUrl[o.cv] || null, cv_note: o.cv_note || null,
    channel: 'Recruiter email', stage: stageOf(o.stage, parseInterviews(o.interviews)), updated: o.updated || null,
    why: null, gaps: [], flags: [], archetype: null, evidence: `Replied by ${who}`,
  }));
  const applications = [...searched, ...inbound].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  for (const a of applications) {
    a.heard = heardOf(a, mail, now, SILENT_DAYS);
    // When the rejection landed: the rejection email, else the lost file's updated day, else the application.
    a.rejected_at = a.heard.kind !== 'rejected' ? null : a.heard.at || (okDay(String(a.updated)) ? localIso(a.updated) : a.date);
  }
  // Interviews from the opportunity files, upcoming first (soonest on top), then held and
  // canceled (newest on top). Text is scrubbed like mail: no address, phone or meeting link.
  const appById = Object.fromEntries(applications.map((a) => [String(a.id), a]));
  const IV_RANK = { booked: 0, held: 1, canceled: 2 };
  const interviews = Object.values(opp).flatMap((o) => {
    const a = appById[String(o.job_id)];
    const j = state.jobs[o.job_id];
    return parseInterviews(o.interviews).map((iv) => ({
      ...iv, id: String(o.job_id), card: !!a, title: a?.title || j?.title || o.role || o.title || '', company: coName(a?.company || j?.company || o.company || ''),
      round: ivText(iv.round), with: ivText(iv.with), at_iso: localIso(iv.at), booked_iso: iv.booked_on ? localIso(iv.booked_on) : null,
    }));
  }).sort((a, b) => IV_RANK[a.status] - IV_RANK[b.status] || (a.status === 'booked' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)) || a.id.localeCompare(b.id));

  const needs = [];
  for (const j of jobs) {
    const t = j.triage;
    const app = j.application;
    if (app?.status === 'submit-unverified') { needs.push({ ...role(j), kind: 'unverified', detail: srcOf(j) === 'dice' ? 'Submit not confirmed. Check Dice, Applied Jobs.' : 'Submit not confirmed. Check LinkedIn, My jobs, Applied.' }); continue; }
    // closed: the posting stopped taking applications before the submit.
    const done = app && (FINAL_APPLIED.has(app.status) || ['already-applied', 'closed'].includes(app.status));
    const undecided = !!(t && ['A', 'B'].includes(t.tier) && !t.decision && j.status === 'triaged');
    // A tailored CV and letter waiting for approval: one card, which also says when the role
    // itself still needs a decision.
    const review = !done && t?.decision !== 'skip' ? docsReviewOf(j, reviews) : null;
    if (review) { needs.push({ ...role(j), kind: 'docs_review', link: review.url, letter_link: review.letter_url, also_decide: undecided }); continue; }
    if (undecided) { needs.push({ ...role(j), kind: 'decision', detail: whyOf(t, claims) }); continue; }
    if (!app || done) continue;
    // Skipped after approval (nothing sent, then "Skip"): no card.
    if (t?.decision === 'skip') continue;
    const last = lastAttempt(j);
    if (last?.outcome === 'needs_answers') {
      // Labels only: options can hold account emails and filled values the standing rate.
      const questions = (Array.isArray(last.detail) ? last.detail : []).map((q) => String(q.label || '').replace(/\s*\*\s*$/, '').trim()).filter(Boolean);
      needs.push({ ...role(j), kind: 'needs_answers', questions });
    } else if (last?.outcome === 'manual') {
      needs.push({ ...role(j), kind: 'manual', link: app.ats_url || j.url, detail: typeof last.detail === 'string' ? last.detail : 'Finish by hand',
        cv: shareOf(app.cv), cv_url: cvUrl[shareOf(app.cv)] || null, letter: !!(app.cover_pdf || app.cover_note), letter_url: letters[j.job_id] || null });
    } else if (app.status === 'approved') {
      needs.push({ ...role(j), kind: 'queued', detail: last?.outcome === 'refused' ? 'Approved, waiting for the daily cap to reset' : 'Approved, not yet submitted' });
    }
  }
  // Hunt mail (docs/inbox-scan-design.md): an open thread is a card. The reply-to address is
  // never read into the model; addresses and phones in the text are scrubbed.
  const onPage = new Set([...applications.map((a) => String(a.id)), ...jobs.map((j) => String(j.job_id))]);
  for (const t of mail) {
    const kind = MAIL_KIND[t.kind];
    if (t.status !== 'draft' || !kind) continue;
    if (t.kind === 'receipt' && state.jobs[t.job_id]?.application?.status !== 'submit-unverified') continue;
    if (kind === 'read' && businessDaysSince(t.emails[0]?.at, now) >= READ_CARD_DAYS) continue;
    const cv = t.cv ? shareOf(t.cv) : null;
    needs.push({ id: `mail-${t.thread_id}`, mail: true, kind, title: scrub(t.subject), company: scrub(t.firm), url: null, tier: null, score: null,
      from: scrub(t.sender_name), summary: scrub(t.emails.at(-1)?.summary), job: t.job_id && onPage.has(String(t.job_id)) ? String(t.job_id) : null,
      // A match the session was unsure of (match: probable) is shown as such, never as the role.
      probable: t.match === 'probable', job_title: t.job_id ? scrub(state.jobs?.[t.job_id]?.title || '') : '',
      cv, cv_url: cv ? cvUrl[cv] || null : null, new_cv: !!t.new_cv, action: scrub(t.action), draft: t.draft ? scrub(t.draft) : null });
  }
  const ORDER = { security: -1, unverified: 0, needs_answers: 1, manual: 2, reply: 2.5, close: 2.6, read: 2.7, docs_review: 2.8, decision: 3, queued: 4 };
  needs.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (b.score ?? 0) - (a.score ?? 0));

  const byScored = (a, b) => (b.triage.scored_at || '').localeCompare(a.triage.scored_at || '') || b.triage.score - a.triage.score;
  const not_a_fit = jobs.filter((j) => j.triage?.tier === 'reject' && !j.triage.decision).sort(byScored).map((j) => ({
    ...role(j), date: j.triage.scored_at, gates: Object.entries(j.triage.gates || {}).filter(([, v]) => v === 'fail').map(([k]) => k), reason: rejectReason(j.triage), comp: compOf(j),
  }));
  const logged = jobs.filter((j) => j.triage?.tier === 'C' && !j.triage.decision).sort(byScored).map((j) => ({
    ...role(j), date: j.triage.scored_at, reason: cap(String((j.triage.red_flags || [])[0] || (j.triage.gaps || [])[0] || '').replace(/^G\d[^:]*:\s*/i, '')), comp: compOf(j),
  }));
  const passed = jobs.filter((j) => ['skip', 'watch'].includes(j.triage?.decision))
    .sort((a, b) => (b.triage.decided_at || '').localeCompare(a.triage.decided_at || '') || a.job_id.localeCompare(b.job_id))
    .map((j) => ({ ...role(j), decision: j.triage.decision, note: j.triage.note || null, date: j.triage.decided_at }));

  const drops = jobs.filter((j) => j.prefilter?.verdict === 'drop' && !j.triage);
  const reasonOf = (j) => { const r = j.prefilter.reasons || []; const code = DECISIVE.find((c) => r.includes(c)) || r[0] || 'other'; return DROP_LABEL[code] || code; };
  const counts = {};
  for (const j of drops) counts[reasonOf(j)] = (counts[reasonOf(j)] || 0) + 1;
  const filtered = {
    by_reason: Object.entries(counts).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    items: drops.sort((a, b) => (b.first_seen || '').localeCompare(a.first_seen || '')).map((j) => ({ ...role(j), reason: reasonOf(j), date: j.first_seen })),
  };

  const inDay = (iso) => !!iso && dayOf(iso) === today;
  const inWeek = (iso) => !!iso && Date.parse(iso) >= weekAgo;
  const needIds = new Set(needs.map((n) => n.id));
  const outcomeOf = (j) => {
    if (FINAL_APPLIED.has(j.application?.status)) return 'applied';
    if (needIds.has(j.job_id)) return 'waiting';
    const t = j.triage;
    if (!t) return j.prefilter?.verdict === 'drop' ? 'filtered' : 'pending';
    if (['skip', 'watch'].includes(t.decision) || j.application?.status === 'already-applied') return 'passed';
    if (t.tier === 'reject') return 'notfit';
    if (t.tier === 'C') return 'below';
    return 'waiting';
  };
  const outcomeCount = tally(jobs.map(outcomeOf));
  const outcomes = OUTCOMES.map(([key, label]) => ({ key, label, count: outcomeCount[key] || 0 }));

  // Strip plot: lowest score first, each dot in the first lane where it clears the last one.
  const laneEnds = [];
  const scored = jobs.filter((j) => Number.isFinite(j.triage?.score))
    .sort((a, b) => a.triage.score - b.triage.score || a.job_id.localeCompare(b.job_id))
    .map((j) => {
      let lane = laneEnds.findIndex((s) => j.triage.score - s >= LANE_GAP);
      if (lane < 0) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = j.triage.score;
      return { ...role(j), outcome: outcomeOf(j), lane };
    });

  // 14 local days ending today, counted from one pass over the jobs.
  const [y, mo, d] = today.split('-').map(Number);
  const activity = Array.from({ length: 14 }, (_, i) => {
    const dt = new Date(Date.UTC(y, mo - 1, d - 13 + i, 12));
    return { day: dt.toISOString().slice(0, 10), weekend: [0, 6].includes(dt.getUTCDay()), seen: 0, scored: 0, applied: 0 };
  });
  const slot = Object.fromEntries(activity.map((a) => [a.day, a]));
  for (const j of jobs) {
    if (j.first_seen && slot[dayOf(j.first_seen)]) slot[dayOf(j.first_seen)].seen += 1;
    if (j.triage?.scored_at && slot[dayOf(j.triage.scored_at)]) slot[dayOf(j.triage.scored_at)].scored += 1;
    if (FINAL_APPLIED.has(j.application?.status) && j.application.submitted_at && slot[dayOf(j.application.submitted_at)]) slot[dayOf(j.application.submitted_at)].applied += 1;
  }

  const funnelFor = (win) => [
    ['seen', 'Seen', jobs.filter((j) => win(j.first_seen)).length],
    // A viewed role passed the card prefilter even when its detail page dropped it later.
    ['kept', 'Kept by the prefilter', jobs.filter((j) => win(j.first_seen) && (j.prefilter?.verdict !== 'drop' || j.detail)).length],
    ['viewed', 'Viewed', jobs.filter((j) => win(j.detail?.fetched_at)).length],
    ['triaged', 'Scored', jobs.filter((j) => win(j.triage?.scored_at)).length],
    ['ab', 'Tier A or B', jobs.filter((j) => win(j.triage?.scored_at) && ['A', 'B'].includes(j.triage.tier)).length],
    ['applied', 'Applied', jobs.filter((j) => FINAL_APPLIED.has(j.application?.status) && win(j.application.submitted_at)).length],
  ].map(([key, label, count]) => ({ key, label, count }));

  // After the submit: interviews booked (by booking day) and held (by interview time), then
  // rejections on tracker applications (by rejection date), a share of Applied.
  const afterFor = (win) => [
    ['booked', 'Interview booked', interviews.filter((i) => win(i.booked_iso)).length],
    ['held', 'Interview held', interviews.filter((i) => i.status === 'held' && win(i.at_iso)).length],
    ['rejected', 'Rejected', applications.filter((a) => win(a.rejected_at)).length],
  ].map(([key, label, count]) => ({ key, label, count }));
  const share = (n, base) => (base?.count ? Math.round((100 * n) / base.count) : null);
  const weekRows = [...funnelFor(inWeek), ...afterFor(inWeek)];
  const todayRows = [...funnelFor(inDay), ...afterFor(inDay)];
  const funnelRows = weekRows.map((s, i, all) => ({
    key: s.key, label: s.label, week: s.count, today: todayRows[i].count,
    ...(s.key === 'rejected' ? { pct_prev: null, pct_applied: share(s.count, all.find((r) => r.key === 'applied')) } : { pct_prev: i ? share(s.count, all[i - 1]) : null }),
  }));

  const comps = jobs.filter((j) => j.detail || j.triage).map((j) => ({ j, c: parseComp(compOf(j)) })).filter((x) => x.c)
    .map(({ j, c }) => ({ ...role(j), ...c, text: compOf(j), outcome: outcomeOf(j) }))
    .sort((a, b) => a.min - b.min || a.max - b.max || a.id.localeCompare(b.id));
  const viewed = jobs.filter((j) => j.detail);
  const market = {
    hourly: stats(comps.filter((c) => c.unit === 'hour')), annual: stats(comps.filter((c) => c.unit === 'year')), daily: stats(comps.filter((c) => c.unit === 'day')),
    structure: tally(viewed.filter((j) => srcOf(j) === 'linkedin').map((j) => j.detail.employment_type || 'Not tagged')), apply: tally(viewed.map((j) => j.detail.apply?.type || 'unknown')), items: comps,
  };
  const gate_fails = Object.entries(tally(not_a_fit.flatMap((r) => r.gates))).map(([gate, count]) => ({ gate, label: cap(GATE_LABEL[gate] || gate), count }))
    .sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate));

  const runsSorted = [...runs].sort((a, b) => a.at.localeCompare(b.at));
  const last = runsSorted.at(-1) || null;
  // --next-check is "YYYY-MM-DD HH:MM" local time, or a bare HH:MM for today. The page names the
  // day too, so a Friday-evening firing reads "Mon 2 Nov, 08:00", not "08:00". Only a check due
  // today gets a mark on today's clocks.
  const nm = String(nextCheck || '').match(/^(?:(\d{4}-\d{2}-\d{2})[T ])?(\d{1,2}):(\d{2})$/);
  const nextDay = nm ? nm[1] || today : null;
  const nextLabel = nm ? `${dueDay(nextDay)}, ${nm[2].padStart(2, '0')}:${nm[3]}` : null;
  const nextMin = nm && nextDay === today ? Number(nm[2]) * 60 + Number(nm[3]) : null;
  const health = {
    last, next_check: nextLabel, runs_today: runsSorted.filter((r) => inDay(r.at)).length, today_runs: runsSorted.filter((r) => inDay(r.at)).reverse(),
    halt_until: state.halt_until && Date.parse(state.halt_until) > now.getTime() ? state.halt_until : null,
    dice_halt_until: state.sources?.dice?.halt_until && Date.parse(state.sources.dice.halt_until) > now.getTime() ? state.sources.dice.halt_until : null,
    caps: usage ? capRows(capsCfg).map(([p, a, key, label]) => ({ key, label, used: usage[p]?.[a]?.count ?? 0, max: usage[p]?.[a]?.max ?? capsCfg?.[p]?.[a]?.max ?? 0 })) : [],
    reset_label: `${String(RESET_HOUR).padStart(2, '0')}:00`,
    overrides: overrides.filter((o) => inDay(o.at)),
  };
  // Today's runs on the local clock: at least 06:00 to 20:00, widened to whole even hours.
  const tlRuns = runsSorted.filter((r) => inDay(r.at)).map((r) => ({ min: minuteOf(r.at), label: r.label, new: r.summary?.new ?? 0, views: r.summary?.views ?? 0, aborted: r.aborted || null, source: r.source || 'linkedin' }));
  const marks = [...tlRuns.map((r) => r.min), ...(nextMin == null ? [] : [nextMin])];
  const startH = Math.min(6, ...marks.map((x) => Math.floor(x / 120) * 2));
  health.timeline = { start_h: startH, end_h: Math.max(20, ...marks.map((x) => Math.ceil((x + 1) / 120) * 2)), runs: tlRuns, next_min: nextMin };

  // Loop pulse: today's checks per source on the local clock, what each one did, the last one,
  // the next one, applications sent, and in-hours stretches with no check (a blocked loop shows
  // up as a gap, not as silence).
  const runRow = (r) => ({
    min: minuteOf(r.at), time: timeOf(r.at), source: r.source || 'linkedin', kind: r.summary?.kind || r.kind, label: r.label,
    cards: r.cards ?? null, new: r.summary?.new ?? 0, views: r.summary?.views ?? 0, pending: r.summary?.pending_triage ?? 0,
    aborted: r.aborted || null, false_login: !!r.summary?.false_login,
  });
  const pRuns = runsSorted.filter((r) => inDay(r.at)).map(runRow);
  const pApps = applications.filter((a) => inDay(a.date)).map((a) => ({ min: minuteOf(a.date), time: timeOf(a.date), id: a.id, title: a.title, company: a.company, channel: a.channel }))
    .sort((a, b) => a.min - b.min);
  // The pulse ends at the newest event, not the render time, so a publish with no new data stays
  // a no-op (a render-time "now" line would make every publish a new version).
  const edgeMin = [...pRuns.map((r) => r.min), ...pApps.map((a) => a.min)].reduce((a, b) => Math.max(a, b), -1);
  const weekday = biz.days.includes(WEEKDAY[CLK.WD.format(now)]);
  // Business hours in local minutes, from the tick schedule (preferences.schedule), so moving
  // the start moves the band and the gap check with it.
  const { open: OPEN, close: CLOSE } = biz;
  const gaps = [];
  if (weekday && edgeMin > OPEN + 45) {
    let prev = OPEN;
    for (const m of [...pRuns.map((r) => r.min).filter((x) => x >= OPEN && x <= CLOSE), Math.min(edgeMin, CLOSE)].sort((a, b) => a - b)) {
      if (m - prev > 45) gaps.push({ from: prev, to: m });
      prev = Math.max(prev, m);
    }
  }
  const pMarks = [...pRuns.map((r) => r.min), ...pApps.map((a) => a.min), ...(nextMin == null ? [] : [nextMin])];
  const lastRun = pRuns.at(-1) || null;
  m_pulse = {
    runs: pRuns, apps: pApps, gaps, next_min: nextMin, next_label: nextLabel, weekday, open: OPEN, close: CLOSE,
    // The last firing: every run within 10 minutes of the latest one (LinkedIn, then Dice).
    last_firing: lastRun ? pRuns.filter((r) => lastRun.min - r.min <= 10) : [],
    last_overall: lastRun ? null : last ? { ...runRow(last), date: dayOf(last.at) } : null,
    start_h: Math.min(Math.floor(OPEN / 60) - 1, ...pMarks.map((x) => Math.floor(x / 60))),
    end_h: Math.max(19, ...pMarks.map((x) => Math.ceil((x + 1) / 60))),
  };

  const cvs = variants.map((v) => {
    const sent = applications.filter((a) => a.cv === v.share);
    return { share: v.share, slug: v.slug, url: v.url || null, sent_to: sent.map((a) => a.company), sent: sent.map((a) => ({ id: a.id, company: a.company })) };
  });

  // Recent activity: the action log, newest first. The tracker's own publishes are left out:
  // listing them would change the page on every publish, and an unchanged page must stay a no-op.
  const anchored = new Set([...applications, ...needs.filter((n) => !n.mail), ...not_a_fit, ...logged, ...passed, ...filtered.items].map((r) => String(r.id)));
  const activity_log = actions.filter((a) => a?.at && a.action && !/^tracker\./.test(a.action)).sort((a, b) => b.at.localeCompare(a.at)).map((a) => {
    const j = a.job_id != null ? state.jobs[a.job_id] : null;
    return {
      at: a.at, actor: ACTOR_LABEL[a.actor] || cap(String(a.actor || 'script')), action: String(a.action).replace(/[._]+/g, ' '), job_id: a.job_id ?? null,
      role: j ? scrub(`${j.title} @ ${coName(j.company)}`) : null, anchor: a.job_id != null && anchored.has(String(a.job_id)) ? `job-${a.job_id}` : null, detail: detailText(a.detail),
    };
  });

  const status = {
    applied_total: applications.length, applied_week: applications.filter((a) => inWeek(a.date)).length, needs_you: needs.length,
    replies: applications.filter((a) => a.heard.replied).length, reviewed_today: jobs.filter((j) => inDay(j.triage?.scored_at)).length,
    silent: applications.filter((a) => a.heard.kind === 'none' && a.heard.days >= SILENT_DAYS).length,
  };

  // "As of" is the newest event in the data, not the render time, so an unchanged state
  // renders byte-identical HTML and bikeshed treats the update as a no-op.
  const events = [last?.at, ...activity_log.map((a) => a.at), ...jobs.flatMap((j) => [j.triage?.scored_at, j.triage?.decided_at, j.application?.submitted_at, lastAttempt(j)?.at])].filter(Boolean);
  const asOf = events.length ? events.sort().at(-1) : now.toISOString();
  const Z = zoneLabel(zone, asOf);

  const summary = [];
  if (!status.applied_total) summary.push('No applications out yet.');
  else {
    summary.push(`${plural(status.applied_total, 'application')} out${status.applied_week === status.applied_total ? ', all in the last 7 days' : `, ${status.applied_week} in the last 7 days`}.`);
    const ch = tally(applications.map((a) => a.channel));
    const names = Object.keys(ch);
    summary.push(names.length === 1 ? `All went through ${names[0]}.` : `${names.map((n) => `${ch[n]} through ${n}`).join(', ')}.`);
  }
  if (status.applied_total) {
    summary.push(`A person replied on ${status.replies} of ${status.applied_total}.`);
    if (status.silent) summary.push(`${status.silent} ${status.silent === 1 ? 'has' : 'have'} had no reply for ${SILENT_DAYS} or more business days.`);
  }
  // Each kind names its roles, so the line says what is waiting, not just how much. The page
  // renders needs_groups with every name linked to its row in Needs you.
  const NEED_PHRASE = [['decision', 'role to decide', 'roles to decide'], ['docs_review', 'CV and letter to approve', 'CVs and letters to approve'],
    ['needs_answers', 'form with open questions', 'forms with open questions'], ['manual', 'hand-off to finish', 'hand-offs to finish'], ['unverified', 'submit to check', 'submits to check'],
    ['queued', 'approved role queued', 'approved roles queued'], ['security', 'security notice', 'security notices'], ['reply', 'reply to send', 'replies to send'],
    ['close', 'role to close', 'roles to close'], ['read', 'message to read', 'messages to read']];
  const needs_groups = NEED_PHRASE.map(([kind, one, many]) => ({ kind, phrase: plural(needs.filter((n) => n.kind === kind).length, one, many), items: needs.filter((n) => n.kind === kind).map((n) => ({ id: n.id, anchor: anchorOf(n), label: n.company || n.title })) }))
    .filter((g) => g.items.length);
  const needs_summary = needs.length ? `Waiting on you: ${needs_groups.map((g) => `${g.phrase} (${g.items.map((i) => i.label).join(', ')})`).join(', ')}.` : EMPTY.needs;
  summary.push(needs_summary);
  const rejToday = not_a_fit.filter((r) => inDay(r.date));
  const gateCount = tally(rejToday.flatMap((r) => r.gates));
  const topGate = Object.entries(gateCount).sort((a, b) => b[1] - a[1])[0];
  summary.push(`${plural(status.reviewed_today, 'role')} scored today. ${rejToday.length ? `${rejToday.length} failed a gate, most often ${GATE_LABEL[topGate[0]]}.` : 'None failed a gate.'}`);
  if (last) summary.push(`The loop ran ${plural(health.runs_today, 'check')} today. The last one, at ${timeOf(last.at)}, found ${(last.summary?.new ?? 0) ? plural(last.summary.new, 'new role') : 'no new roles'}.${health.halt_until ? ` It is halted until ${shortDate(health.halt_until)} ${timeOf(health.halt_until)}.` : ''}${health.dice_halt_until ? ` Dice is halted until ${shortDate(health.dice_halt_until)} ${timeOf(health.dice_halt_until)}.` : ''}`);

  return {
    tz: zone, tz_label: Z, operator: who, silent_days: SILENT_DAYS,
    as_of: asOf, as_of_label: `${longDate(asOf)}, ${timeOf(asOf)} ${Z}`, status, summary, needs_summary, needs_groups, applications, needs,
    funnel: { today: funnelFor(inDay), week: funnelFor(inWeek), rows: funnelRows }, interviews, outcomes, scored, activity, gate_fails,
    not_a_fit, logged, passed, filtered, market, health, pulse: m_pulse, activity_log, cvs, headings: HEADINGS, empty_states: Object.values(EMPTY),
  };
}

// ---------- render ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, unit) => (unit === 'year' && n ? `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : `$${Math.round(n).toLocaleString('en-US')}`);
const head = (i, title, intro = '') => `<div class="section-head"><span class="index">${String(i).padStart(2, '0')}</span><h2>${esc(title)}</h2></div>${intro ? `<p class="section-intro">${esc(intro)}</p>` : ''}`;
const link = (r) => `${r.url ? `<a href="${esc(r.url)}" rel="noopener" target="_blank">${esc(r.title)}</a>` : `<span>${esc(r.title)}</span>`}<span class="co">${esc(r.company)}</span>`;
const tier = (r) => (r.tier ? `<span class="badge tier-${esc(String(r.tier).toLowerCase())}">${esc(r.tier === 'reject' ? 'Reject' : `Tier ${r.tier}`)} <span class="num">${esc(r.score)}</span></span>` : '');
const empty = (text) => `<p class="empty">${esc(text)}</p>`;
// Source and lane, shown on Dice roles and LinkedIn hands-on roles: LinkedIn leadership is the default.
const srcBadge = (r) => (r.source === 'dice' ? `<span class="badge src">Dice${r.lane === 'hands-on' ? ', hands-on' : ''}</span>`
  : r.source === 'email' ? '<span class="badge src">Recruiter email</span>'
  : r.lane === 'hands-on' ? '<span class="badge src">LinkedIn, hands-on</span>' : '');
const NEED_LABEL = { unverified: 'Check submit', needs_answers: 'Answer questions', manual: 'Finish by hand', decision: 'Decide', docs_review: 'Approve CV and letter', queued: 'Queued', reply: 'Reply', close: 'Close?', security: 'Security', read: 'Read it' };
const MAIL_KIND = { reply: 'reply', interview: 'reply', 'outreach-fit': 'reply', 'outreach-nofit': 'reply', rejection: 'close', receipt: 'close', security: 'security', 'platform-message': 'read' };
const anchorOf = (n) => (n.mail ? n.id : `job-${n.id}`);
// What happened after the submit, from the role's own mail threads. Receipts, blasts and
// platform pings are not people.
const PERSON_KINDS = new Set(['reply', 'interview', 'outreach-fit', 'outreach-nofit', 'rejection']);
const latest = (xs) => xs.reduce((m, x) => (!m || x.at > m.at ? x : m), null);
function heardOf(a, mail, now) {
  const threads = mail.filter((t) => PERSON_KINDS.has(t.kind) && t.job_id != null && String(t.job_id) === String(a.id));
  const theirs = threads.flatMap((t) => (t.emails || []).map((e) => ({ at: e.at, who: scrub(e.from_name || t.sender_name), t })));
  // An outreach thread is their pitch: only an email after the user answered it is a reply. A
  // second recruiter resending the same seat after the submit is not.
  const since = (t) => (/^outreach/.test(t.kind) ? (t.sent || []).map((x) => x.at).sort()[0] : a.date);
  const replied = REPLY_STAGES.has(a.stage) || theirs.some((e) => e.t.kind !== 'rejection' && since(e.t) && e.at > since(e.t));
  const rejection = latest(theirs.filter((e) => e.t.kind === 'rejection'));
  if (rejection || a.stage === 'lost') return { kind: 'rejected', at: rejection?.at || null, replied: REPLY_STAGES.has(a.stage) };
  const them = latest(theirs);
  const you = latest(threads.flatMap((t) => (t.sent || []).map((x) => ({ at: x.at }))));
  if (you && (!them || you.at > them.at)) return { kind: 'you', at: you.at, replied };
  if (them) return { kind: 'them', at: them.at, who: them.who || null, card: them.t.status === 'draft' ? `mail-${them.t.thread_id}` : null, replied };
  if (REPLY_STAGES.has(a.stage)) return { kind: 'them', at: null, who: null, card: null, replied };
  return { kind: 'none', days: businessDaysSince(a.date, now), replied };
}
// Addresses (except the application address) and phone numbers never reach the page from mail text.
let ALLOW_EMAIL = null;
const scrub = (s) => String(s || '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (e) => (ALLOW_EMAIL && e.toLowerCase() === ALLOW_EMAIL ? e : '[address]')).replace(/\+?\d[\d ().-]{8,}\d/g, (p) => (p.replace(/\D/g, '').length >= 10 ? '[phone]' : p));
// Interview round and interviewer: free text from the file. Any address, phone or meeting link
// is dropped outright (never shown, not even as a placeholder), with the brackets around it.
const LINK_RE = /(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|us|net|org|io|ai|co|me|app|aws|live)\/\S*/gi;
const ivText = (s) => scrub(String(s || '').replace(LINK_RE, '[link]')).replace(/\s*[<([]?\[(?:address|phone|link)\][>)\]]?/g, '')
  .replace(/\s{2,}/g, ' ').replace(/[\s,;:|/-]+$/, '').trim();
// Weekdays between an ISO time and now, in local days.
const businessDaysSince = (iso, now) => { if (!iso) return 0; let n = 0; const d = new Date(`${dayOf(iso)}T12:00:00Z`); const end = dayOf(now); while (d.toISOString().slice(0, 10) < end) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) n++; } return n; };
const pct = (n, total) => (total ? Math.round((100 * n) / total) : 0);
const ext = (url, text, cls = '', title = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(url)}" rel="noopener" target="_blank"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
// A CV with a bikeshed render links to it; without one it stays plain text, never a dead link.
const cvLink = (name, url) => (url ? ext(url, `${esc(name)} ↗`, 'mono', 'Current render on bikeshed') : `<span class="mono">${esc(name)}</span>`);
const letterLink = (url) => (url ? ext(url, 'Open the letter ↗', 'mono', 'The letter sent with this application, on bikeshed') : 'Sent, not published yet');

// ---------- charts: static HTML and CSS only (bikeshed sandboxes scripts) ----------
// Positions are percentages, so labels stay real text at real size at any width. Every
// chart carries an aria-label with its numbers, and every mark a title tooltip.
function legend(keys, rings = []) {
  return `<ul class="legend">${keys.map(([key, label, n, share]) => `<li><span class="sw o-${key}${rings.includes(key) ? ' ring' : ''}"></span>${esc(label)}${n == null ? '' : ` <span class="num">${n}</span>`}${share == null ? '' : ` <span class="pct">${share}%</span>`}</li>`).join('')}</ul>`;
}

function barList(title, items, { total = null } = {}) {
  if (!items.length) return '';
  const max = Math.max(1, ...items.map((i) => i.count));
  const sum = total ?? items.reduce((s, i) => s + i.count, 0);
  const aria = `${title}: ${items.map((i) => `${i.label} ${i.count}`).join(', ')}.`;
  return `<figure class="chart bars" role="img" aria-label="${esc(aria)}"><p class="label">${esc(title)}</p>${items.map((i) => `<div class="step" title="${esc(`${i.label}: ${i.count} of ${sum}`)}"><span class="step-label">${esc(i.label)}</span>`
    + `<span class="bar"><span style="width:${pct(i.count, max)}%"></span></span><span class="num">${i.count} <span class="pct">${pct(i.count, sum)}%</span></span></div>`).join('')}</figure>`;
}

function outcomeBarHtml(m) {
  const total = m.outcomes.reduce((s, o) => s + o.count, 0);
  if (!total) return '';
  const live = m.outcomes.filter((o) => o.count);
  const aria = `Where all ${total} roles stand: ${live.map((o) => `${o.count} ${o.label.toLowerCase()}`).join(', ')}.`;
  return `<figure class="chart outcome"><p class="label">Where all ${total} roles stand</p><div class="stack" role="img" aria-label="${esc(aria)}">`
    + `${live.map((o) => `<span class="seg o-${o.key}" style="flex:${o.count} 1 0" title="${esc(`${o.label}: ${o.count} of ${total}`)}"></span>`).join('')}</div>`
    + `${legend(live.map((o) => [o.key, o.label, o.count, pct(o.count, total)]))}</figure>`;
}

function funnelHtml(m) {
  const rows = m.funnel.rows;
  const max = Math.max(1, ...rows.map((r) => r.week));
  const aria = `Last 7 days: ${rows.map((r) => `${r.label.toLowerCase()} ${r.week}`).join(', ')}. Today: ${rows.map((r) => `${r.label.toLowerCase()} ${r.today}`).join(', ')}.`;
  // Each row carries its key as a class: Applied is the filled bar, interviews are green, and
  // Rejected sits apart in red with its share of Applied.
  const kept = (r) => (r.key === 'rejected' ? r.pct_applied : r.pct_prev);
  const tip = (r) => `${r.label}: ${r.week} in 7 days, ${r.today} today${r.key === 'rejected' && r.pct_applied != null ? `, ${r.pct_applied}% of Applied` : ''}`;
  return `<figure class="chart funnel" role="img" aria-label="${esc(aria)}"><div class="frow fhead"><span>Stage</span><span></span><span>7 days</span><span>Today</span><span>Kept</span></div>`
    + rows.map((r) => `<div class="frow f-${esc(r.key)}" title="${esc(tip(r))}"><span class="flabel">${esc(r.label)}</span>`
      + `<span class="fbar"><span style="width:${pct(r.week, max)}%"></span></span><span class="num">${r.week}</span><span class="num">${r.today}</span>`
      + `<span class="num muted">${kept(r) == null ? '' : `${kept(r)}%`}</span></div>`).join('')
    + '<p class="note">Kept: the share of the stage above that reached this one, over 7 days. Rejected counts rejection emails and roles marked lost, as a share of Applied.</p></figure>';
}

// Every interview on file, so the funnel counts can be traced: upcoming first, then held.
function interviewsHtml(m) {
  if (!m.interviews.length) return empty(EMPTY.interviews);
  const role = (i) => (i.card ? `<a href="#job-${esc(i.id)}">${esc(i.title)} @ ${esc(i.company)}</a>` : `<span>${esc(i.title)} @ ${esc(i.company)}</span>`);
  return `<h3>Interviews</h3>${table('interviews', ['When', 'Role', 'Round', 'With', 'Status'], m.interviews.map((i) => `<tr${i.status === 'canceled' ? ' class="canceled"' : ''}>`
    + `${cell('When', `<span class="num">${esc(`${dueDay(i.at.slice(0, 10))}, ${i.at.slice(11, 16)} ${m.tz_label}`)}</span>`)}<th scope="row">${role(i)}</th>`
    + `${cell('Round', esc(i.round || ''))}${cell('With', esc(i.with || ''))}${cell('Status', `<span class="badge iv-${esc(i.status)}">${esc(IV_LABEL[i.status])}</span>`)}</tr>`))}`;
}

function stripHtml(m, cuts) {
  if (!m.scored.length) return '';
  const lanes = Math.max(...m.scored.map((s) => s.lane)) + 1;
  const n = tally(m.scored.map((s) => s.outcome));
  const present = OUTCOMES.filter(([k]) => n[k]);
  const aria = `Every scored role on the 0 to 100 fit scale: ${m.scored.length} roles, ${present.map(([k, l]) => `${n[k]} ${l.toLowerCase()}`).join(', ')}.`;
  const bands = [[0, cuts.b, 'c', 'Tier C'], [cuts.b, cuts.a, 'b', 'Tier B'], [cuts.a, 100, 'a', 'Tier A']]
    .map(([a, b, k, l]) => `<span class="band band-${k}" style="left:${a}%;width:${b - a}%"><span class="band-label">${l}</span></span>`).join('');
  const dots = m.scored.map((s) => {
    const tip = `${s.title} · ${s.company} · fit ${s.score} · ${OUTCOME_LABEL[s.outcome]}`;
    return `<a class="dot o-${s.outcome}${s.outcome === 'notfit' ? ' ring' : ''}" href="${esc(s.url)}" rel="noopener" target="_blank" style="left:${s.score}%;bottom:${6 + s.lane * 16}px" title="${esc(tip)}" aria-label="${esc(tip)}"></a>`;
  }).join('');
  const ticks = [...new Set([0, 20, 40, cuts.b, cuts.a, 100])].sort((a, b) => a - b).map((t) => `<span${[20, 40].includes(t) && ![cuts.a, cuts.b].includes(t) ? ' class="minor"' : ''} style="left:${t}%">${t}</span>`).join('');
  return `<figure class="chart strip" aria-label="${esc(aria)}"><p class="label">Every scored role by fit score. Each mark opens the posting</p>`
    + `<div class="plot" style="height:${24 + lanes * 16}px">${bands}${dots}</div><div class="axis">${ticks}</div>`
    + `${legend(present.map(([k, l]) => [k, l, n[k]]), ['notfit'])}</figure>`;
}

function activityHtml(m) {
  const rows = [['seen', 'Seen'], ['scored', 'Scored'], ['applied', 'Applied']];
  const total = (k) => m.activity.reduce((s, x) => s + x[k], 0);
  const now = m.activity.at(-1);
  const aria = `Last 14 days: ${rows.map(([k, l]) => `${total(k)} ${l.toLowerCase()}`).join(', ')}. Today: ${rows.map(([k, l]) => `${now[k]} ${l.toLowerCase()}`).join(', ')}.`;
  const row = ([k, l]) => {
    const max = Math.max(1, ...m.activity.map((x) => x[k]));
    const cols = m.activity.map((x, i) => `<span class="col${x.weekend ? ' we' : ''}${i === m.activity.length - 1 ? ' now' : ''}" title="${esc(`${dueDay(x.day)}: ${x[k]} ${l.toLowerCase()}`)}"><span style="height:${pct(x[k], max)}%"></span></span>`).join('');
    return `<div class="spark"><span class="spark-label">${l}</span><span class="cols">${cols}</span><span class="num">${total(k)}</span></div>`;
  };
  return `<figure class="chart activity" role="img" aria-label="${esc(aria)}"><p class="label">Last 14 days, one column per day, each row on its own scale</p>${rows.map(row).join('')}`
    + `<div class="spark spark-axis"><span></span><span class="ends"><span>${esc(dueDay(m.activity[0].day))}</span><span>Today</span></span><span>14 days</span></div></figure>`;
}

const UNIT = { hour: ['hourly', 'Hourly'], year: ['annual', 'Annual'], day: ['daily', 'Day rate'] };
function niceAxis(max) {
  const raw = Math.max(1, max) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * p).find((s) => s >= raw);
  return { step, max: Math.ceil(max / step) * step };
}

function compHtml(m) {
  const items = m.market.items;
  if (!items.length) return '';
  const groups = Object.entries(UNIT).filter(([u]) => items.some((i) => i.unit === u)).map(([u, [key, title]]) => {
    const rows = items.filter((i) => i.unit === u);
    const ax = niceAxis(Math.max(...rows.map((i) => i.max)));
    const x = (v) => +((100 * v) / ax.max).toFixed(2);
    const s = m.market[key];
    const range = (i) => (i.min === i.max ? money(i.min, u) : `${money(i.min, u)} to ${money(i.max, u)}`); // the group label names the unit
    const ticks = Array.from({ length: Math.round(ax.max / ax.step) + 1 }, (_, k) => `<span style="left:${x(k * ax.step)}%">${money(k * ax.step, u)}</span>`).join('');
    const aria = `${title} comp in ${plural(rows.length, 'posting')}: ${rows.map((i) => `${i.company} ${range(i)}`).join(', ')}. Median ${money(s.median, u)}.`;
    return `<div class="comp-group" role="group" aria-label="${esc(aria)}"><p class="label">${title} · median <span class="num">${money(s.median, u)}</span> · ${plural(rows.length, 'posting')}</p>`
      + rows.map((i) => `<div class="crow"><span class="crole">${ext(i.url, esc(i.title))}<span class="co">${esc(i.company)}</span></span>`
        + `<span class="ctrack" style="--step:${x(ax.step)}%"><span class="cmed" style="left:${x(s.median)}%"></span>`
        + `<span class="cbar o-${i.outcome}${i.min === i.max ? ' cdot' : ''}" style="left:${x(i.min)}%;width:${x(i.max - i.min)}%" title="${esc(`${i.text} · ${OUTCOME_LABEL[i.outcome]}`)}"></span></span>`
        + `<span class="num">${range(i)}</span></div>`).join('')
      + `<div class="crow caxis"><span></span><span class="ticks">${ticks}</span><span></span></div></div>`;
  }).join('');
  const present = OUTCOMES.filter(([k]) => items.some((i) => i.outcome === k));
  return `<figure class="chart comp" aria-label="Comp ranges stated in viewed postings, by unit"><p class="label">Each posting's stated range. The dark rule marks the median</p>${groups}${legend(present.map(([k, l]) => [k, l]))}</figure>`;
}

const SRC_NAME = { linkedin: 'LinkedIn', dice: 'Dice' };
const runDid = (r) => [r.cards != null ? plural(r.cards, 'card') : null, plural(r.new, 'new role'), plural(r.views, 'view'), r.pending ? `${r.pending} to triage` : null,
  r.aborted ? `stopped: ${r.aborted}` : r.false_login ? 'false sign-out caught, no halt' : 'guards clear'].filter(Boolean).join(' · ');

function pulseHtml(m) {
  const p = m.pulse;
  const Z = m.tz_label;
  if (!p || (!p.runs.length && !p.last_overall)) return empty('No checks yet.');
  const span = (p.end_h - p.start_h) * 60;
  const x = (min) => +((100 * (min - p.start_h * 60)) / span).toFixed(2);
  const lastSet = new Set(p.last_firing);
  // One layer under all three lanes: business hours and the gaps, drawn once.
  const gapBands = p.gaps.map((g) => `<span class="pl-gap" style="left:${x(g.from)}%;width:${x(g.to) - x(g.from)}%" title="${esc(`No check from ${hhmm(g.from)} to ${hhmm(g.to)} ${Z}`)}"><span class="pl-gap-label">no checks<br>${hhmm(g.from)} to ${hhmm(g.to)}</span></span>`).join('');
  const under = `<div class="pl-under" aria-hidden="true"><span class="pl-hours" style="left:${x(p.open)}%;width:${x(p.close) - x(p.open)}%"></span>${gapBands}</div>`;
  const nextTip = `Next check about ${p.next_label || hhmm(p.next_min)} ${Z}`;
  const next = p.next_min == null ? '' : `<span class="pl-next" style="left:${x(p.next_min)}%" title="${esc(nextTip)}" data-tip="${esc(nextTip)}"></span>`;
  const row = (n, name, cls, body, tip = '') => `<div class="pl-name" style="grid-row:${n}"${tip ? ` title="${esc(tip)}" data-tip="${esc(tip)}"` : ''}>${name}</div><div class="pl-track${cls}" style="grid-row:${n}">${body}</div>`;
  // Hover hints: data-tip draws an instant tooltip in CSS; title stays for screen readers and
  // touch long-press.
  const dotTip = (r) => `${r.time} ${Z} · ${SRC_NAME[r.source]} · ${r.label.replace(/^Dice: /, '')}${r.kind === 'sweep' ? ' (full sweep)' : ''}: ${runDid(r)}${r.aborted ? `. Stopped by a guard: ${r.aborted}` : ''}`;
  const lane = (key, n) => {
    const runs = p.runs.filter((r) => r.source === key);
    const dots = runs.map((r) => `<span class="pl-dot${r.new ? ' hit' : ''}${r.aborted ? ' abort' : ''}${lastSet.has(r) ? ' last' : ''}" style="left:${x(r.min)}%" title="${esc(`${r.time} ${r.label}: ${runDid(r)}`)}" data-tip="${esc(dotTip(r))}">${r.new ? `<span>${r.new}</span>` : ''}</span>`).join('');
    const last = runs.filter((r) => lastSet.has(r)).at(-1);
    const tag = last && p.last_firing[0]?.source === key ? `<span class="pl-tag" style="left:${x(last.min)}%">last ${esc(p.last_firing.at(-1).time)}</span>` : ''; // one tag, on the firing's top lane
    const laneTip = `${SRC_NAME[key]} today: ${plural(runs.length, 'check')}, ${plural(runs.reduce((s, r) => s + r.new, 0), 'new role')}, ${plural(runs.reduce((s, r) => s + r.views, 0), 'view')}${runs.some((r) => r.aborted) ? `, ${plural(runs.filter((r) => r.aborted).length, 'stop')} by a guard` : ''}`;
    return row(n, esc(SRC_NAME[key]), '', `${dots}${next}${tag}`, laneTip);
  };
  const apps = p.apps.map((a) => `<a class="pl-app" style="left:${x(a.min)}%" title="${esc(`${a.time} Applied: ${a.title} @ ${a.company} (${a.channel})`)}" href="#job-${esc(a.id)}" data-tip="${esc(`${a.time} ${Z} · Applied: ${a.title} @ ${a.company} (${a.channel}). Click for the card`)}"><i></i></a>`).join('');
  const appLabels = p.apps.map((a, i) => `<span class="pl-app-label${i % 2 ? ' low' : ''}" style="left:${x(a.min)}%">${esc(String(a.company).split(/[ ,]/)[0])}</span>`).join(''); // alternate above and below the diamonds
  const ticks = Array.from({ length: Math.floor((p.end_h - p.start_h) / 2) + 1 }, (_, k) => p.start_h + 2 * k).map((h) => `<span style="left:${x(h * 60)}%">${hhmm(h * 60)}</span>`).join('');
  const lf = p.last_firing;
  const lastLine = lf.length
    ? `<p class="pulse-last"><span class="pl-live" aria-hidden="true"></span>Last check <span class="num">${esc(lf.at(-1).time)}</span> ${Z}. ${lf.map((r) => `${esc(SRC_NAME[r.source])}: ${esc(r.label.replace(/^Dice: /, ''))}, ${esc(runDid(r))}`).join('. ')}.${p.next_label ? ` Next check about <span class="num">${esc(p.next_label)}</span> ${Z}.` : ''}</p>`
    : p.last_overall ? `<p class="pulse-last">No check yet today. The last one ran ${esc(p.last_overall.date)} at <span class="num">${esc(p.last_overall.time)}</span> ${Z}: ${esc(p.last_overall.label)}, ${esc(runDid(p.last_overall))}.</p>` : '';
  const counts = ['linkedin', 'dice'].map((k) => `${plural(p.runs.filter((r) => r.source === k).length, 'check')} on ${SRC_NAME[k]}`).join(', ');
  const aria = `Today's loop on the ${Z} clock: ${counts}, ${plural(p.runs.reduce((n, r) => n + r.new, 0), 'new role')} found, ${plural(p.apps.length, 'application')} sent${p.gaps.length ? `, no checks ${p.gaps.map((g) => `${hhmm(g.from)} to ${hhmm(g.to)}`).join(' and ')}` : ''}. The list below names every check.`;
  const legendHtml = `<ul class="legend pl-legend"><li><span class="pl-key hit"></span>Found new roles (the number)</li><li><span class="pl-key"></span>Nothing new</li><li><span class="pl-key abort"></span>Stopped by a guard</li><li><span class="pl-key last"></span>Last check</li><li><span class="pl-key next"></span>Next check</li><li><span class="pl-key appk"></span>Application sent</li>${p.gaps.length ? '<li><span class="pl-key gapk"></span>Business hours with no check</li>' : ''}</ul>`;
  const fig = p.runs.length || p.apps.length ? `<figure class="chart pulse" role="img" aria-label="${esc(aria)}"><div class="pl">${under}${lane('linkedin', 1)}${lane('dice', 2)}${row(3, 'Applied', ' apps', apps + appLabels, `Applications today: ${p.apps.length}`)}</div><div class="axis pl-axis">${ticks}</div>${legendHtml}</figure>` : '';
  const items = [...p.runs.map((r) => ({ min: r.min, html: `<li${lastSet.has(r) ? ' class="last"' : ''}><time class="num">${esc(r.time)}</time><span class="badge src-${esc(r.source)}">${esc(SRC_NAME[r.source])}</span><span class="what">${esc(r.label.replace(/^Dice: /, ''))}${r.kind === 'sweep' ? ' (full sweep)' : ''}</span><span class="did${r.aborted ? ' abort' : ''}">${esc(runDid(r))}</span></li>` })),
    ...p.gaps.map((g) => ({ min: g.from + 0.25, html: `<li class="gap"><time class="num">${hhmm(g.from)}</time><span class="badge gap">No check</span><span class="what">${plural(g.to - g.from, 'minute')} of business hours with no check</span><span class="did">until ${hhmm(g.to)}</span></li>` })),
    ...p.apps.map((a) => ({ min: a.min + 0.5, html: `<li class="app"><time class="num">${esc(a.time)}</time><span class="badge stage-applied">Applied</span><span class="what"><a href="#job-${esc(a.id)}">${esc(a.title)}</a> @ ${esc(a.company)}</span><span class="did">${esc(a.channel)}</span></li>` }))]
    .sort((a, b) => b.min - a.min).map((i) => i.html).join('');
  const nItems = p.runs.length + p.apps.length;
  const log = items ? `<details class="list pulse-list"><summary>Every check and application today (${nItems}), newest first</summary><ol class="pulse-log" aria-label="Every check and application today, newest first">${items}</ol></details>` : '';
  return lastLine + fig + log;
}

function table(cls, cols, rows) {
  return `<table class="data-table ${cls}"><thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
const cell = (label, html) => `<td data-label="${esc(label)}">${html}</td>`;

// One compact table, newest first, ten rows a page. No script on the page: hidden radios pick
// the page and CSS rules generated for the page count (pagerCss) hide the other rows. Without
// the radios (a sanitizer strips them) every row shows. A linked row (#job-<id>) shows
// whatever page is picked.
export const APPS_PAGE = 10;
// Ages count back from the page's "as of" (the newest event), never the render time, so an
// unchanged state still renders the same page and the publish stays a no-op.
function agoOf(iso, ref, dateOnly) {
  if (dateOnly) {
    const d = Math.round((Date.parse(dayOf(ref)) - Date.parse(dayOf(iso))) / 864e5);
    return d <= 0 ? 'today' : `${d}d ago`;
  }
  const min = Math.floor((Date.parse(ref) - Date.parse(iso)) / 6e4);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  const d = Math.floor(min / 1440);
  return d < 14 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
}
// Posting to application. LinkedIn's "2 days ago" leaves a one-unit span, so its gap shows as a
// range in that unit ("2–3d"); an exact post time shows the gap itself.
function gapOf(from, to, unit) {
  const ms = Math.max(0, Date.parse(to) - Date.parse(from));
  if (unit) { const lo = Math.max(1, Math.round(ms / UNIT_MS[unit])); return `${lo}–${lo + 1}${UNIT_SHORT[unit]}`; }
  const min = Math.floor(ms / 6e4);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 10) return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
  if (h < 48) return `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h / 24}d`;
}
function afterPostCell(a, Z) {
  if (a.source === 'email') return cell('After post', 'By email');
  if (!a.posted || !a.date) return cell('After post', 'Not known');
  const p = a.posted;
  const tip = p.unit ? `LinkedIn showed “${p.text}” on ${shortDate(p.seen)}, ${timeOf(p.seen)} ${Z}` : `Posted ${shortDate(p.at)}, ${timeOf(p.at)} ${Z}`;
  return `<td data-label="After post" title="${esc(tip)}"><span class="num">${esc(gapOf(p.at, a.date, p.unit))}</span>${p.reposted ? '<span class="sub">Reposted</span>' : ''}</td>`;
}
export const appPages = (n) => Math.ceil(n / APPS_PAGE);
export function pagerCss(n) {
  const pages = appPages(n);
  if (pages < 2) return '';
  return Array.from({ length: pages }, (_, i) => i + 1).map((k) => `.apps:has(#ap-${k}:checked) tr[data-p]:not([data-p="${k}"]):not(:target){display:none}`
    + `.apps:has(#ap-${k}:checked) label[for="ap-${k}"]{color:var(--ink);border-color:var(--ink)}`).join('');
}

function applicationsHtml(m) {
  if (!m.applications.length) return empty(EMPTY.applications);
  const n = m.applications.length;
  const pages = appPages(n);
  const rows = m.applications.map((a, i) => {
    // A rejection (email or lost file) shows as its own red stage on a tinted row.
    const rejected = a.heard.kind === 'rejected';
    const stage = rejected ? 'rejected' : a.stage || 'applied';
    const more = [a.why && `<dt>Why it fits</dt><dd>${esc(a.why)}</dd>`, a.gaps.length && `<dt>Gaps</dt><dd>${a.gaps.map(esc).join('<br>')}</dd>`,
      a.flags.length && `<dt>Flags</dt><dd>${a.flags.map(esc).join('<br>')}</dd>`, `<dt>Comp seen</dt><dd>${esc(a.comp || 'Not stated')}</dd>`,
      a.hours && `<dt>Hours seen</dt><dd>${esc(a.hours)}</dd>`, a.evidence && `<dt>Evidence</dt><dd>${esc(a.evidence)}</dd>`].filter(Boolean).join('');
    const role = `${link(a)}${a.cv_note ? `<p class="flag">${esc(a.cv_note)}</p>` : ''}<details><summary>Details</summary><dl>${more}</dl></details>`;
    const cv = `${a.cv ? cvLink(a.cv, a.cv_url) : 'Not recorded'}${a.letter ? `<span class="sub">Letter: ${letterLink(a.letter_url)}</span>` : ''}`;
    const h = a.heard;
    const on = h.at ? `<span class="sub num">${esc(dueDay(dayOf(h.at)))}</span>` : '';
    const heard = h.kind === 'none' ? `No reply yet<span class="sub num">${h.days ? esc(plural(h.days, 'business day')) : 'Applied today'}</span>`
      : h.kind === 'you' ? `You replied${on}<span class="sub">No answer yet</span>`
        : h.kind === 'rejected' ? `Rejected${on}`
          : `${h.who ? `${esc(h.who)} wrote` : 'They replied'}${on}${h.card ? `<a class="sub" href="#${esc(h.card)}">Reply waiting</a>` : ''}`;
    const when = a.date ? `<span class="num">${esc(agoOf(a.date, m.as_of, a.date_only))}</span><span class="sub num">${esc(a.date_only ? shortDate(a.date) : `${shortDate(a.date)}, ${timeOf(a.date)}`)}</span>` : 'Not recorded';
    return `<tr id="job-${esc(a.id)}"${pages > 1 ? ` data-p="${Math.floor(i / APPS_PAGE) + 1}"` : ''}${rejected ? ' class="rejected"' : ''}>${cell('Applied', when)}${afterPostCell(a, m.tz_label)}<th scope="row">${role}</th>`
      + `${cell('Fit', `${tier(a)}${srcBadge(a)}`)}${cell('Stage', `<span class="badge stage-${esc(stage)}">${esc(STAGE_LABEL[stage] || stage)}</span>`)}${cell('Channel', esc(a.channel))}${cell('CV', cv)}${cell('Heard', heard)}</tr>`;
  });
  const tbl = table('apps-table', ['Applied', 'After post', 'Role', 'Fit', 'Stage', 'Channel', 'CV', 'Heard'], rows);
  if (pages < 2) return tbl;
  const radios = Array.from({ length: pages }, (_, i) => `<input type="radio" name="apps-page" id="ap-${i + 1}"${i ? '' : ' checked'}>`).join('');
  const labels = Array.from({ length: pages }, (_, i) => `<label for="ap-${i + 1}">${i * APPS_PAGE + 1}–${Math.min(n, (i + 1) * APPS_PAGE)}</label>`).join('');
  return `<div class="apps">${radios}${tbl}<nav class="pager" aria-label="Application pages">${labels}</nav></div>`;
}

function mailRow(n) {
  const what = `${esc(n.from)}: ${esc(n.summary)}${n.job ? ` <a href="#job-${esc(n.job)}">${n.probable ? `Probably ${esc(n.job_title || 'this role')}` : 'The role'}</a>.` : ''}${n.cv ? ` CV: ${cvLink(n.cv, n.cv_url)}${n.new_cv ? ' (new CV)' : ''}.` : ''}`
    + `${n.action ? ` <strong>${esc(n.action)}</strong>` : ''}${n.draft ? `<details class="draft"><summary>Draft reply</summary><pre>${esc(n.draft)}</pre></details>` : ''}`;
  return `<tr id="${esc(n.id)}"><th scope="row">${link(n)}</th>${cell('Needed', `<span class="badge need">${esc(NEED_LABEL[n.kind])}</span>`)}${cell('Fit', tier(n))}${cell('What', what)}</tr>`;
}

function needWhat(n) {
  if (n.kind === 'needs_answers') return n.questions.map(esc).join('<br>');
  if (n.kind === 'manual') {
    return `${esc(cap(n.detail))}. <a href="${esc(n.link)}" rel="noopener" target="_blank">Open the form</a> and submit it by hand${n.cv ? ` with the CV ${n.cv_url ? `<a href="${esc(n.cv_url)}" rel="noopener" target="_blank">${esc(n.cv)}</a>` : esc(n.cv)}` : ''}${n.letter ? (n.letter_url ? ` and the <a href="${esc(n.letter_url)}" rel="noopener" target="_blank">cover letter</a>` : ' and the cover letter') : ''}, then say it is in.`;
  }
  if (n.kind === 'docs_review') {
    const a = (url, label) => `<a href="${esc(url)}" rel="noopener" target="_blank">${label}</a>`;
    const docs = n.letter_link ? [n.link && a(n.link, 'the CV'), a(n.letter_link, 'the cover letter')].filter(Boolean) : (n.link ? [a(n.link, 'the review document')] : []);
    const where = docs.length ? `Read ${docs.join(' and ')} written for this role, then comment “approve” or say what to change.` : 'The CV and letter written for this role wait for your approval. Say “approve” or what to change.';
    return `${where}${n.also_decide ? ' The role itself still needs your Apply, Watch or Skip.' : ''}`;
  }
  return esc(n.detail || '');
}

function needsHtml(m) {
  if (!m.needs.length) return empty(EMPTY.needs);
  return table('needs', ['Role', 'Needed', 'Fit', 'What'], m.needs.map((n) => {
    if (n.mail) return mailRow(n);
    return `<tr id="job-${esc(n.id)}"><th scope="row">${link(n)}</th>${cell('Needed', `<span class="badge need">${esc(NEED_LABEL[n.kind])}</span>`)}${cell('Fit', tier(n))}${cell('What', needWhat(n))}</tr>`;
  }));
}

function rejectsHtml(m) {
  const gates = barList('Gates failed', m.gate_fails.map((g) => ({ label: `${g.gate} · ${g.label}`, count: g.count })), { total: m.not_a_fit.length });
  // The table is collapsed by default under the gates chart: a long list would push every later
  // section out of view. Row anchors stay in the page for comments.
  const main = m.not_a_fit.length ? `<details class="list"><summary>All ${m.not_a_fit.length} roles that failed a gate</summary>${table('rejects', ['Role', 'Scored', 'Fit', 'Gate', 'Why not', 'Comp seen'], m.not_a_fit.map((r) => `<tr id="job-${esc(r.id)}"><th scope="row">${link(r)}</th>`
    + `${cell('Scored', `<span class="num">${esc(shortDate(r.date))}</span>`)}${cell('Fit', tier(r))}${cell('Gate', `<span>${r.gates.map((g) => `<span class="badge gate">${esc(g)}</span>`).join(' ')}</span>`)}`
    + `${cell('Why not', `<q>${esc(r.reason)}</q>`)}${cell('Comp seen', esc(r.comp || 'Not stated'))}</tr>`))}</details>` : empty(EMPTY.not_a_fit);
  const below = m.logged.length ? table('logged', ['Role', 'Scored', 'Fit', 'Top concern', 'Comp seen'], m.logged.map((r) => `<tr id="job-${esc(r.id)}"><th scope="row">${link(r)}</th>`
    + `${cell('Scored', `<span class="num">${esc(shortDate(r.date))}</span>`)}${cell('Fit', tier(r))}${cell('Top concern', esc(r.reason))}${cell('Comp seen', esc(r.comp || 'Not stated'))}</tr>`)) : empty(EMPTY.logged);
  return `${gates}${main}<h3>Below the bar (tier C, logged only)</h3>${below}`;
}

function passedHtml(m) {
  if (!m.passed.length) return empty(EMPTY.passed);
  return table('passed', ['Role', 'Decision', 'Fit', 'Note'], m.passed.map((p) => `<tr id="job-${esc(p.id)}"><th scope="row">${link(p)}</th>${cell('Decision', `<span class="badge">${esc(p.decision)}</span>`)}${cell('Fit', tier(p))}${cell('Note', esc(p.note || ''))}</tr>`));
}

function filteredHtml(m) {
  if (!m.filtered.items.length) return empty(EMPTY.filtered);
  const counts = barList(`Why ${m.filtered.items.length} roles were dropped`, m.filtered.by_reason.map((r) => ({ label: r.reason, count: r.count })));
  const list = `<details class="list"><summary>All ${m.filtered.items.length} roles filtered before review</summary><ul>${m.filtered.items.map((r) => `<li id="job-${esc(r.id)}">${link(r)}<span class="why">${esc(r.reason)}</span></li>`).join('')}</ul></details>`;
  return counts + list;
}

function marketHtml(m) {
  const k = m.market;
  const range = (s, unit, suffix) => (s.n ? `<div class="metric"><span class="readout">${money(s.min, unit)} to ${money(s.max, unit)}</span><span class="metric-label">${suffix}, median ${money(s.median, unit)}, ${plural(s.n, 'posting')}</span></div>` : '');
  const ranges = [range(k.hourly, 'hour', 'Hourly'), range(k.annual, 'year', 'Annual'), range(k.daily, 'day', 'Day rate')].filter(Boolean).join('');
  const mix = (title, obj, labels = {}) => barList(title, Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => ({ label: labels[key] || key, count: n })));
  return `${ranges ? `<div class="metrics ranges">${ranges}</div>` : empty(EMPTY.market)}${compHtml(m)}<div class="mix">${mix('LinkedIn tag on viewed roles', k.structure)}`
    + `${mix('How they apply', k.apply, { easy: 'Easy Apply', external: 'Company site', unknown: 'Not recorded' })}</div>`;
}

// A cap override reason may start with who said it and when ("<name> 2026-10-27 13:47 PT: ...");
// the page shows the instruction only.
const overrideText = (s) => String(s).replace(/^(?:[\p{L} .'-]{1,40} )?\d{4}-\d{2}-\d{2}(?: \d{1,2}:\d{2})?(?: [A-Z]{1,5})?:\s*/u, '');
function healthHtml(m) {
  const h = m.health;
  const Z = m.tz_label;
  const whose = `${m.operator}'s`;
  const lastLine = h.last ? `<p class="lede">Last check <span class="num">${esc(timeOf(h.last.at))}</span> ${Z}: ${esc(h.last.label)}, ${(h.last.summary?.new ?? 0) ? plural(h.last.summary.new, 'new role') : 'no new roles'}, ${plural(h.last.summary?.views ?? 0, 'view')}, guards ${esc(h.last.aborted || 'clear')}.${h.next_check ? ` Next check about <span class="num">${esc(h.next_check)}</span> ${Z}.` : ''}${h.halt_until ? ` Halted until ${esc(shortDate(h.halt_until))} ${esc(timeOf(h.halt_until))}.` : ''}${h.dice_halt_until ? ` Dice halted until ${esc(shortDate(h.dice_halt_until))} ${esc(timeOf(h.dice_halt_until))}.` : ''}</p>` : '';
  const capAria = `Caps used today: ${h.caps.map((c) => `${c.label} ${c.used} of ${c.max}`).join(', ')}.`;
  const caps = h.caps.length ? `<figure class="chart caps" role="img" aria-label="${esc(capAria)}"><p class="label">Daily caps, reset ${esc(h.reset_label)} ${Z}</p>${h.caps.map((c) => `<div class="cap${c.used > c.max ? ' over' : ''}" title="${esc(`${c.label}: ${c.used} of ${c.max}${c.used > c.max ? `, over the cap on ${whose} instruction` : ''}`)}"><span class="step-label">${esc(c.label)}</span><span class="bar"><span style="width:${Math.min(100, pct(c.used, Math.max(1, c.max)))}%"></span></span><span class="num">${c.used} / ${c.max}</span></div>`).join('')}</figure>` : '';
  // One line per instruction, not per limiter entry: an override run logs every page load.
  const groups = [...h.overrides.reduce((acc, o) => acc.set(o.reason, acc.get(o.reason) || o), new Map()).values()];
  const ov = groups.length ? `<p class="note">Cap overrides today, each on ${esc(whose)} instruction:</p><ul class="overrides">${groups.map((o) => `<li><span class="num">${esc(timeOf(o.at))}</span> ${esc(overrideText(o.reason))}</li>`).join('')}</ul>` : '';
  return lastLine + caps + ov;
}

// The action log, newest first: the latest ten in view, the rest one click away.
const ACTIONS_SHOWN = 10;
function activityLogHtml(m) {
  const rows = m.activity_log || [];
  if (!rows.length) return empty(EMPTY.activity);
  const row = (a) => `<tr>${cell('When', `<span class="num">${esc(`${shortDate(a.at)}, ${timeOf(a.at)}`)}</span>`)}${cell('Who', `<span class="badge actor">${esc(a.actor)}</span>`)}`
    + `<th scope="row">${esc(a.action)}</th>${cell('Role', a.role ? (a.anchor ? `<a href="#${esc(a.anchor)}">${esc(a.role)}</a>` : esc(a.role)) : '')}${cell('Detail', esc(a.detail))}</tr>`;
  const cols = ['When', 'Who', 'What', 'Role', 'Detail'];
  const recent = table('actions', cols, rows.slice(0, ACTIONS_SHOWN).map(row));
  const older = rows.length > ACTIONS_SHOWN ? `<details class="list"><summary>${rows.length - ACTIONS_SHOWN} older entries</summary>${table('actions', cols, rows.slice(ACTIONS_SHOWN).map(row))}</details>` : '';
  return recent + older;
}

function cvsHtml(m) {
  if (!m.cvs.length) return empty(EMPTY.cvs);
  return table('cvs', ['CV', 'Archetype', 'Sent to'], m.cvs.map((c) => `<tr><th scope="row">${cvLink(c.share, c.url)}</th>${cell('Archetype', `<span class="mono">${esc(c.slug)}</span>`)}`
    + `${cell('Sent to', c.sent.length ? c.sent.map((s) => `<a href="#job-${esc(s.id)}">${esc(s.company)}</a>`).join(', ') : 'Not sent yet')}</tr>`));
}

const readBrand = (...p) => readFileSync(brandFile(...p));
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// assets (all optional; defaults come from the brand pack and the workspace):
//   css, sansWoff2, monoWoff2   brand/tracker.css and brand/fonts (a workspace brand/ file wins)
//   title                       config/tracker.json title (the <title> and the bikeshed title)
//   wordmark                    preferences.brand.wordmark, else person.display_name
//   mark                        brand/mark.json (workspace brand folder only), else none: text only
//   kicker                      preferences.brand.title
//   accent                      preferences.brand.accent, a hex colour
//   tiers                       preferences.tiers, for the strip plot's bands
export function renderTrackerHtml(m, assets = {}) {
  CLK = clock(m.tz || 'UTC');
  const prefs = ['wordmark', 'kicker', 'accent', 'tiers'].every((k) => assets[k] !== undefined) ? {} : preferences();
  const brand = prefs.brand || {};
  const css = assets.css ?? readBrand('tracker.css').toString('utf8');
  const sans = assets.sansWoff2 ?? readBrand('fonts', 'instrument-sans-latin-wght-normal.woff2');
  const mono = assets.monoWoff2 ?? readBrand('fonts', 'geist-mono-latin-wght-normal.woff2');
  const title = assets.title ?? (loadConfig('tracker.json', { required: false }).title || 'Job hunt · Applications');
  const wordmark = assets.wordmark ?? (brand.wordmark || person().display_name || person().name || '');
  const kicker = assets.kicker ?? (brand.title || 'Job hunt');
  const accent = assets.accent ?? brand.accent;
  const cuts = { a: 80, b: 65, ...(assets.tiers ?? prefs.tiers ?? {}) };
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  const fonts = `@font-face{font-family:'Instrument Sans Variable';src:url(data:font/woff2;base64,${b64(sans)}) format('woff2');font-weight:400 700;font-style:normal;font-display:swap}`
    + `@font-face{font-family:'Geist Mono Variable';src:url(data:font/woff2;base64,${b64(mono)}) format('woff2');font-weight:100 900;font-style:normal;font-display:swap}`;
  const accentCss = accent && HEX.test(String(accent)) ? `:root{--accent:${accent}}` : '';
  const s = m.status;
  const Z = m.tz_label;
  const metric = (value, label) => `<div class="metric"><span class="readout">${value}</span><span class="metric-label">${esc(label)}</span></div>`;
  const metrics = [metric(s.applied_total, `Applications out, ${s.applied_week} this week`), (s.needs_you ? metric(s.needs_you, 'Waiting on you').replace(/^<div class="metric">(.*)<\/div>$/, '<a class="metric" href="#needs">$1</a>') : metric(s.needs_you, 'Waiting on you')), metric(s.replies, 'Replies or calls'),
    metric(s.reviewed_today, 'Roles scored today'), metric(s.silent, `No reply in ${m.silent_days}+ business days`)].join('');
  const H = m.headings;
  const mark = wordmark || kicker;
  const logo = assets.mark !== undefined ? assets.mark : loadMark();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${fonts}${css}${accentCss}${pagerCss(m.applications.length)}</style></head>
<body><div class="wrap">
<header class="masthead"><span class="wordmark">${logo ? `${markSvg(logo)}${wordmarkName(mark)}` : esc(mark)}</span>
<div class="mast-meta"><span class="kicker">${esc(kicker)}</span><time datetime="${esc(m.as_of)}">${esc(m.as_of_label)}</time></div></header>
<section class="hero" id="status"><p class="eyebrow">Updated ${esc(m.as_of_label)} · ${plural(m.health.runs_today, 'check')} today</p><h1>Applications <em>tracker</em></h1>
${head(1, H[0])}<div class="metrics">${metrics}</div>${outcomeBarHtml(m)}</section>
<section id="funnel">${head(2, H[1], 'How roles move from search to application and interview, over the last 7 days and today. Rejections sit apart, in red.')}${funnelHtml(m)}${interviewsHtml(m)}</section>
<section id="summary">${head(3, H[2])}<ul class="summary">${m.summary.map((x) => `<li>${x === m.needs_summary && m.needs_groups.length ? `<a href="#needs">Waiting on you</a>: ${m.needs_groups.map((g) => `${esc(g.phrase)} (${g.items.map((i) => `<a href="#${esc(i.anchor)}">${esc(i.label)}</a>`).join(', ')})`).join(', ')}.` : esc(x)}</li>`).join('')}</ul></section>
<section id="pulse">${head(4, H[3], `Every check today on the ${Z} clock: what it searched and found, the last one, the next one, and any stretch of business hours with no check.`)}${pulseHtml(m)}</section>
<section id="applications">${head(5, H[4], 'Every application submitted, newest first, ten to a page. The CV link opens its current render. Open Details for the fit, the gaps and the evidence.')}${applicationsHtml(m)}</section>
<section id="needs">${head(6, H[5])}${needsHtml(m)}</section>
<section id="pipeline">${head(7, H[6], 'Where each role scored, and what each day added.')}${stripHtml(m, cuts)}${activityHtml(m)}</section>
<section id="not-a-fit">${head(8, H[7], 'Roles that failed a fit gate, with the line from the posting behind it.')}${rejectsHtml(m)}</section>
<section id="passed">${head(9, H[8])}${passedHtml(m)}</section>
<section id="filtered">${head(10, H[9], 'Dropped by the prefilter before a detail view.')}${filteredHtml(m)}</section>
<section id="market">${head(11, H[10], 'Comp as stated in viewed postings. Shown, never scored.')}${marketHtml(m)}</section>
<section id="health">${head(12, H[11])}${healthHtml(m)}</section>
<section id="activity">${head(13, H[12], 'What the hunt recorded, newest first: decisions, approvals, applications and mail, from the action log (npm run log).')}${activityLogHtml(m)}</section>
<section id="cvs">${head(14, H[13])}${cvsHtml(m)}</section>
<footer class="foot"><p>Private working document. Generated from the job hunt state.</p></footer>
</div></body></html>
`;
}

// ---------- publish ----------
// One bikeshed document, updated in place. Unchanged HTML is skipped before any call.
// Open comments stop the update (they would stay on the old version); the loop answers
// and resolves them first. `run(args)` resolves {code, stdout, stderr} of `bikeshed …`.
const classify = (r) => (r.code === 127 ? 'error' : /login|token|sign(ed)? in|unauthori[sz]ed|401/i.test(`${r.stderr}`) ? 'auth' : 'refused');
const jsonOut = (s) => { const t = String(s || ''); const i = t.indexOf('{'); return JSON.parse(i < 0 ? t : t.slice(i)); };

// noFolder names the setting a caller reads its folder id from, for the refusal message.
export async function publishTracker({ html, file, cfg, st, run, title, noFolder = 'config/tracker.json has no bikeshed.folder_id' }) {
  const hash = createHash('sha256').update(html).digest('hex');
  if (cfg.doc_id && st.hash === hash) return { status: 'unchanged', cfg, st };
  if (!cfg.doc_id) {
    // Never at the bikeshed root: a new document goes into the user's private folder.
    if (!cfg.folder_id) return { status: 'no-folder', message: noFolder, cfg, st };
    const r = await run(['publish', file, '--title', title, '--folder', cfg.folder_id, '--json']);
    if (r.code !== 0) return { status: classify(r), message: r.stderr.trim(), cfg, st };
    const out = jsonOut(r.stdout);
    return { status: 'created', url: out.url, cfg: { ...cfg, doc_id: out.docId, url: out.url }, st: { ...st, version: out.versionId, hash } };
  }
  const c = await run(['comments', cfg.doc_id, '--json']);
  if (c.code !== 0) return { status: classify(c), message: c.stderr.trim(), cfg, st };
  const threads = jsonOut(c.stdout).threads || [];
  if (threads.length) return { status: 'comments', threads, cfg, st };
  const u = await run(['update', cfg.doc_id, file, ...(st.version ? ['--base', st.version] : []), '--json']);
  if (u.code !== 0) return { status: classify(u), message: u.stderr.trim(), cfg, st };
  const out = jsonOut(u.stdout);
  return { status: out.deduped ? 'unchanged' : 'updated', url: out.url || cfg.url, threadsLeftBehind: out.threadsLeftBehind ?? 0, cfg, st: { ...st, version: out.versionId, hash } };
}

// ---------- comment watch ----------
// New threads and comments on one document since the last poll. `seen` maps a thread id to
// { n, typing, at }: n is how many written comments were already reported. A thread whose
// comments are all empty is someone still typing: it is reported once with typing: true, and
// its text arrives as a normal event on a later poll. Comments sent through the bikeshed CLI
// (via "cli") are the agent's own replies: counted as seen, never reported.
const commentText = (c) => String(c?.body ?? c?.text ?? '').trim();
const commentAuthor = (c) => (c?.author && typeof c.author === 'object' ? c.author.name ?? null : c?.author ?? null);
const commentAt = (c) => c?.createdAt ?? c?.created_at ?? c?.at ?? null;
export function watchEvents(threads, seen = {}, meta = {}, { now = new Date() } = {}) {
  const next = { ...seen };
  const events = [];
  for (const t of threads || []) {
    const id = t?.threadId ?? t?.thread_id ?? t?.id;
    if (!id) continue;
    const prev = seen[id] || { n: 0, typing: false };
    const base = { ...meta, thread_id: id, section: t.section ?? null, quote: t.quote ?? null };
    const written = (t.comments || []).filter((c) => commentText(c));
    let { typing } = prev;
    if (!written.length) {
      if (!typing) { const c0 = (t.comments || [])[0]; events.push({ ...base, text: '', author: commentAuthor(c0), at: commentAt(c0), typing: true }); typing = true; }
    } else {
      for (const c of written.slice(prev.n)) if (c.via !== 'cli') events.push({ ...base, text: commentText(c), author: commentAuthor(c), at: commentAt(c) });
    }
    next[id] = { n: Math.max(prev.n, written.length), typing, at: now.toISOString() };
  }
  return { events, seen: next };
}
