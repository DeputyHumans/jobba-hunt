// Dice page parsing. Pure: turns the raw strings the browser collectors in dice-jobs.mjs
// read off the page into the same card and view shapes linkedin-jobs.mjs returns, so the
// sweep core, prefilter, triage and apply runner handle both sources.

import { preferences } from './profile.mjs';

const ORIGIN = 'https://www.dice.com';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const diceJobId = (guid) => `dice-${guid}`;
export const diceGuid = (id) => String(id || '').replace(/^dice-/, '');
export const isDiceId = (id) => /^dice-/.test(String(id || '')) && GUID_RE.test(diceGuid(id));
export const diceJobUrl = (guid) => `${ORIGIN}/job-detail/${guid}`;

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Card layouts seen 2026-10-28: the plain list (data-testid job-card, company on the card)
// and "Group by company" (grouped-job-entry, company in the group header). The collector
// hands over whatever it found; the fallbacks here cover the missing pieces.
export function normalizeDiceCard(raw) {
  if (!GUID_RE.test(raw?.guid || '')) return null;
  const fromAria = (raw.aria || '').match(/^View Details for (.*) \([0-9a-f]{16,}\)$/i)?.[1];
  let company = clean(raw.company);
  if (!company && raw.companyHref) {
    try { company = clean(new URL(raw.companyHref, ORIGIN).searchParams.get('companyname')); } catch { /* keep empty */ }
  }
  const meta = clean((raw.metaTexts || []).join(' '));
  const [location, posted] = meta.includes('•') ? meta.split('•').map(clean) : [meta, ''];
  return {
    job_id: diceJobId(raw.guid),
    source: 'dice',
    url: diceJobUrl(raw.guid),
    title: clean(raw.title) || clean(fromAria) || null,
    company: company || null,
    location: location || null,
    posted_text: posted || null,
    employment_type: clean(raw.typeText) || null,
    pay_text: /^(null|undefined)$/i.test(clean(raw.payText)) ? null : clean(raw.payText) || null,
    easy_apply: !!raw.easy,
    snippet: clean(raw.snippet).slice(0, 500) || null,
  };
}

// Header badges on the job page, e.g. ["Contract Independent", "Contract W2",
// "Contract Corp To Corp", "12 Months", "Occasional Travel Required", "On-site", "$70/hr"].
export function parseDiceBadges(badges = [], { locationType = null } = {}) {
  const contract_types = [];
  const add = (t) => { if (!contract_types.includes(t)) contract_types.push(t); };
  const employment = [];
  let duration = null;
  let travel = null;
  let pay = null;
  for (const b of badges.map(clean).filter(Boolean)) {
    if (/corp\s*to\s*corp|\bc2c\b/i.test(b)) { add('c2c'); employment.push(b); }
    else if (/contract\s+independent|\b1099\b/i.test(b)) { add('1099'); employment.push(b); }
    else if (/contract\s+w-?2|\bw-?2\b/i.test(b)) { add('w2'); employment.push(b); }
    else if (/third\s*party/i.test(b)) { add('third-party'); employment.push(b); }
    else if (/^full[- ]?time$/i.test(b)) { add('full-time'); employment.push(b); }
    else if (/^part[- ]?time$/i.test(b)) { add('part-time'); employment.push(b); }
    else if (/^contract$/i.test(b)) { add('contract'); employment.push(b); }
    else if (/^\d+\+?\s*(day|week|month|year)s?$/i.test(b)) duration = b;
    else if (/travel/i.test(b)) travel = b;
    else if (/\$|\bper (hour|year)\b|\/hr\b|depends on experience/i.test(b)) pay = b;
  }
  return {
    contract_types,
    employment_type: employment.join(', ') || null,
    workplace: clean(locationType) || null,
    duration,
    travel,
    comp_text: pay,
  };
}

// The employment structures preferences.engagement.accept can list.
export const ENGAGEMENT_TYPES = ['c2c', '1099', 'w2', 'full-time', 'contract', 'part-time'];
export function engagementAccept(prefs) {
  try {
    const a = (prefs || preferences()).engagement?.accept;
    return Array.isArray(a) ? a.map((x) => String(x).toLowerCase()) : [...ENGAGEMENT_TYPES];
  } catch {
    return [...ENGAGEMENT_TYPES];
  }
}

// G1 on Dice, from the contract-type badges and engagement.accept. Third Party means a vendor may
// submit, i.e. C2C.
//   ok          an accepted independent structure (C2C, 1099) is offered
//   w2-only     W2 is the accepted structure on offer (triage looks at it)
//   full-time   full-time only, and full-time is accepted (triage looks at it)
//   excluded    every structure the posting names is outside accept
//   unclear     nothing decisive (a plain "Contract" badge does not name the tax structure)
export function diceStructure(types = [], accept = engagementAccept()) {
  const t = new Set(types.map((x) => (x === 'third-party' ? 'c2c' : x)));
  const ok = new Set(accept);
  if (['c2c', '1099'].some((x) => t.has(x) && ok.has(x))) return 'ok';
  if (t.has('w2') && ok.has('w2')) return 'w2-only';
  const contractish = ['contract', 'c2c', '1099', 'w2'].some((x) => ok.has(x));
  const open = { contract: contractish, 'part-time': ok.has('part-time') || contractish, 'full-time': ok.has('full-time') };
  if (t.has('full-time') && !t.has('part-time') && !t.has('contract')) {
    if (ok.has('full-time')) return 'full-time';
    if (!t.has('c2c') && !t.has('1099') && !t.has('w2')) return 'excluded';
  }
  const named = [...t].filter((x) => ENGAGEMENT_TYPES.includes(x));
  if (named.length && named.every((x) => !(open[x] ?? ok.has(x)))) return 'excluded';
  return 'unclear';
}

// Card label, e.g. "Third Party, Contract" or "Full-time": full-time alone is dropped
// before any view is spent on it.
export function cardTypes(label) {
  return parseDiceBadges(String(label || '').split(',')).contract_types;
}

// The apply control on the job page: an <a data-testid="apply-button">. "Easy Apply"
// links to Dice's own wizard (/job-applications/<guid>/wizard); anything else that says
// Apply leaves Dice.
// After a wizard was left unfinished (a dry run stops before Submit), Dice keeps the draft
// and the same link reads "Continue Application".
export function diceApplyTypeOf({ label, href }) {
  const l = clean(label);
  const abs = href ? new URL(href, ORIGIN).toString() : null;
  const wizard = /\/job-applications\/[^/]+\/wizard/.test(abs || '');
  if (wizard && /continue application/i.test(l)) return { type: 'dice-easy', url: abs, draft: true };
  if (!l || !/\bapply\b/i.test(l) || /\bapplied\b/i.test(l)) return null;
  if (/easy apply/i.test(l) && wizard) return { type: 'dice-easy', url: abs };
  return { type: 'external', url: abs };
}

export function diceAlreadyApplied({ label, headerText }) {
  return /\bapplied\b|application (was )?submitted/i.test(`${clean(label)}\n${headerText || ''}`);
}

// One verdict per Dice page load. blocked (firewall 403) and checkpoint (a challenge
// page) abort the Dice tick; suspect = zero cards with no "no results" marker.
export function classifyDicePage({ title, text, url, loggedOut, cardCount = 0, emptyMarker = false }) {
  const head = `${title || ''}\n${(text || '').slice(0, 600)}`;
  if (/403 forbidden|access denied|request blocked/i.test(head)) return 'blocked';
  if (/just a moment|verify (that )?you are (a )?human|are you a robot|captcha|unusual (activity|traffic)/i.test(head)) return 'checkpoint';
  if (loggedOut || /\/(login|sign-?in)\b/i.test(url || '')) return 'login';
  if (emptyMarker) return 'empty';
  return cardCount > 0 ? 'ok' : 'suspect';
}

export function parseDiceResultCount(text) {
  const m = (text || '').match(/(\d[\d,]*)\s+results?\b/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

// "Hybrid in Chicago, IL, US • Posted 7 hours ago • Updated 3 hours ago"
export function parseDiceLocationLine(line) {
  const parts = clean(line).split('•').map(clean);
  return {
    location: parts[0] || null,
    posted_text: parts.find((p) => /^posted\b/i.test(p))?.replace(/^posted\s+/i, '') || null,
  };
}
