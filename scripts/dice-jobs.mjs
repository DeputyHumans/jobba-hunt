#!/usr/bin/env node
// Dice job search driver: READ-ONLY. It loads Dice search result pages and job pages as
// the operator's Dice account and reads them. It never clicks Apply, Save, Follow, the job-alert
// toggle, Message or anything else that writes. Same module shape as linkedin-jobs.mjs:
// one selector map with ✓ (verified in a headed run) / ? (unverified) tags, and library
// functions that return result objects and never exit.
//
// Library use (dice-tick.mjs, through sweep-core's io): searchJobs(page, url), viewJob(page, id).
//
// CLI (each page load counts against the dice_jobs daily caps):
//   node scripts/dice-jobs.mjs login                          # headed, sign in by hand; closes once signed in
//   node scripts/dice-jobs.mjs whoami [--headed]
//   node scripts/dice-jobs.mjs search --query "python LLM" [--employment contract|any] [--tpr 604800] [--headed] [--pause] [--capture]
//   node scripts/dice-jobs.mjs view --id dice-<guid> [--headed] [--pause] [--capture]
//   node scripts/dice-jobs.mjs limits                         # caps used today, no browser
//   node scripts/dice-jobs.mjs clear-halt --note "<the operator's words>"   # clear the Dice halt early, no browser
//
// The browser profile is <data>/browser/dice (CloakBrowser, inside the workspace), separate from
// the LinkedIn profile, so a Dice session never shares a cookie jar with LinkedIn.

import './lib/env.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, out, fail, openContext, ProfileBusyError, jitter, profileBase } from './cloak-core.mjs';
import { normalizeDiceCard, parseDiceBadges, diceApplyTypeOf, diceAlreadyApplied, classifyDicePage, parseDiceResultCount, parseDiceLocationLine, isDiceId, diceGuid, diceJobUrl } from './lib/dice-extract.mjs';
import { buildDiceUrl } from './lib/dice-url.mjs';
import { canPost, recordPost, getUsageSummary } from './rate-limiter.mjs';
import { DATA_DIR, STATE_PATH, loadState, saveStateAtomic, sourceState } from './lib/state.mjs';
import { logAction } from './lib/actions-log.mjs';
import { runStop } from './lib/tick-plan.mjs';
import { readPause } from './lib/pause.mjs';
import { display } from './lib/paths.mjs';
import { probeScript } from './lib/page-script.mjs';
import { openSession, sessionDriver, SessionRefused } from './lib/session.mjs';
import { recordSession } from './lib/browser.mjs';
import { BrowserUnavailableError } from './lib/bridge.mjs';
import { loadSearchConfig } from './lib/config.mjs';
import { operatorName } from './lib/profile.mjs';

export const DICE_PROFILE = join(profileBase(), 'dice');
export const DICE_PLATFORM = 'dice';
const SETTLE_MS = [4500, 6000];

// Seen in saved pages of a signed-in session (2026-10-28); every entry stays ? until a
// headed run of this script confirms it (the Dice selector table in docs/platforms.md, updated in
// the same change).
export const DICE_SEL = {
  signedIn: 'nav[aria-label="Account"] button[aria-haspopup]',                  // ?
  resultsRoot: '[aria-label="Job search results"]',                              // ?
  card: '[data-job-guid]',                                                       // ? (job-card and grouped-job-entry layouts)
  titleLink: 'a[href*="/job-detail/"]',                                          // ?
  ariaLink: 'a[aria-label^="View Details for"]',                                 // ?
  companyLink: 'a[href*="/company-profile/"]',                                   // ? (companyname= query param)
  easyLabel: '[id="easyApply-label"]',                                           // ?
  typeLabel: '[id="employmentType-label"]',                                      // ?
  payLabel: '[id="salary-label"]',                                               // ?
  emptyMarker: '[data-testid="job-search-no-results"]',                          // ?
  // Job page
  header: '[data-testid="job-detail-header-card"]',                              // ?
  applyButton: '[data-testid="apply-button"]',                                   // ? (an <a>, Easy Apply -> /job-applications/<guid>/wizard)
  locationType: '[data-testid="locationTypeBadge"]',                             // ?
  duration: '[data-testid="contractDurationBadge"]',                             // ?
  structuredData: 'script[data-testid="jobDetailStructuredData"]',               // ? (schema.org JobPosting)
};

// ---------- browser-side collectors (run inside page.evaluate) ----------
export function collectDiceCards(sel) {
  const root = document.querySelector(sel.resultsRoot) || document;
  const txt = (el) => (el && (el.innerText || el.textContent) || '').trim();
  const seen = new Set();
  const cards = [];
  for (const el of root.querySelectorAll(sel.card)) {
    const guid = el.getAttribute('data-job-guid');
    if (!guid || seen.has(guid)) continue;
    seen.add(guid);
    const link = [...el.querySelectorAll(sel.titleLink)].find((a) => txt(a));
    // "Group by company" puts the company in the group header, a sibling of the entries
    // inside the same listitem.
    const scope = el.closest('[role="listitem"]') || el;
    const companyLinks = [...el.querySelectorAll(sel.companyLink), ...scope.querySelectorAll(sel.companyLink)];
    const named = companyLinks.find((a) => txt(a));
    const labels = new Set([...el.querySelectorAll('[aria-labelledby]')]);
    const ps = [...el.querySelectorAll('p')].filter((p) => ![...labels].some((l) => l.contains(p)) && !p.hasAttribute('title') && !p.closest(sel.companyLink));
    const short = ps.map(txt).filter((t) => t && t.length <= 150);
    cards.push({
      guid,
      title: txt(link),
      aria: el.querySelector(sel.ariaLink)?.getAttribute('aria-label') || '',
      company: named ? txt(named) : '',
      companyHref: (named || companyLinks[0])?.getAttribute('href') || '',
      metaTexts: short,
      easy: !!el.querySelector(sel.easyLabel),
      typeText: txt(el.querySelector(sel.typeLabel)),
      payText: txt(el.querySelector(sel.payLabel)),
      snippet: ps.map(txt).find((t) => t.length > 150) || '',
    });
  }
  const body = document.body.innerText || '';
  return {
    cards,
    title: document.title,
    text: body.slice(0, 3000),
    countText: (body.match(/\d[\d,]*\s+results?[^\n]*/i) || [''])[0],
    emptyMarker: !!document.querySelector(sel.emptyMarker),
    // Same markers as authMarkers below, inlined: this runs inside the page.
    signedIn: !!document.querySelector(sel.signedIn) || [...document.querySelectorAll('a, button, [role="menuitem"]')].some((e) => /^\s*log ?out\s*$/i.test(e.textContent || '')),
    signedOut: [...document.querySelectorAll('a, button, [role="menuitem"]')].some((e) => /^\s*(log ?in|sign ?in)\s*$/i.test(e.textContent || '') || /\/(dashboard\/)?login\b/i.test(e.getAttribute('href') || '')),
  };
}

// Signed in: the account menu, or its "Log Out" item (in the DOM even while the menu is
// closed or the header is in its narrow layout). Signed out: an explicit Log in / Sign in
// control or a login link. A page with neither is not treated as signed out: a missing
// menu twice halted Dice on signed-in pages (2026-10-28, a cold and a headless first load).
export function authMarkers(sel) {
  const ctl = [...document.querySelectorAll('a, button, [role="menuitem"]')];
  const signedIn = !!document.querySelector(sel.signedIn) || ctl.some((e) => /^\s*log ?out\s*$/i.test(e.textContent || ''));
  const signedOut = ctl.some((e) => /^\s*(log ?in|sign ?in)\s*$/i.test(e.textContent || '') || /\/(dashboard\/)?login\b/i.test(e.getAttribute('href') || ''));
  return { signedIn, signedOut };
}

function scrollResults() {
  const first = document.querySelector('[data-job-guid]');
  let el = first;
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) { window.scrollBy(0, 1200); return; }
  el.scrollTo(0, el.scrollHeight);
}

export function collectDiceView(sel) {
  const txt = (el) => (el && (el.innerText || el.textContent) || '').trim();
  const header = document.querySelector(sel.header);
  const scope = header || document.querySelector('main') || document.body;
  const h1 = scope.querySelector('h1');
  const company = [...scope.querySelectorAll('a[href*="/company-profile/"]')].find((a) => txt(a));
  const apply = scope.querySelector(sel.applyButton);
  const spans = [...scope.querySelectorAll('span')].map(txt);
  const locLine = spans.filter((t) => /•\s*Posted/i.test(t)).sort((a, b) => b.length - a.length)[0] || '';
  const anchor = scope.querySelector(`${sel.locationType}, ${sel.duration}`);
  let badges = anchor ? [...anchor.parentElement.children].map(txt) : [];
  if (!badges.length && header) {
    // Fallback: the header lines after the location line.
    const lines = txt(header).split('\n').map((s) => s.trim()).filter(Boolean);
    const at = lines.findIndex((l) => /•\s*Posted/i.test(l));
    badges = at >= 0 ? lines.slice(at + 1, at + 10) : [];
  }
  let ld = null;
  try { ld = JSON.parse(document.querySelector(sel.structuredData)?.textContent || 'null'); } catch { ld = null; }
  let description = '';
  if (ld?.description) {
    const html = String(ld.description).replace(/<(br|\/p|\/li|\/div|\/h\d|\/tr)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ');
    description = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  }
  if (description.trim().length < 100) {
    const h = [...document.querySelectorAll('h2, h3, h4')].find((x) => /^\s*summary\s*$/i.test(txt(x)));
    if (h) description = txt(h.parentElement).replace(/^\s*summary\s*/i, '');
  }
  const body = document.body.innerText || '';
  return {
    title: txt(h1) || ld?.title || null,
    company: company ? txt(company) : ld?.hiringOrganization?.name || null,
    company_url: company ? company.href.split('?')[0] : ld?.hiringOrganization?.sameAs || null,
    loc_line: locLine,
    badges,
    location_type: txt(scope.querySelector(sel.locationType)) || null,
    header_text: txt(header).slice(0, 2000),
    description_text: description.replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000),
    date_posted: ld?.datePosted || null,
    apply_label: apply ? txt(apply) : null,
    apply_href: apply ? apply.getAttribute('href') : null,
    page_title: document.title,
    text: body.slice(0, 3000),
    signed_in: !!document.querySelector(sel.signedIn) || [...document.querySelectorAll('a, button, [role="menuitem"]')].some((e) => /^\s*log ?out\s*$/i.test(e.textContent || '')),
    signed_out: [...document.querySelectorAll('a, button, [role="menuitem"]')].some((e) => /^\s*(log ?in|sign ?in)\s*$/i.test(e.textContent || '') || /\/(dashboard\/)?login\b/i.test(e.getAttribute('href') || '')),
  };
}

// Dice renders the account menu client-side, after the page itself: a fixed settle missed
// it on a cold browser (the first page of a run, 2026-10-28) and read a signed-in page as
// signed out. Wait for the menu up to 15 s; a page that is really signed out still fails.
export async function settle(page) {
  await page.waitForTimeout(jitter(SETTLE_MS));
  await page.waitForFunction((sel) => !!document.querySelector(sel) || [...document.querySelectorAll('a, button, [role="menuitem"]')].some((e) => /^\s*(log ?out|log ?in|sign ?in)\s*$/i.test(e.textContent || '')), DICE_SEL.signedIn, { timeout: 15000 }).catch(() => {});
}

// ---------- page probes (both drivers: page.evaluate, or a chrome bundle) ----------
// sel.settleMs and sel.markerWaitMs replace the waits (tests only).
// The settle of a Dice page inside the page: a jittered wait, then up to 15 s for the account menu
// or a log in / log out control (the menu renders client-side, after the page).
export async function diceSettleInPage(sel) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(sel.settleMs ?? 4500 + Math.round(Math.random() * 1500));
  const marked = () => !!document.querySelector(sel.signedIn) || [...document.querySelectorAll('a, button, [role="menuitem"]')].some((e) => /^\s*(log ?out|log ?in|sign ?in)\s*$/i.test(e.textContent || ''));
  for (let i = 0, n = Math.ceil((sel.markerWaitMs ?? 15000) / 500); i < n && !marked(); i++) await wait(500);
}
// The HTTP status of the page's own load (a 403 from Dice is a block), from the Navigation Timing entry.
export function navStatus() {
  const nav = performance.getEntriesByType('navigation')[0];
  return (nav && nav.responseStatus) || null;
}

// One search results page: settle, read; while the header reads signed out, up to 5 more reads
// 2 s apart (the session can load late); one scroll to the bottom and a second read.
export async function diceSearchProbe(sel) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await diceSettleInPage(sel);
  let snap = collectDiceCards(sel);
  for (let i = 0; i < 5 && snap.signedOut && !snap.signedIn; i++) { await wait(sel.settleMs ?? 2000); snap = collectDiceCards(sel); }
  if (snap.cards.length) {
    scrollResults();
    await wait(sel.settleMs ?? 1500 + Math.round(Math.random() * 1000));
    const more = collectDiceCards(sel);
    const known = new Set(snap.cards.map((c) => c.guid));
    snap = { ...snap, cards: [...snap.cards, ...more.cards.filter((c) => !known.has(c.guid))] };
  }
  return { url: location.href, http_status: navStatus(), snap };
}

export async function diceViewProbe(sel) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await diceSettleInPage(sel);
  let v = collectDiceView(sel);
  for (let i = 0; i < 5 && v.signed_out && !v.signed_in; i++) { await wait(sel.settleMs ?? 2000); v = collectDiceView(sel); }
  return { url: location.href, http_status: navStatus(), v };
}

// The home feed needs a session (a signed-out visit lands on the login page).
export async function diceHomeProbe(sel) {
  await diceSettleInPage(sel);
  return { url: location.href, ...authMarkers(sel) };
}

export const DICE_SEARCH_PROBE = { main: diceSearchProbe, helpers: [diceSettleInPage, navStatus, collectDiceCards, scrollResults] };
export const DICE_VIEW_PROBE = { main: diceViewProbe, helpers: [diceSettleInPage, navStatus, collectDiceView] };
export const DICE_HOME_PROBE = { main: diceHomeProbe, helpers: [diceSettleInPage, authMarkers] };
export const DICE_HOME = 'https://www.dice.com/home-feed';

// ---------- interpretation (pure: the same for both drivers) ----------
export const signedInOnHome = (m) => !!m.signedIn && !/\/(login|sign-?in)\b/i.test(m.url);

// Dice now and then serves its public search view (a "Login" header) to a signed-in session (7 of
// 11 ticks on 2026-10-29/30, each with real results): such a page asks for the home-feed check, and
// a confirmed session keeps the cards. A real expiry still reads 'login' there.
export function interpretDiceSearch({ url, http_status, snap }) {
  const status = http_status === 403 ? 'blocked' : classifyDicePage({
    title: snap.title, text: snap.text, url, loggedOut: snap.signedOut && !snap.signedIn, cardCount: snap.cards.length, emptyMarker: snap.emptyMarker,
  });
  return {
    status,
    anon_header: false,
    url,
    result_count: parseDiceResultCount(snap.countText),
    empty_marker: snap.emptyMarker,
    cards: snap.cards.map(normalizeDiceCard).filter(Boolean),
    needs_home_check: status === 'login' && snap.cards.length > 0 && !/\/(login|sign-?in)\b/i.test(url),
  };
}
export function finishDiceSearch(r, homeOk) {
  const { needs_home_check: _n, ...rest } = r;
  const status = r.needs_home_check && homeOk ? 'ok' : r.status;
  return { ...rest, status, anon_header: !!(r.needs_home_check && homeOk), cards: status === 'ok' ? r.cards : [] };
}

export function diceViewVerdict({ url, http_status, v }) {
  const verdict = http_status === 403 ? 'blocked' : classifyDicePage({ title: v.page_title, text: v.text, url, loggedOut: v.signed_out && !v.signed_in, cardCount: 1 });
  return { verdict, needs_home_check: verdict === 'login' && !!v.title && !/\/(login|sign-?in)\b/i.test(url) };
}
export function interpretDiceView({ url, v }, id, verdict) {
  if (verdict !== 'ok') return { status: verdict === 'suspect' ? 'unreadable' : verdict, url };
  const badges = parseDiceBadges(v.badges, { locationType: v.location_type });
  const loc = parseDiceLocationLine(v.loc_line);
  return {
    status: v.title && v.description_text.length >= 100 ? 'ok' : 'unreadable',
    url,
    job_id: id,
    source: 'dice',
    fetched_at: new Date().toISOString(),
    title: v.title,
    company: v.company,
    company_url: v.company_url,
    closed: CLOSED_RE.test(v.text),
    already_applied: diceAlreadyApplied({ label: v.apply_label, headerText: v.header_text }),
    apply: diceApplyTypeOf({ label: v.apply_label, href: v.apply_href }),
    location: loc.location,
    posted_text: loc.posted_text,
    date_posted: v.date_posted,
    ...badges,
    top_card_text: v.header_text,
    description_text: v.description_text,
  };
}

const CLOSED_RE = /no longer (available|accepting applications)|this job (has )?(expired|closed)|position (has been )?filled/i; // ?

// ---------- library API: the cloakbrowser driver (a Playwright page) ----------
// The home-feed sign-in check, used before a login-lost abort halts Dice.
export async function signedInAtHome(page) {
  await page.goto(DICE_HOME, { waitUntil: 'domcontentloaded' });
  return signedInOnHome(await page.evaluate(probeScript(DICE_HOME_PROBE.main, DICE_SEL, DICE_HOME_PROBE.helpers)));
}

export async function searchJobs(page, url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
  const raw = await page.evaluate(probeScript(DICE_SEARCH_PROBE.main, DICE_SEL, DICE_SEARCH_PROBE.helpers));
  const r = interpretDiceSearch({ ...raw, http_status: resp?.status() ?? raw.http_status });
  return finishDiceSearch(r, r.needs_home_check && await signedInAtHome(page).catch(() => false));
}

export async function viewJob(page, id) {
  const resp = await page.goto(diceJobUrl(diceGuid(id)), { waitUntil: 'domcontentloaded' });
  const raw = await page.evaluate(probeScript(DICE_VIEW_PROBE.main, DICE_SEL, DICE_VIEW_PROBE.helpers));
  let { verdict, needs_home_check } = diceViewVerdict({ ...raw, http_status: resp?.status() ?? raw.http_status });
  if (needs_home_check && await signedInAtHome(page).catch(() => false)) verdict = 'ok';
  return interpretDiceView(raw, id, verdict);
}

// ---------- library API: the chrome driver (a bridge run, scripts/lib/bridge.mjs) ----------
const payloadOf = (r) => { if (r.env.status !== 'ok') throw new Error(`page script error: ${r.env.error}`); return r.env.payload; };
export function chromeReaders(run) {
  const home = async () => signedInOnHome(payloadOf(await run.page({ kind: 'load', url: DICE_HOME, host: 'dice.com', ...DICE_HOME_PROBE, arg: DICE_SEL, summary: 'Check the Dice sign-in on the home feed (read-only)' })));
  return {
    signedIn: home,
    searchJobs: async (_page, url) => {
      const r = interpretDiceSearch(payloadOf(await run.page({ kind: 'load', url, host: 'dice.com', ...DICE_SEARCH_PROBE, arg: DICE_SEL, summary: 'Read a Dice job search page (read-only)' })));
      return finishDiceSearch(r, r.needs_home_check && await home().catch(() => false));
    },
    viewJob: async (_page, id) => {
      const raw = payloadOf(await run.page({ kind: 'load', url: diceJobUrl(diceGuid(id)), host: 'dice.com', ...DICE_VIEW_PROBE, arg: DICE_SEL, summary: `Read Dice job ${id} (read-only)` }));
      let { verdict, needs_home_check } = diceViewVerdict(raw);
      if (needs_home_check && await home().catch(() => false)) verdict = 'ok';
      return interpretDiceView(raw, id, verdict);
    },
  };
}

// ---------- CLI ----------
export async function capture(page, label) {
  const dir = join(DATA_DIR, 'captures');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(dir, `${stamp}-dice-${label}`);
  writeFileSync(`${base}.html`, await page.content());
  await page.screenshot({ path: `${base}.png`, fullPage: false });
  return { html: display(`${base}.html`), png: display(`${base}.png`) };
}

const waitEnter = (msg) => new Promise((resolve) => {
  console.error(msg);
  process.stdin.resume();
  process.stdin.once('data', resolve);
});

function budget(action) {
  const c = canPost('dice_jobs', action);
  if (!c.allowed) fail(`daily cap: ${c.reason}`, { capped: true, nextAllowedAt: c.nextAllowedAt });
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  // The operator clears this source's halt early, in their own words (AGENTS.md "Platform safety"):
  // logged as halt.cleared by the user. Record it in the digest and profile/decisions.md too.
  if (cmd === 'clear-halt') {
    if (typeof flags.note !== 'string' || !flags.note.trim()) fail('Pass --note "<the operator\'s words>": only the operator clears a halt early');
    const state = loadState(STATE_PATH);
    const holder = sourceState(state, 'dice');
    const was = holder.halt_until || null;
    if (!was) return out({ success: true, cleared: false, halt_until: null });
    holder.halt_until = null;
    saveStateAtomic(STATE_PATH, state);
    logAction({ actor: 'user', action: 'halt.cleared', source: 'dice', detail: { was, note: flags.note.trim().slice(0, 200), by: 'operator' } });
    return out({ success: true, cleared: true, was });
  }
  if (cmd === 'limits') return out({ success: true, usage: { dice_jobs: getUsageSummary().dice_jobs, dice_apply: getUsageSummary().dice_apply } });
  if (!['login', 'whoami', 'search', 'view'].includes(cmd)) fail('usage: dice-jobs.mjs login | whoami | search --query "..." | view --id dice-<guid> | limits | clear-halt --note "<the operator\'s words>"');
  if (cmd === 'search' && !flags.query) fail('Pass --query "..."');
  if (cmd === 'view' && !isDiceId(flags.id)) fail('Pass --id dice-<guid>');
  if (cmd === 'search') budget('searches_per_day');
  if (cmd === 'view') budget('job_views_per_day');
  // A page load outside the loop waits on the loop's stops: this source's halt, then the pause.
  // login and whoami never wait (recovering from a halt needs them).
  if (cmd === 'search' || cmd === 'view') {
    const state = loadState(STATE_PATH);
    const stop = runStop(state.sources?.dice, readPause(), Date.now());
    if (stop) fail(`${cmd} refused: ${stop.reason}`, stop);
  }

  // The chrome driver: the operator signs in to Dice in their own Chrome; whoami confirms it through
  // the bridge (it records the session the ticks wait for); search and view read through it.
  if (sessionDriver(flags) === 'chrome') {
    if (cmd === 'login') return out({ success: true, action: 'login', driver: 'chrome', manual: true, note: `Sign in to Dice as ${operatorName()} in your own Chrome (https://www.dice.com/dashboard/login), then confirm it: npm run -s browser -- start dice -- whoami` });
    let s;
    try { s = await openSession(DICE_PLATFORM, { flags, command: 'dice', source: 'dice', checkSession: cmd !== 'whoami', readers: { cloak: {}, chrome: chromeReaders } }); } catch (err) {
      if (err instanceof SessionRefused) { out(err.result); process.exit(err.code); }
      fail(err.message);
    }
    try {
      let result;
      if (cmd === 'whoami') {
        const ok = await s.io.signedIn();
        result = { success: ok, loggedIn: ok, driver: 'chrome', ...(ok ? {} : { loginRequired: true }) };
      } else if (cmd === 'search') {
        const url = buildDiceUrl(loadSearchConfig('dice-searches.json'), { keywords: flags.query, employment: flags.employment || 'contract' }, { tprSeconds: Number(flags.tpr) || 604800 });
        const r = await s.io.searchJobs(null, url);
        recordPost('dice_jobs', 'searches_per_day', { query: flags.query, via: 'cli' });
        result = { success: r.status === 'ok' || r.status === 'empty', driver: 'chrome', requested: url, ...r, count: r.cards.length };
      } else {
        const r = await s.io.viewJob(null, String(flags.id));
        recordPost('dice_jobs', 'job_views_per_day', { jobId: String(flags.id), via: 'cli' });
        result = { success: r.status === 'ok', driver: 'chrome', ...r };
      }
      if (result.status === 'login') result.loginRequired = true;
      if (cmd === 'whoami' || result.loginRequired) recordSession('dice', !result.loginRequired);
      return out(result);
    } catch (err) {
      if (err instanceof BrowserUnavailableError) {
        if (err.loaded && cmd !== 'whoami') recordPost('dice_jobs', cmd === 'search' ? 'searches_per_day' : 'job_views_per_day', { via: 'cli' });
        out({ success: false, browser: 'unavailable', why: err.why });
        process.exit(3);
      }
      fail(`${cmd} failed: ${err.message}`);
    }
  }

  const headed = cmd === 'login' || !!flags.headed || !!flags.pause;
  let context, page;
  try {
    ({ context, page } = await openContext(DICE_PLATFORM, { headed, flags, dir: DICE_PROFILE }));
  } catch (err) {
    if (err instanceof ProfileBusyError) fail(err.message, { profileBusy: true, profile: err.profile });
    fail(err.message);
  }
  try {
    let result;
    if (cmd === 'login') {
      // No Enter needed: the window stays open until the account menu shows (the operator signs
      // in by hand), or 10 minutes pass. Agents never type the password.
      await page.goto('https://www.dice.com/dashboard/login', { waitUntil: 'domcontentloaded' });
      console.error(`\nA browser window is open. Sign in to Dice as ${operatorName()}; it closes by itself once you are in (10 min max).`);
      const deadline = Date.now() + 10 * 60_000;
      let signedIn = false;
      while (!signedIn && Date.now() < deadline) {
        await page.waitForTimeout(3000);
        signedIn = (await page.locator(DICE_SEL.signedIn).count().catch(() => 0)) > 0;
      }
      if (signedIn) { await page.waitForTimeout(3000); }
      result = { success: signedIn, action: 'login', url: page.url() };
    } else if (cmd === 'whoami') {
      await page.goto('https://www.dice.com/home-feed', { waitUntil: 'domcontentloaded' });
      await settle(page);
      const { signedIn } = await page.evaluate(authMarkers, DICE_SEL);
      result = { success: signedIn, loggedIn: signedIn, url: page.url(), ...(signedIn ? {} : { loginRequired: true }) };
    } else if (cmd === 'search') {
      const cfg = loadSearchConfig('dice-searches.json');
      const url = buildDiceUrl(cfg, { keywords: flags.query, employment: flags.employment || 'contract' }, { tprSeconds: Number(flags.tpr) || 604800 });
      const r = await searchJobs(page, url);
      recordPost('dice_jobs', 'searches_per_day', { query: flags.query, via: 'cli' });
      result = { success: r.status === 'ok' || r.status === 'empty', requested: url, ...r, count: r.cards.length };
    } else {
      const r = await viewJob(page, String(flags.id));
      recordPost('dice_jobs', 'job_views_per_day', { jobId: String(flags.id), via: 'cli' });
      result = { success: r.status === 'ok', ...r };
    }
    if (['login', 'checkpoint', 'blocked'].includes(result.status)) result.loginRequired = result.status === 'login';
    if (flags.capture) result.capture = await capture(page, cmd);
    if (flags.pause) { await waitEnter('\n--pause: inspect the window. Press Enter to close.'); result.final_url = page.url(); }
    await context.close();
    out(result);
  } catch (err) {
    await context.close().catch(() => {});
    fail(`${cmd} failed: ${err.message}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
