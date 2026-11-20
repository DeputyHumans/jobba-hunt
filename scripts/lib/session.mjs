// One browser session for an entrypoint, by driver (config/browser.json `driver`, --driver):
//   cloakbrowser  opens the bundled Chromium profile: a Playwright page and the page readers
//   chrome        joins the bridge run `npm run browser -- start <command>` started (bridge.mjs):
//                 no page here; the readers ask the agent for every page through the bridge
// Refusals come back as { code, result } for the entrypoint's own finish(): a busy profile (3), a
// chrome command started outside the bridge, a cloakbrowser-only flag, a source whose sign-in in
// Chrome was never confirmed (2).
import { openContext, ProfileBusyError } from '../cloak-core.mjs';
import { ChromeNeedsBridgeError, bridgeRun } from './bridge.mjs';
import { browserDriver, sessionConfirmed } from './browser.mjs';
import { loadConfig } from './config.mjs';

export class SessionRefused extends Error {
  constructor(code, result) { super(result.reason); this.code = code; this.result = result; }
}

export function sessionDriver(flags = {}) {
  return browserDriver({ flags, cfg: loadConfig('browser.json', { required: false }) });
}

// readers: { cloak: { searchJobs, viewJob, ... }, chrome: (run) => ({ searchJobs, viewJob, signedIn }) }.
// source: 'linkedin' | 'dice', for the chrome sign-in gate; checkSession false for whoami itself.
export async function openSession(platform, { flags = {}, headed = false, dir, command, readers, source = null, checkSession = true }) {
  const driver = sessionDriver(flags);
  if (driver === 'cloakbrowser') {
    try {
      const { context, page } = await openContext(platform, { headed, flags, dir });
      return { driver, page, io: readers.cloak, close: () => context.close().catch(() => {}) };
    } catch (err) {
      if (err instanceof ProfileBusyError) throw new SessionRefused(3, { success: false, profileBusy: true, profile: err.profile, reason: err.message });
      throw err;
    }
  }
  for (const f of ['force-reap', 'profile', 'pause', 'capture']) {
    if (flags[f]) throw new SessionRefused(2, { success: false, refused: true, cap: 'chrome-unsupported-flag', reason: `--${f} belongs to the cloakbrowser driver (--driver cloakbrowser)` });
  }
  if (checkSession && source && !sessionConfirmed(source)) {
    throw new SessionRefused(2, { success: false, refused: true, cap: 'chrome-session-unconfirmed', reason: `the ${source} sign-in in Chrome is not confirmed: sign in there, then npm run -s browser -- start ${source === 'dice' ? 'dice' : 'jobs'} -- whoami` });
  }
  let run;
  try { run = bridgeRun(command); } catch (err) {
    if (err instanceof ChromeNeedsBridgeError) throw new SessionRefused(2, { success: false, refused: true, cap: err.cap, reason: err.message });
    throw err;
  }
  return { driver, page: null, run, io: readers.chrome(run), close: async () => {} };
}
