#!/usr/bin/env node
// LinkedIn Jobs driver: READ-ONLY. It loads search result pages and job view pages as
// the operator's own account and reads them. It never clicks Apply, Save, Follow,
// Message or anything else that writes. Module shape: one selector map with ✓ (verified
// live) / ? (unverified) tags, a guard, one function per subcommand.
//
// Library use (sweep-jobs.mjs): searchJobs(page, url), viewJob(page, id). They return
// result objects and never exit the process.
//
// CLI (each page load counts against the same daily caps as the sweep):
//   node scripts/linkedin-jobs.mjs login                          # headed, sign in by hand, press Enter
//   node scripts/linkedin-jobs.mjs whoami [--headed]
//   node scripts/linkedin-jobs.mjs search --query "fractional CTO" [--geo us] [--workplace remote]
//        [--job-type contract-part-time] [--tpr 604800] [--page 0] [--headed] [--pause] [--capture]
//        (--geo and --workplace default to searches.json "defaults")
//   node scripts/linkedin-jobs.mjs view --id 9000000001 [--headed] [--pause] [--capture]
//   node scripts/linkedin-jobs.mjs limits                         # caps used today, no browser
//   node scripts/linkedin-jobs.mjs prune                          # drop limiter-log entries older than 30 days
//   node scripts/linkedin-jobs.mjs clear-halt --note "<the operator's words>"   # clear the LinkedIn halt early, no browser
//
// --pause keeps the headed window open until Enter (discovery: apply filters in the
// UI and read the URL LinkedIn generates). --capture saves page HTML + screenshot to
// <data>/captures/ (inside the workspace; sanitize before copying into tests/fixtures/).

import './lib/env.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, out, fail, openContext, isLoggedOut, ProfileBusyError, jitter,
} from './cloak-core.mjs';
import { parseCardText, parseTopCard, classifySearch, isEmptyMarkerText, parseResultCount, applyTypeOf, alreadyAppliedIn } from './lib/extract.mjs';
import { buildSearchUrl } from './lib/search-url.mjs';
import { canPost, recordPost, getUsageSummary, pruneLog } from './rate-limiter.mjs';
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

const SETTLE_MS = [3500, 4500];

// Tags: ✓ confirmed in a headed run (dated), ✓ offline confirmed only by a replay against a saved
// page, ? unconfirmed. Confirm every ? in a --headed run and update the LinkedIn selector table in
// docs/platforms.md in the same change.
export const JOBS_SEL = {
  signedIn: '#global-nav, .global-nav__me, img.global-nav__me-photo',            // ✓ (2026-06-04)
  // Search list: virtualized <li> items carry the job ID even before they render.
  listItem: 'li[data-occludable-job-id]',                                       // ✓ (classic search, 2026-10-26)
  aiCard: '[componentkey^="job-card-component-ref-"]',                           // ✓ offline (AI search /jobs/search-results/, replayed 2026-10-26)
  cardIdAttrs: ['data-occludable-job-id', 'data-job-id'],                       // ?
  viewLink: 'a[href*="/jobs/view/"]',                                            // ? (fallback when list items are absent)
  detailPane: '.jobs-search__job-details, [class*="job-details"]',               // ? (excluded from fallback ID scan)
  resultCount: '.jobs-search-results-list__subtitle, [class*="results-list__subtitle"]', // ?
  // Job view page
  viewTitle: 'h1',                                                               // ?
  viewTopCard: '[class*="top-card"], [class*="topcard"]',                       // ?
  viewDescription: '#job-details, .jobs-description__content, .jobs-box__html-content, [class*="jobs-description"]', // ?
  viewCompanyLink: 'a[href*="/company/"]',                                       // ?
  closedMarker: /no longer accepting applications|this job is no longer available|job (is )?closed/i, // ?
  // First button/link in the top card (else <main>) whose aria-label or text names Apply.
  applyControl: 'button, a',                                                     // ✓ offline Easy Apply (capture 2026-10-26); external ?
};

// ---------- browser-side collectors (run inside page.evaluate) ----------
export function collectCards(sel) {
  const cards = new Map();
  const add = (id, el) => {
    if (!/^\d{6,}$/.test(id || '')) return;
    const card = el.closest('li') || el;
    const text = (card.innerText || '').trim();
    const prev = cards.get(id);
    if (prev === undefined || text.length > prev.length) cards.set(id, text);
  };
  const items = document.querySelectorAll(sel.listItem);
  const aiCards = document.querySelectorAll(sel.aiCard);
  if (items.length) {
    for (const el of items) add(el.getAttribute('data-occludable-job-id'), el);
  } else if (aiCards.length) {
    // AI search: no <li>; the card element itself carries the ID and holds the card text.
    for (const el of aiCards) {
      const id = (el.getAttribute('componentkey') || '').replace('job-card-component-ref-', '');
      if (!/^\d{6,}$/.test(id)) continue;
      const text = (el.innerText || '').trim();
      if (!cards.has(id) || text.length > cards.get(id).length) cards.set(id, text);
    }
  } else {
    for (const attr of sel.cardIdAttrs) for (const el of document.querySelectorAll(`[${attr}]`)) add(el.getAttribute(attr), el);
    for (const a of document.querySelectorAll(sel.viewLink)) {
      if (a.closest(sel.detailPane)) continue;
      const m = (a.getAttribute('href') || '').match(/\/jobs\/view\/(\d{6,})/);
      if (m) add(m[1], a);
    }
  }
  const countEl = document.querySelector(sel.resultCount);
  const main = document.querySelector('main') || document.body;
  // The "No matching jobs found" banner renders in a layout row ABOVE <main> (probe
  // 2026-10-26), so headings and paragraphs outside <main> are read separately.
  const outside = [...document.querySelectorAll('p, h1, h2, h3')].filter((el) => !main.contains(el));
  return {
    cards: [...cards.entries()],
    countText: countEl ? countEl.innerText : '',
    mainText: (main.innerText || '').slice(0, 4000),
    outsideText: outside.map((el) => el.innerText || '').join('\n').slice(0, 3000),
    usedListItems: items.length > 0,
    usedAiCards: !items.length && aiCards.length > 0,
  };
}

// Scroll the results list (not the window) one step so virtualized cards render.
function scrollList(sel) {
  const first = document.querySelector(sel.listItem) || document.querySelector(sel.aiCard) || document.querySelector(sel.viewLink);
  let el = first;
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) { window.scrollBy(0, 900); return { atBottom: true, container: false }; }
  el.scrollBy(0, Math.round(el.clientHeight * 0.8));
  return { atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 10, container: true };
}

// The 2026-10 job view UI has hashed class names and no <h1> (probe 2026-10-26), so the
// title falls back to document.title ("<title> | <company> | LinkedIn"), the top card to the
// main text above "About the job", and the description to the nearest ancestor of that
// heading that holds more than the heading itself.
export function collectView(sel) {
  const h1 = document.querySelector(sel.viewTitle);
  const main = document.querySelector('main') || document.body;
  const mainText = main.innerText || '';
  const heading = [...document.querySelectorAll('h2, h3')].find((h) => /^\s*about the job\s*$/i.test(h.innerText || ''));
  const topEl = (h1 && h1.closest(sel.viewTopCard)) || document.querySelector(sel.viewTopCard);
  const aboutAt = mainText.search(/\n\s*About the job\s*\n/i);
  const topText = topEl ? topEl.innerText : aboutAt > 0 ? mainText.slice(0, aboutAt) : '';
  let desc = document.querySelector(sel.viewDescription);
  let descText = desc ? desc.innerText : '';
  if (descText.trim().length < 100 && heading) {
    let el = heading;
    while (el.parentElement && el !== main && (el.innerText || '').length < (heading.innerText || '').length + 100) el = el.parentElement;
    descText = (el.innerText || '').replace(/^\s*about the job\s*/i, '');
  }
  const docTitle = (document.title || '').split(' | ');
  // The first /company/ link is often the logo (no text); take the first one with text.
  const company = [...((topEl || main).querySelectorAll(sel.viewCompanyLink))].find((a) => (a.innerText || '').trim());
  const applyEl = [...((topEl || main).querySelectorAll(sel.applyControl))].find((e) => /\bapply\b/i.test(e.getAttribute('aria-label') || '') || /^\s*(easy apply|apply)\s*$/i.test(e.innerText || ''));
  return {
    title: h1 ? h1.innerText.trim() : docTitle.length >= 3 ? docTitle[0].trim() : null,
    company: company ? company.innerText.trim() : null,
    company_url: company ? company.href.split('?')[0] : null,
    top_card_text: topText.trim().slice(0, 2000),
    description_text: descText.trim().slice(0, 20000),
    main_text: mainText.slice(0, 3000),
    apply_label: applyEl ? (applyEl.getAttribute('aria-label') || applyEl.innerText || '').trim() : null,
    apply_href: applyEl && applyEl.tagName === 'A' ? applyEl.href : null,
  };
}

// Serializable selector bundle for page.evaluate (RegExp does not cross the boundary).
export const SEL_ARG = { ...JOBS_SEL, closedMarker: undefined };

// The sign-in markers of a LinkedIn page (the signed-in nav, a login link or form), read in the page.
export function loggedOutMarkers() {
  return {
    url: location.href,
    nav: document.querySelectorAll('#global-nav, .global-nav__me, img.global-nav__me-photo').length,
    login: document.querySelectorAll('a[href*="/login"], .authwall, form.login__form').length,
  };
}
// Fail toward "logged out": a false positive only stops a sweep.
export const loggedOutFrom = (m) => /\/(login|checkpoint|authwall)/.test(m.url) || (m.nav === 0 && m.login > 0);

// ---------- page probes (both drivers: page.evaluate, or a chrome bundle) ----------
// sel.settleMs replaces every wait (tests only).
// One search results page: the settle wait, the sign-in check, then up to 8 passes of read and
// scroll so virtualized cards render. Returns the raw reads; interpretSearch decides.
export async function linkedinSearchProbe(sel) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const jit = (a, b) => a + Math.round(Math.random() * (b - a));
  await wait(sel.settleMs ?? jit(3500, 4500));
  const m = loggedOutMarkers();
  if (/\/(login|checkpoint|authwall)/.test(m.url) || (m.nav === 0 && m.login > 0)) return { url: location.href, loggedOut: true, merged: [], snap: null };
  const merged = new Map();
  let snap = null;
  for (let pass = 0; pass < 8; pass++) {
    snap = collectCards(sel);
    for (const [id, text] of snap.cards) { const prev = merged.get(id); if (prev === undefined || text.length > prev.length) merged.set(id, text); }
    if (!snap.cards.length) break;
    const s = scrollList(sel);
    await wait(sel.settleMs ?? jit(900, 1400));
    if (s.atBottom) {
      const last = collectCards(sel);
      for (const [id, text] of last.cards) if (!merged.has(id) || text.length > merged.get(id).length) merged.set(id, text);
      break;
    }
  }
  return { url: location.href, loggedOut: false, merged: [...merged.entries()], snap: snap && { countText: snap.countText, mainText: snap.mainText, outsideText: snap.outsideText, usedListItems: snap.usedListItems } };
}

// One job view page: the settle wait, the sign-in check, the view read.
export async function linkedinViewProbe(sel) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(sel.settleMs ?? 3500 + Math.round(Math.random() * 1000));
  const m = loggedOutMarkers();
  if (/\/(login|checkpoint|authwall)/.test(m.url) || (m.nav === 0 && m.login > 0)) return { url: location.href, loggedOut: true, v: null };
  return { url: location.href, loggedOut: false, v: collectView(sel) };
}

// The signed-in check of whoami: the feed's sign-in markers.
export async function linkedinFeedProbe(sel = {}) {
  await new Promise((r) => setTimeout(r, sel?.settleMs ?? 3500 + Math.round(Math.random() * 1000)));
  return loggedOutMarkers();
}

export const SEARCH_PROBE = { main: linkedinSearchProbe, helpers: [collectCards, scrollList, loggedOutMarkers] };
export const VIEW_PROBE = { main: linkedinViewProbe, helpers: [collectView, loggedOutMarkers] };
export const FEED_PROBE = { main: linkedinFeedProbe, helpers: [loggedOutMarkers] };

// ---------- interpretation (pure: the same for both drivers) ----------
export function interpretSearch({ url, loggedOut, merged = [], snap = null }) {
  if (loggedOut || /\/(checkpoint|authwall)/.test(url)) {
    return { status: classifySearch({ url, loggedOut: true, idCount: 0, emptyMarker: false }), url, cards: [] };
  }
  const emptyMarker = isEmptyMarkerText(`${snap?.outsideText || ''}\n${snap?.mainText || ''}`);
  const cards = merged.map(([job_id, text]) => ({
    job_id, url: `https://www.linkedin.com/jobs/view/${job_id}/`, ...parseCardText(text),
  }));
  const status = classifySearch({ url, loggedOut: false, idCount: cards.length, emptyMarker });
  return {
    status,
    url,
    result_count: parseResultCount(snap?.countText || snap?.mainText),
    empty_marker: emptyMarker,
    used_list_items: snap?.usedListItems ?? false,
    // On a no-results page the cards are promoted filler, not matches: drop them, keep the count.
    cards: status === 'empty' ? [] : cards,
    filler_count: status === 'empty' ? cards.length : 0,
  };
}

export function interpretView({ url, loggedOut, v }, id) {
  if (loggedOut || /\/(checkpoint|authwall)/.test(url)) return { status: /\/(checkpoint|authwall)/.test(url) ? 'checkpoint' : 'login', url };
  const closed = JOBS_SEL.closedMarker.test(v.main_text);
  const parsed = parseTopCard(v.top_card_text);
  return {
    // A bare "About the job" heading is not a description: below 100 chars counts as unreadable.
    status: v.title && v.description_text.length >= 100 ? 'ok' : 'unreadable',
    url,
    job_id: id,
    fetched_at: new Date().toISOString(),
    title: v.title,
    company: v.company,
    company_url: v.company_url,
    closed,
    already_applied: alreadyAppliedIn(v.main_text),
    apply: applyTypeOf({ label: v.apply_label, href: v.apply_href }),
    ...parsed,
    top_card_text: v.top_card_text,
    description_text: v.description_text,
  };
}

// ---------- library API: the cloakbrowser driver (a Playwright page) ----------
export async function searchJobs(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return interpretSearch(await page.evaluate(probeScript(SEARCH_PROBE.main, SEL_ARG, SEARCH_PROBE.helpers)));
}

export async function viewJob(page, id) {
  await page.goto(`https://www.linkedin.com/jobs/view/${id}/`, { waitUntil: 'domcontentloaded' });
  return interpretView(await page.evaluate(probeScript(VIEW_PROBE.main, SEL_ARG, VIEW_PROBE.helpers)), id);
}

// ---------- library API: the chrome driver (a bridge run, scripts/lib/bridge.mjs) ----------
const payloadOf = (r) => { if (r.env.status !== 'ok') throw new Error(`page script error: ${r.env.error}`); return r.env.payload; };
export const chromeReaders = (run) => ({
  searchJobs: async (_page, url) => interpretSearch(payloadOf(await run.page({ kind: 'load', url, host: 'linkedin.com', ...SEARCH_PROBE, arg: SEL_ARG, summary: 'Read a LinkedIn job search page (read-only)' }))),
  viewJob: async (_page, id) => interpretView(payloadOf(await run.page({ kind: 'load', url: `https://www.linkedin.com/jobs/view/${id}/`, host: 'linkedin.com', ...VIEW_PROBE, arg: SEL_ARG, summary: `Read LinkedIn job ${id} (read-only)` })), id),
  signedIn: async () => !loggedOutFrom(payloadOf(await run.page({ kind: 'load', url: 'https://www.linkedin.com/feed/', host: 'linkedin.com', ...FEED_PROBE, summary: 'Check the LinkedIn sign-in on the feed (read-only)' }))),
});

// ---------- CLI ----------
export async function capture(page, label) {
  const dir = join(DATA_DIR, 'captures');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(dir, `${stamp}-${label}`);
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
  const c = canPost('linkedin_jobs', action);
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
    const holder = state;
    const was = holder.halt_until || null;
    if (!was) return out({ success: true, cleared: false, halt_until: null });
    holder.halt_until = null;
    saveStateAtomic(STATE_PATH, state);
    logAction({ actor: 'user', action: 'halt.cleared', source: 'linkedin', detail: { was, note: flags.note.trim().slice(0, 200), by: 'operator' } });
    return out({ success: true, cleared: true, was });
  }
  if (cmd === 'limits') return out({ success: true, usage: getUsageSummary() });
  if (cmd === 'prune') return out({ success: true, ...pruneLog(30) });
  if (!['login', 'whoami', 'search', 'view'].includes(cmd)) {
    fail('usage: linkedin-jobs.mjs login | whoami | search --query "..." | view --id <jobId> | limits | prune | clear-halt --note "<the operator\'s words>"');
  }
  if (cmd === 'search' && !flags.query) fail('Pass --query "..."');
  if (cmd === 'view' && !/^\d{6,}$/.test(String(flags.id || ''))) fail('Pass --id <numeric LinkedIn job id>');
  if (cmd === 'search') budget('searches_per_day');
  if (cmd === 'view') budget('job_views_per_day');
  // A page load outside the loop waits on the loop's stops: this source's halt, then the pause.
  // login and whoami never wait (recovering from a halt needs them).
  if (cmd === 'search' || cmd === 'view') {
    const state = loadState(STATE_PATH);
    const stop = runStop(state, readPause(), Date.now());
    if (stop) fail(`${cmd} refused: ${stop.reason}`, stop);
  }

  const cfgUrl = () => {
    const cfg = loadSearchConfig('searches.json');
    const d = cfg.defaults || {};
    const q = { keywords: flags.query, geo: flags.geo || d.geo || 'us', workplace: flags.workplace || d.workplace || 'remote', job_type: flags['job-type'] || undefined };
    return buildSearchUrl(cfg, q, { tprSeconds: Number(flags.tpr) || 604800, page: Number(flags.page) || 0 });
  };
  // The chrome driver: the operator signs in to LinkedIn in their own Chrome; whoami confirms it
  // through the bridge (it records the session the ticks wait for); search and view read through it.
  if (sessionDriver(flags) === 'chrome') {
    if (cmd === 'login') return out({ success: true, action: 'login', driver: 'chrome', manual: true, note: `Sign in to LinkedIn as ${operatorName()} in your own Chrome (https://www.linkedin.com/login), then confirm it: npm run -s browser -- start jobs -- whoami` });
    let s;
    try { s = await openSession('linkedin', { flags, command: 'jobs', source: 'linkedin', checkSession: cmd !== 'whoami', readers: { cloak: {}, chrome: chromeReaders } }); } catch (err) {
      if (err instanceof SessionRefused) { out(err.result); process.exit(err.code); }
      fail(err.message);
    }
    try {
      let result;
      if (cmd === 'whoami') {
        const ok = await s.io.signedIn();
        result = { success: ok, loggedIn: ok, driver: 'chrome', ...(ok ? {} : { loginRequired: true }) };
      } else if (cmd === 'search') {
        const url = cfgUrl();
        const r = await s.io.searchJobs(null, url);
        recordPost('linkedin_jobs', 'searches_per_day', { query: flags.query, via: 'cli' });
        result = { success: r.status === 'ok' || r.status === 'empty', driver: 'chrome', requested: url, ...r, count: r.cards.length };
      } else {
        const r = await s.io.viewJob(null, String(flags.id));
        recordPost('linkedin_jobs', 'job_views_per_day', { jobId: String(flags.id), via: 'cli' });
        result = { success: r.status === 'ok', driver: 'chrome', ...r };
      }
      if (result.status === 'login' || result.status === 'checkpoint') result.loginRequired = true;
      if (cmd === 'whoami' || result.loginRequired) recordSession('linkedin', !result.loginRequired);
      return out(result);
    } catch (err) {
      if (err instanceof BrowserUnavailableError) {
        if (err.loaded && cmd !== 'whoami') recordPost('linkedin_jobs', cmd === 'search' ? 'searches_per_day' : 'job_views_per_day', { via: 'cli' });
        out({ success: false, browser: 'unavailable', why: err.why });
        process.exit(3);
      }
      fail(`${cmd} failed: ${err.message}`);
    }
  }

  const headed = cmd === 'login' || !!flags.headed || !!flags.pause;
  let context, page;
  try {
    ({ context, page } = await openContext('linkedin', { headed, flags }));
  } catch (err) {
    if (err instanceof ProfileBusyError) fail(err.message, { profileBusy: true, profile: err.profile });
    fail(err.message);
  }

  try {
    let result;
    if (cmd === 'login') {
      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
      await waitEnter(`\nA browser window is open. Sign in to LinkedIn as ${operatorName()} (the account the hunt reads as), then press Enter here.`);
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      result = { success: !(await isLoggedOut(page)), action: 'login' };
    } else if (cmd === 'whoami') {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(jitter(SETTLE_MS));
      const loggedOut = await isLoggedOut(page);
      result = { success: !loggedOut, loggedIn: !loggedOut, url: page.url(), ...(loggedOut ? { loginRequired: true } : {}) };
    } else if (cmd === 'search') {
      const url = cfgUrl();
      const r = await searchJobs(page, url);
      recordPost('linkedin_jobs', 'searches_per_day', { query: flags.query, via: 'cli' });
      result = { success: r.status === 'ok' || r.status === 'empty', requested: url, ...r, count: r.cards.length };
      if (r.status === 'login' || r.status === 'checkpoint') result.loginRequired = true;
    } else if (cmd === 'view') {
      const r = await viewJob(page, String(flags.id));
      recordPost('linkedin_jobs', 'job_views_per_day', { jobId: String(flags.id), via: 'cli' });
      result = { success: r.status === 'ok', ...r };
      if (r.status === 'login' || r.status === 'checkpoint') result.loginRequired = true;
    }
    if (flags.capture) result.capture = await capture(page, cmd);
    if (flags.pause) await waitEnter('\n--pause: inspect the window (apply UI filters, read the URL). Press Enter to close.');
    if (flags.pause) result.final_url = page.url();
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
