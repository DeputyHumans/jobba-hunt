// Every path the project uses, resolved from two roots and nothing else:
//   CODE_ROOT  the repository (scripts, brand, templates, tests)
//   HOME       the user's workspace (profile, config, collateral, pipeline, data); default
//              <repo>/workspace, override with JOBBA_HOME
// No module may build a path from homedir() or from "../" above CODE_ROOT. A path that is
// given on the command line resolves against CODE_ROOT first, then HOME (resolveArgPath).

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOME = resolve(process.env.JOBBA_HOME || join(CODE_ROOT, 'workspace'));
export const DATA_DIR = resolve(process.env.JOBBA_DATA_DIR || join(HOME, 'data'));

export const PROFILE_DIR = join(HOME, 'profile');
export const CONFIG_DIR = join(HOME, 'config');
export const COLLATERAL_DIR = join(HOME, 'collateral');
export const CV_SRC = join(COLLATERAL_DIR, 'cv');
export const PIPELINE_DIR = join(HOME, 'pipeline');
export const SECRETS_DIR = join(HOME, '.secrets');
export const SOURCES_DIR = join(HOME, 'sources');
export const OUT_DIR = join(DATA_DIR, 'out');
export const CV_OUT = join(OUT_DIR, 'cv');
export const LOG_DIR = join(DATA_DIR, 'log');

export const TEMPLATES_DIR = join(CODE_ROOT, 'templates', 'workspace');
export const CACHE_DIR = join(CODE_ROOT, '.cache');
export const BIN_DIR = join(CODE_ROOT, 'node_modules', '.bin');
export const SCRIPTS_DIR = join(CODE_ROOT, 'scripts');
// The harness's local, gitignored settings (mail-guard writes its deny rules there). Tests point it elsewhere.
export const CLAUDE_LOCAL_SETTINGS = resolve(process.env.JOBBA_CLAUDE_LOCAL_SETTINGS || join(CODE_ROOT, '.claude', 'settings.local.json'));

// The brand pack: <workspace>/brand overrides single files of <repo>/brand.
export const BRAND_DIR = join(CODE_ROOT, 'brand');
export const brandFile = (...p) => {
  const own = join(HOME, 'brand', ...p);
  return existsSync(own) ? own : join(BRAND_DIR, ...p);
};

export const ws = (...p) => join(HOME, ...p);
export const code = (...p) => join(CODE_ROOT, ...p);
export const data = (...p) => join(DATA_DIR, ...p);
export const configPath = (name) => join(CONFIG_DIR, name);
export const profilePath = (name) => join(PROFILE_DIR, name);
export const templatePath = (...p) => join(TEMPLATES_DIR, ...p);

export const workspaceExists = () => existsSync(join(PROFILE_DIR, 'person.json'));

const within = (root, p) => {
  const r = relative(root, p);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};
export const insideProject = (p) => within(CODE_ROOT, resolve(p)) || within(HOME, resolve(p)) || within(DATA_DIR, resolve(p));

// A path from a CLI flag or a skill: absolute is kept; relative resolves against CODE_ROOT
// (the documented convention, e.g. workspace/data/applications/<id>/letter.pdf), then HOME.
export function resolveArgPath(p) {
  if (!p || p === true) return null;
  const m = /^\$(JOBBA_HOME|JOBBA_DATA_DIR)[\\/](.*)$/.exec(String(p));
  if (m) return join(m[1] === 'JOBBA_HOME' ? HOME : DATA_DIR, m[2]);
  if (isAbsolute(p)) return p;
  const fromCode = resolve(CODE_ROOT, p);
  if (existsSync(fromCode)) return fromCode;
  const fromHome = resolve(HOME, p);
  return existsSync(fromHome) ? fromHome : fromCode;
}

// The repo-relative spelling of a path, for messages, logs and the tracker. Never an absolute path.
export function display(p) {
  if (!p) return p;
  const abs = resolve(p);
  if (within(CODE_ROOT, abs)) return relative(CODE_ROOT, abs) || '.';
  if (within(HOME, abs)) return join('$JOBBA_HOME', relative(HOME, abs));
  if (within(DATA_DIR, abs)) return join('$JOBBA_DATA_DIR', relative(DATA_DIR, abs));
  return p;
}

// A project-local CLI from node_modules/.bin; an explicit env override (JOBBA_<NAME>_BIN) wins.
export function toolBin(name) {
  const env = process.env[`JOBBA_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BIN`];
  if (env) return env;
  return join(BIN_DIR, name);
}

// An installed Google Chrome (or Chromium), for rendering documents when no CloakBrowser build is
// there (lib/pdf.mjs). macOS: the app in /Applications or the user's own Applications folder.
export function systemChromeCandidates() {
  if (process.platform === 'darwin') {
    const app = 'Google Chrome.app/Contents/MacOS/Google Chrome';
    return [join('/Applications', app), join(homedir(), 'Applications', app)];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
}

// Where Claude Code installs its connection to the Claude in Chrome extension (a native messaging
// host manifest), per browser. Present once `claude --chrome` ran with the extension installed.
export function nativeHostFiles() {
  const name = 'com.anthropic.claude_code_browser_extension.json';
  const roots = process.platform === 'darwin'
    ? ['Google/Chrome', 'Microsoft Edge', 'Chromium', 'BraveSoftware/Brave-Browser'].map((b) => join(homedir(), 'Library', 'Application Support', b))
    : ['google-chrome', 'chromium', 'microsoft-edge', 'BraveSoftware/Brave-Browser'].map((b) => join(homedir(), '.config', b));
  return roots.map((r) => join(r, 'NativeMessagingHosts', name));
}
