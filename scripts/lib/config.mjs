// Workspace config loader. A workspace file (<workspace>/config/<name>) is merged over the shipped
// default (templates/workspace/config/<name>): objects merge key by key, arrays and scalars from the
// workspace win. Keys starting with "_" are comments and never merged into behaviour.
// The search configs get their schedule (tz, days, start, end) from profile/preferences.json, the
// single source for every time window (loadSearchConfig).

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR, PROFILE_DIR, TEMPLATES_DIR, workspaceExists } from './paths.mjs';

export class WorkspaceMissingError extends Error {
  constructor() {
    super('No workspace found. Run /hunt-onboard (or `npm run onboard -- init`) first, or point JOBBA_HOME at an existing workspace.');
    this.workspaceMissing = true;
  }
}

export const readJsonFile = (p, fallback) => {
  if (!existsSync(p)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing file: ${p}`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
};

export function writeJsonAtomic(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, p);
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(base, over) {
  if (!isPlain(base) || !isPlain(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export function requireWorkspace() {
  if (!workspaceExists()) throw new WorkspaceMissingError();
}

// One config file: the template default with the workspace file over it.
export function loadConfig(name, { required = true } = {}) {
  const tpl = join(TEMPLATES_DIR, 'config', name);
  const own = join(CONFIG_DIR, name);
  const base = existsSync(tpl) ? readJsonFile(tpl) : {};
  if (!existsSync(own)) {
    if (required && !workspaceExists()) throw new WorkspaceMissingError();
    return base;
  }
  return deepMerge(base, readJsonFile(own));
}

export const configFile = (name) => join(CONFIG_DIR, name);

export function saveConfig(name, obj) {
  writeJsonAtomic(join(CONFIG_DIR, name), obj);
}

// The raw workspace file only (no template merge), for read-modify-write updates.
export const loadOwnConfig = (name, fallback = {}) => readJsonFile(join(CONFIG_DIR, name), fallback);

function preferencesSchedule() {
  const tplPrefs = readJsonFile(join(TEMPLATES_DIR, 'profile', 'preferences.json'), {});
  const own = readJsonFile(join(PROFILE_DIR, 'preferences.json'), {});
  return deepMerge(tplPrefs.schedule || {}, own.schedule || {});
}

// searches.json / dice-searches.json with tick.{tz,days,start,end} from preferences.schedule.
export function loadSearchConfig(name) {
  const cfg = loadConfig(name);
  const s = preferencesSchedule();
  cfg.tick = { ...(cfg.tick || {}), tz: s.tz, days: s.days, start: s.tick_start, end: s.tick_end };
  return cfg;
}
