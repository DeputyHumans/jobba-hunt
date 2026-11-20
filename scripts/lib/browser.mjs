// The browser driver (config/browser.json `driver`): which browser does the page work.
//   cloakbrowser  the bundled CloakBrowser Chromium, driven by the scripts through playwright-core
//   chrome        the operator's own Google Chrome, driven by the agent through the Claude in Chrome
//                 extension; the scripts keep every gate, cap, plan and record
// The choice never touches a cap, a halt or the pause: both drivers count against the same limits.
// A channel is verified per driver: `verified` in config/apply.json for cloakbrowser,
// `verified_chrome` for chrome. Each needs its own headed dry run checked by the operator.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './paths.mjs';

export const DRIVERS = ['chrome', 'cloakbrowser'];
const DEFAULT = 'chrome';

// --driver beats JOBBA_BROWSER_DRIVER (tests), which beats config/browser.json.
export function browserDriver({ flags = {}, cfg = {}, env = process.env } = {}) {
  const pick = flags.driver ?? env.JOBBA_BROWSER_DRIVER ?? cfg.driver ?? DEFAULT;
  if (!DRIVERS.includes(pick)) throw new Error(`browser driver must be chrome or cloakbrowser (got ${JSON.stringify(pick)}): --driver or config/browser.json driver`);
  return pick;
}

export const verifiedKey = (driver) => (driver === 'chrome' ? 'verified_chrome' : 'verified');

export function channelVerified(applyCfg, channel, driver) {
  return applyCfg?.[verifiedKey(driver)]?.[channel] === true;
}

// Under chrome, a source's sign-in is confirmed by a served whoami (or lost on a login-lost abort):
// <data>/state/browser-sessions.json { chrome: { linkedin: { logged_in, checked_at } } }. Ticks,
// sweeps, probes and the reader CLIs refuse until it is confirmed, so a Chrome never signed in to a
// board cannot produce a false login-lost halt.
const sessionsPath = () => join(DATA_DIR, 'state', 'browser-sessions.json');
const readSessions = () => { try { return existsSync(sessionsPath()) ? JSON.parse(readFileSync(sessionsPath(), 'utf8')) : {}; } catch { return {}; } };
export const sessionConfirmed = (source) => readSessions().chrome?.[source]?.logged_in === true;
export function recordSession(source, loggedIn, at = new Date().toISOString()) {
  const s = readSessions();
  s.chrome = { ...(s.chrome || {}), [source]: { logged_in: !!loggedIn, checked_at: at } };
  mkdirSync(dirname(sessionsPath()), { recursive: true });
  const tmp = `${sessionsPath()}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`);
  renameSync(tmp, sessionsPath());
}
