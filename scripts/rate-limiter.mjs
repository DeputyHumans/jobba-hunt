/**
 * File-based rate limiter for the LinkedIn and Dice job reading (sweeps, loop ticks, probes)
 * and for approved applications.
 *
 * Caps live in config/limits.json (template defaults merged under the workspace file):
 *   { <platform>: { <action>: { max, windowHours, jitterMin?, jitterMax?, rolling? } } }
 * Daily caps reset at preferences.schedule.reset_hour in preferences.schedule.tz, the same
 * boundary the "no retry today" halt uses (lib/tick-plan.mjs). A limit with `rolling: true`
 * counts a trailing windowHours window instead. Pacing between page loads (search and view gaps)
 * lives in the search configs because the jitter fields here are in minutes.
 *
 * Never bypass: there is deliberately no force flag anywhere in this project. A cap is raised
 * only on the user's explicit word, recorded in profile/decisions.md, or for one day through a
 * dated cap override (data/state/cap-overrides.json, see capOverride). A load recorded past the
 * standing cap carries cap_override in its metadata, and recordPost writes it to the action log.
 * After such a day `available` can go negative; callers clamp it.
 *
 * Every call reads the log fresh, so two processes see each other's loads.
 */

import './lib/env.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './lib/paths.mjs';
import { loadConfig, readJsonFile } from './lib/config.mjs';
import { schedule } from './lib/profile.mjs';
import { lastResetAt, nextResetAt } from './lib/tick-plan.mjs';
import { logAction } from './lib/actions-log.mjs';

const DEFAULT_SCHEDULE = { tz: 'UTC', reset_hour: 4 };

// The limiter log: JOBBA_LIMITS_LOG, else <data>/state/limits-log.json. Read per call so a test
// (or a second workspace) can point it elsewhere before the first use.
export const limitsLogPath = () => process.env.JOBBA_LIMITS_LOG || join(DATA_DIR, 'state', 'limits-log.json');
export const capOverridesPath = () => join(DATA_DIR, 'state', 'cap-overrides.json');

// The cap table without comment keys ("_comment", "_why").
export function loadLimits() {
  const raw = loadConfig('limits.json', { required: false });
  const out = {};
  for (const [platform, actions] of Object.entries(raw)) {
    if (platform.startsWith('_') || !actions || typeof actions !== 'object') continue;
    out[platform] = {};
    for (const [action, limit] of Object.entries(actions)) {
      if (action.startsWith('_') || !limit || typeof limit !== 'object') continue;
      out[platform][action] = limit;
    }
  }
  return out;
}

function resetSchedule() {
  try {
    const s = schedule() || {};
    return { tz: s.tz || DEFAULT_SCHEDULE.tz, reset_hour: s.reset_hour ?? DEFAULT_SCHEDULE.reset_hour };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

// Per-call context: tests pass limits, now and sched; the CLIs use the workspace.
const ctx = (o = {}) => ({ limits: o.limits || loadLimits(), now: o.now ?? Date.now(), sched: o.schedule || resetSchedule() });
const resetHourOf = (limit, sched) => (limit.rolling ? null : (limit.resetHour ?? sched.reset_hour));

function loadLog() {
  const file = limitsLogPath();
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    return [];
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (error) {
    console.error('Error loading the limiter log:', error);
    return [];
  }
}

function saveLog(log) {
  const file = limitsLogPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(log, null, 2), 'utf-8');
}

// Start of the current counting window: the most recent reset_hour:00 in tz for a daily cap,
// else now minus windowHours. Entries at or after it are in the window.
function windowStart(limit, now, sched) {
  const h = resetHourOf(limit, sched);
  if (h != null) return lastResetAt(now, sched.tz, h);
  return now - limit.windowHours * 60 * 60 * 1000;
}

// When the window next frees a slot: the next reset for a daily cap, else oldest + windowHours.
function windowResetAt(limit, oldestTime, now, sched) {
  const h = resetHourOf(limit, sched);
  if (h != null) return nextResetAt(now, sched.tz, h);
  return oldestTime + limit.windowHours * 60 * 60 * 1000;
}

function getEntriesInWindow(log, platform, actionType, limit, now, sched) {
  const cutoff = windowStart(limit, now, sched);
  return log.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff && entry.platform === platform && entry.actionType === actionType);
}

function getLastEntry(log, platform, actionType) {
  let last = null;
  for (const e of log) {
    if (e.platform !== platform || e.actionType !== actionType) continue;
    if (!last || new Date(e.timestamp).getTime() > new Date(last.timestamp).getTime()) last = e;
  }
  return last;
}

const oldestOf = (entries) => Math.min(...entries.map((e) => new Date(e.timestamp).getTime()));
const windowDesc = (limit, sched) => {
  const h = resetHourOf(limit, sched);
  return h != null ? `daily cap (resets ${String(h).padStart(2, '0')}:00 ${sched.tz})` : `${limit.windowHours}h window`;
};

/**
 * Whether one more action fits the caps.
 * @param {string} platform  limits.json group, e.g. linkedin_jobs
 * @param {string} actionType  e.g. searches_per_day
 * @param {{ now?: number, limits?: object, schedule?: {tz, reset_hour} }} options  test injection
 * @returns {{ allowed: boolean, reason?: string, nextAllowedAt?: string }}
 */
export function canPost(platform, actionType, options = {}) {
  const { limits, now, sched } = ctx(options);
  const limit = limits[platform]?.[actionType];
  if (!limit) return { allowed: false, reason: `Unknown platform/action type: ${platform}/${actionType}` };

  const log = loadLog();
  const inWindow = getEntriesInWindow(log, platform, actionType, limit, now, sched);
  if (inWindow.length >= limit.max) {
    return {
      allowed: false,
      reason: `Limit reached: ${inWindow.length}/${limit.max} in ${windowDesc(limit, sched)}`,
      nextAllowedAt: new Date(windowResetAt(limit, oldestOf(inWindow), now, sched)).toISOString(),
    };
  }

  if (limit.jitterMin && limit.jitterMax) {
    const last = getLastEntry(log, platform, actionType);
    if (last) {
      const lastTime = new Date(last.timestamp).getTime();
      const minGapMs = limit.jitterMin * 60 * 1000;
      if (now - lastTime < minGapMs) {
        return {
          allowed: false,
          reason: `Jitter gap: must wait ${limit.jitterMin}-${limit.jitterMax} min between ${actionType}`,
          nextAllowedAt: new Date(lastTime + minGapMs).toISOString(),
        };
      }
    }
  }
  return { allowed: true };
}

/**
 * Record one action. Metadata (runId, query, jobId, via, cap_override, override_reason, ...) is
 * stored with the entry. A load past the standing cap (metadata.cap_override) is also written to
 * the action log as cap.override.
 */
export function recordPost(platform, actionType, metadata = {}, { now = Date.now() } = {}) {
  const log = loadLog();
  const entry = { timestamp: new Date(now).toISOString(), platform, actionType, ...metadata };
  log.push(entry);
  saveLog(log);
  if (metadata.cap_override) {
    logAction({
      actor: 'script', action: 'cap.override', source: platform, job_id: metadata.jobId,
      detail: { action: actionType, reason: metadata.override_reason ? String(metadata.override_reason).slice(0, 120) : null },
    });
  }
  return entry;
}

/** Usage per platform and action: count, max, available, resetsAtHour, nextAllowedAt. */
export function getUsageSummary(options = {}) {
  const { limits, now, sched } = ctx(options);
  const log = loadLog();
  const summary = {};
  for (const [platform, actions] of Object.entries(limits)) {
    summary[platform] = {};
    for (const [actionType, limit] of Object.entries(actions)) {
      const inWindow = getEntriesInWindow(log, platform, actionType, limit, now, sched);
      const status = { count: inWindow.length, max: limit.max, windowHours: limit.windowHours, available: limit.max - inWindow.length };
      const h = resetHourOf(limit, sched);
      if (h != null) { status.resetsAtHour = h; status.tz = sched.tz; }
      if (limit.jitterMin && limit.jitterMax) {
        const last = getLastEntry(log, platform, actionType);
        if (last) {
          const lastTime = new Date(last.timestamp).getTime();
          const minGapMs = limit.jitterMin * 60 * 1000;
          if (now - lastTime < minGapMs) {
            status.jitterBlocked = true;
            status.nextAllowedAt = new Date(lastTime + minGapMs).toISOString();
          }
        }
      }
      if (inWindow.length >= limit.max) {
        const next = new Date(windowResetAt(limit, oldestOf(inWindow), now, sched)).toISOString();
        if (!status.nextAllowedAt || new Date(next) > new Date(status.nextAllowedAt)) status.nextAllowedAt = next;
      }
      summary[platform][actionType] = status;
    }
  }
  return summary;
}

/**
 * The cap override for today, if the user gave one: an entry of data/state/cap-overrides.json
 * [{ date: "YYYY-MM-DD" (in schedule.tz), platform, action, max, by }]. Only today's date matches,
 * so an override never outlives its day. Returns the entry or null.
 */
export function capOverride(platform, action, { now = Date.now(), path = capOverridesPath(), schedule: sched = resetSchedule() } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: sched.tz }).format(new Date(now));
  let list;
  try { list = readJsonFile(path, []); } catch { return null; }
  return (Array.isArray(list) ? list : []).find((o) => o.date === today && o.platform === platform && o.action === action) || null;
}

/** Remove log entries older than daysToKeep days. */
export function pruneLog(daysToKeep = 30) {
  const log = loadLog();
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const kept = log.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);
  saveLog(kept);
  return { removed: log.length - kept.length, remaining: kept.length };
}
