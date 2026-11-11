// In-folder runtime defaults. Imported (directly or through state.mjs / cloak-core.mjs) before
// anything launches a browser or a CLI, so nothing reads or writes outside the project:
//   - the CloakBrowser binary lives in <repo>/.cache/cloakbrowser
//   - browser profiles live in <workspace>/data/browser/<platform>
//   - workspace/.secrets/.env (KEY=VALUE lines) is loaded once, without overriding the shell
//   - the bikeshed and gws CLIs get their config dirs under workspace/.secrets through
//     childEnv(), never through the global environment
// An explicit environment variable always wins over a default here.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, DATA_DIR, SECRETS_DIR } from './paths.mjs';

export function parseDotEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const DOTENV = join(SECRETS_DIR, '.env');
if (existsSync(DOTENV)) {
  for (const [k, v] of Object.entries(parseDotEnv(readFileSync(DOTENV, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const setDefault = (k, v) => { if (!process.env[k]) process.env[k] = v; };
setDefault('CLOAKBROWSER_CACHE_DIR', join(CACHE_DIR, 'cloakbrowser'));
setDefault('CLOAK_PROFILE_DIR', join(DATA_DIR, 'browser'));

// The environment for one project-local CLI. Config dirs are created on first use.
export function childEnv(tool) {
  const env = { ...process.env };
  if (tool === 'bikeshed') {
    const xdg = join(SECRETS_DIR, 'xdg');
    if (!env.BIKESHED_TOKEN) { mkdirSync(xdg, { recursive: true }); env.XDG_CONFIG_HOME = xdg; }
  } else if (tool === 'gws') {
    const dir = process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR || join(SECRETS_DIR, 'gws');
    mkdirSync(dir, { recursive: true });
    env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = dir;
    env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND = env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND || 'file';
    // Credentials come only from the workspace: never the host's gcloud application-default
    // credentials, a service-account file or tokens exported in the shell. The CLI also gets an
    // in-folder home, so a well-known credentials file under the real home is never found.
    for (const k of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_WORKSPACE_CLI_TOKEN', 'GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE', 'CLOUDSDK_CONFIG']) delete env[k];
    const home = join(SECRETS_DIR, 'gws-home');
    mkdirSync(home, { recursive: true });
    env.HOME = home;
    env.XDG_CONFIG_HOME = join(home, '.config');
    env.CLOUDSDK_CONFIG = join(home, '.config', 'gcloud');
  }
  return env;
}
