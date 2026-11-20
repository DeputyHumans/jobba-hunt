// The browser driver (config/browser.json `driver`): which browser does the page work.
//   cloakbrowser  the bundled CloakBrowser Chromium, driven by the scripts through playwright-core
//   chrome        the operator's own Google Chrome, driven by the agent through the Claude in Chrome
//                 extension; the scripts keep every gate, cap, plan and record
// The choice never touches a cap, a halt or the pause: both drivers count against the same limits.
// A channel is verified per driver: `verified` in config/apply.json for cloakbrowser,
// `verified_chrome` for chrome. Each needs its own headed dry run checked by the operator.

export const DRIVERS = ['chrome', 'cloakbrowser'];
const DEFAULT = 'cloakbrowser';

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
