// Loop-tick planning. Pure: no browser, no network, no clock reads (callers pass ms).
// A tick runs ONE search: the AI canary every `canary_every` ticks, otherwise the
// classic query whose last ok run is oldest (respecting `min_interval_hours`). Each
// classic query searches back to its own last ok run plus a buffer, so a skipped or
// blocked tick costs latency, never coverage. Business hours are wall-clock in the
// configured time zone, so DST needs no special case.

import { tprSeconds } from './window.mjs';

const MIN = 60_000;
const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return fmtCache.get(tz);
}
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function local(ms, tz) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { dow: DOW[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// ---------- daily reset boundaries in a time zone ----------
// The caps and the "no retry today" halt both reset at reset_hour:00 wall-clock in the configured
// zone, never in the host's zone. Computed from the zone offset, so DST needs no special case.
const ymdCache = new Map();
function ymdFmt(tz) {
  if (!ymdCache.has(tz)) {
    ymdCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return ymdCache.get(tz);
}
function wall(ms, tz) {
  const p = Object.fromEntries(ymdFmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}
// The instant whose wall-clock time in tz is y-m-d h:00 (two passes settle a DST edge).
function zonedHour(y, m, d, h, tz) {
  const target = Date.UTC(y, m - 1, d, h);
  let t = target;
  for (let i = 0; i < 2; i++) {
    const w = wall(t, tz);
    t += target - Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s);
  }
  return t;
}
const shiftDay = ({ y, m, d }, n) => {
  const u = new Date(Date.UTC(y, m - 1, d + n));
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() };
};

// The most recent reset at or before ms.
export function lastResetAt(ms, tz, hour = 4) {
  const w = wall(ms, tz);
  const today = zonedHour(w.y, w.m, w.d, hour, tz);
  if (today <= ms) return today;
  const y = shiftDay(w, -1);
  return zonedHour(y.y, y.m, y.d, hour, tz);
}

// The first reset strictly after ms.
export function nextResetAt(ms, tz, hour = 4) {
  const w = wall(ms, tz);
  const today = zonedHour(w.y, w.m, w.d, hour, tz);
  if (today > ms) return today;
  const n = shiftDay(w, 1);
  return zonedHour(n.y, n.m, n.d, hour, tz);
}
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export function isOpen(ms, { tz, days, start, end }) {
  const { dow, minutes } = local(ms, tz);
  return days.includes(dow) && minutes >= hm(start) && minutes < hm(end);
}

// First minute boundary at or after ms that satisfies pred, scanning up to `limitDays`.
function scan(ms, pred, limitDays) {
  if (pred(ms)) return ms;
  let t = Math.ceil(ms / MIN) * MIN;
  for (let i = 0; i < limitDays * 1440; i++, t += MIN) if (pred(t)) return t;
  throw new Error('no matching time found in scan window');
}

export function nextOpen(ms, hours) {
  return scan(ms, (t) => isOpen(t, hours), 8);
}

// Abort -> halt. A checkpoint stops everything for 7 days (CLAUDE.md). Any other abort
// means "no retry today": halt until the next reset_hour:00 in tz, when the caps reset.
// Callers pass schedule().reset_hour.
export function haltUntil(abort, ms, tz, resetHour = 4) {
  if (!abort) return null;
  if (abort === 'checkpoint') return new Date(ms + 7 * 1440 * MIN).toISOString();
  return new Date(nextResetAt(ms, tz, resetHour ?? 4)).toISOString();
}

export function isHalted(state, ms) {
  return !!state.halt_until && ms < Date.parse(state.halt_until);
}

export function queryWindow(state, queryId, ms, windowCfg) {
  const last = state.query_runs?.[queryId]?.last_ok || state.last_successful_sweep;
  return tprSeconds(last, ms, windowCfg);
}

export function pickTick(cfg, state, ms) {
  const t = cfg.tick;
  const c = cfg.canary;
  const canary = { kind: 'canary', id: c.id, keywords: c.keywords, scope: c.scope || 'canary', canary: true, query: c, tprSeconds: c.tpr_seconds };
  const every = t.canary_every || 2;
  if (state.ticks_since_canary == null || state.ticks_since_canary >= every - 1) return canary;

  const lastOk = (id) => {
    const iso = state.query_runs?.[id]?.last_ok;
    return iso ? Date.parse(iso) : -Infinity;
  };
  const eligible = cfg.queries
    .map((q, i) => ({ q, i, last: lastOk(q.id) }))
    .filter(({ q, last }) => ms - last >= (t.min_interval_hours?.[q.id] || 0) * 3600 * 1000)
    .sort((a, b) => (a.last - b.last) || (a.i - b.i));
  if (!eligible.length) return canary;
  const { q } = eligible[0];
  return { kind: 'query', id: q.id, keywords: q.keywords, scope: q.scope, canary: false, query: q, tprSeconds: queryWindow(state, q.id, ms, cfg.window) };
}

// Seconds until the next tick, for ScheduleWakeup (clamped there to [60, 3600]).
// Inside hours: a jittered gap. Outside: hop toward the next window; on the final hop,
// land 1-5 min after opening so the first tick is never on the minute.
export function nextTickDelay(ms, hours, [gapMin, gapMax], rand = Math.random) {
  if (isOpen(ms, hours)) return Math.round(gapMin + rand() * (gapMax - gapMin));
  const until = Math.round((nextOpen(ms, hours) - ms) / 1000);
  return Math.min(3600, until + 60 + Math.round(rand() * 240));
}
