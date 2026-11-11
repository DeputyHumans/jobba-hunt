// Pure parsers for LinkedIn Jobs pages. Job IDs are read from attributes and hrefs,
// never from class names: LinkedIn obfuscates classes (it already did on content
// search), but job IDs have to stay in links and data attributes for the page to work.

// job-card-component-ref-<id>: the AI job search UI (/jobs/search-results/, probe 2026-10-26).
const ID_RE = /(?:data-occludable-job-id|data-job-id)="(\d{6,})"|\/jobs\/view\/(\d{6,})|currentJobId=(\d{6,})|urn:li:(?:fsd_)?jobPosting:(\d{6,})|job-card-component-ref-(\d{6,})/g;

export function extractJobIdsFromHtml(html) {
  const seen = new Set();
  for (const m of html.matchAll(ID_RE)) {
    const id = m[1] || m[2] || m[3] || m[4] || m[5];
    if (id) seen.add(id);
  }
  return [...seen];
}

const EMPTY_RE = /no matching jobs found|we couldn[’']t find a match|no results found|there are no jobs/i;
export function isEmptyMarkerText(text) {
  return EMPTY_RE.test(text || '');
}

export function parseResultCount(text) {
  const m = (text || '').match(/(\d[\d,]*)\+?\s+results?\b/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

const POSTED_RE = /^(reposted\s+)?(\d+\s+(second|minute|hour|day|week|month)s?\s+ago|just now|today|yesterday)$/i;
const APPLICANTS_RE = /\bapplicants?\b|people clicked apply/i;
const BADGE_RE = /^(promoted|easy apply|actively recruiting|viewed|applied|saved|be an early applicant|your profile matches.*|\d+ (school )?alum(ni|nus) works? here|\d+ connections? works? here|responses managed off linkedin|with verification|.* with verification)$/i;

// Card innerText is a stack of lines: title (often twice, the second a visually hidden
// copy or "<title> with verification"), company, location, then badges and age.
export function parseCardText(text) {
  const lines = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const out = { title: null, company: null, location: null, posted_text: null, applicants_text: null, promoted: false, easy_apply: false };
  const core = [];
  for (const l of lines) {
    if (/^promoted\b/i.test(l)) { out.promoted = true; continue; }
    if (/^easy apply$/i.test(l)) { out.easy_apply = true; continue; }
    if (POSTED_RE.test(l)) { out.posted_text = out.posted_text || l; continue; }
    if (APPLICANTS_RE.test(l)) { out.applicants_text = out.applicants_text || l; continue; }
    if (BADGE_RE.test(l)) continue;
    core.push(l);
  }
  // The AI search UI glues the visually-hidden title copy on without a newline:
  // "XX" or "X (Verified job)X" -> "X". It also renders "X (Verified job)" with the
  // plain copy "X" on the next line (sweep 2026-10-27); the filter below drops that copy.
  const first = (core[0] || '').replace(/\s*\(verified job\)\s*$/i, '');
  const glued = first.match(/^(.+?)(?:\s*\(verified job\))?\1$/i);
  const title = glued ? glued[1] : first || null;
  const rest = core.slice(1).filter((l) => l !== title && l !== `${title} with verification`);
  out.title = title;
  out.company = rest[0] || null;
  out.location = rest[1] || null;
  return out;
}

const EMPLOYMENT = ['Full-time', 'Part-time', 'Contract', 'Temporary', 'Internship', 'Volunteer', 'Other'];
const WORKPLACE = ['Remote', 'Hybrid', 'On-site'];
const COMP_RE = /\$\s?[\d,.]+\s?[KkMm]?(?:\/(?:yr|hr|mo|year|hour|month))?(?:\s*-\s*\$\s?[\d,.]+\s?[KkMm]?(?:\/(?:yr|hr|mo|year|hour|month))?)?/;
const AGE_RE = /(reposted\s+)?\d+\s+(second|minute|hour|day|week|month)s?\s+ago/i;

// Job view top card: title, "Company · Location · age · N applicants", then insight
// chips (workplace, employment type, salary). Parsed from text, not from classes.
export function parseTopCard(text) {
  const t = text || '';
  const lines = t.split('\n').map((s) => s.trim()).filter(Boolean);
  const chip = (vals) => {
    for (const l of lines) for (const v of vals) if (new RegExp(`(^|[\\s·|])${v}($|[\\s·|])`, 'i').test(l)) return v;
    return null;
  };
  let applicants = null;
  const a = t.match(/(over\s+)?(\d[\d,]*)\s+applicants?/i);
  if (a) applicants = Number(a[2].replace(/,/g, ''));
  const age = t.match(AGE_RE);
  const comp = t.match(COMP_RE);
  return {
    workplace: chip(WORKPLACE),
    employment_type: chip(EMPLOYMENT),
    applicants,
    posted_text: age ? age[0].replace(/^reposted/i, 'Reposted') : null,
    comp_text: comp ? comp[0].trim() : null,
  };
}

// Apply control on the job view: Easy Apply (aria-label "Easy Apply to this job", capture
// 2026-10-26, ✓ offline) or an external Apply that leaves LinkedIn (label ?). The href is
// LinkedIn's redirect when the control is a link; the ATS host is resolved after approval.
export function applyTypeOf({ label, href }) {
  if (!label || !/\bapply\b/i.test(label)) return null;
  if (/easy apply/i.test(label)) return { type: 'easy', url: null };
  return { type: 'external', url: href || null };
}

// LinkedIn's own record that the account already applied: blocks a duplicate application (?).
export function alreadyAppliedIn(text) {
  return /\bapplied\s+\d+\s+(second|minute|hour|day|week|month)s?\s+ago\b|\bapplication (was )?submitted\b/i.test(text || '');
}

// One verdict per search page load. checkpoint/login abort the sweep; suspect (zero
// IDs and no "no results" marker) means throttling or selector rot.
// The marker beats the ID count: a no-results page still lists promoted "Jobs you may be
// interested in" filler cards (a probe saw 8 promoted ads on a narrow no-results query).
export function classifySearch({ url, loggedOut, idCount, emptyMarker }) {
  if (/\/(checkpoint|authwall)/.test(url || '')) return 'checkpoint';
  if (loggedOut || /\/(login|uas\/login)/.test(url || '')) return 'login';
  if (emptyMarker) return 'empty';
  return idCount > 0 ? 'ok' : 'suspect';
}
