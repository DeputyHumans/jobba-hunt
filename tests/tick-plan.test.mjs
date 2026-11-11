import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpen, nextOpen, haltUntil, isHalted, queryWindow, pickTick, nextTickDelay, lastResetAt, nextResetAt } from '../scripts/lib/tick-plan.mjs';
import { emptyState } from '../scripts/lib/state.mjs';

const HOURS = { tz: 'America/Chicago', days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' };
const WINDOW = { first_run_seconds: 604800, buffer_hours: 6, cap_seconds: 604800 };
const ms = (iso) => Date.parse(iso);
const cfg = {
  window: WINDOW,
  canary: { id: 'ai-fractional-cto', keywords: '"fractional CTO"', scope: 'semantic', tpr_seconds: 604800 },
  queries: [
    { id: 'fractional-leaders', keywords: 'a', scope: 'fractional' },
    { id: 'interim-part-time', keywords: 'b', scope: 'fractional' },
    { id: 'contract-leadership', keywords: 'c', scope: 'generic' },
    { id: 'ai-transformation-senior', keywords: 'd', scope: 'generic' },
  ],
  tick: { ...HOURS, canary_every: 2, min_interval_hours: { 'ai-transformation-senior': 24 } },
};

// 2026-10-27 is a Tuesday (CDT, UTC-5). DST ends Sunday 2026-11-01; Monday 2026-11-02 is CST (UTC-6).
test('business hours: Tue 07:59 closed, 08:00 open, 17:59 open, 18:00 closed (CDT)', () => {
  assert.equal(isOpen(ms('2026-10-27T12:59:00Z'), HOURS), false);
  assert.equal(isOpen(ms('2026-10-27T13:00:00Z'), HOURS), true);
  assert.equal(isOpen(ms('2026-10-27T22:59:00Z'), HOURS), true);
  assert.equal(isOpen(ms('2026-10-27T23:00:00Z'), HOURS), false);
});

test('weekend is closed; the next open slot is Monday 08:00 across the DST change', () => {
  assert.equal(isOpen(ms('2026-10-31T17:00:00Z'), HOURS), false); // Sat 12:00 CDT
  assert.equal(new Date(nextOpen(ms('2026-10-31T17:00:00Z'), HOURS)).toISOString(), '2026-11-02T14:00:00.000Z');
  assert.equal(new Date(nextOpen(ms('2026-10-30T23:30:00Z'), HOURS)).toISOString(), '2026-11-02T14:00:00.000Z'); // Fri 18:30 CDT
});

test('nextOpen inside business hours is now', () => {
  const t = ms('2026-10-27T18:12:34Z');
  assert.equal(nextOpen(t, HOURS), t);
});

test('a checkpoint halts for 7 days; any other abort halts until the next reset hour in the zone (default 04:00)', () => {
  const t = ms('2026-10-27T18:00:00Z'); // Tue 13:00 CDT
  assert.equal(haltUntil('checkpoint', t, HOURS.tz), '2026-11-03T18:00:00.000Z');
  assert.equal(haltUntil('checkpoint', t, HOURS.tz, 6), '2026-11-03T18:00:00.000Z', 'the checkpoint halt ignores the reset hour');
  assert.equal(haltUntil('throttle-suspect', t, HOURS.tz), '2026-10-28T09:00:00.000Z'); // Wed 04:00 CDT
  assert.equal(haltUntil('throttle-suspect', t, HOURS.tz, 6), '2026-10-28T11:00:00.000Z'); // Wed 06:00 CDT
  assert.equal(haltUntil('blocked', t, 'Europe/Paris', 4), '2026-10-28T03:00:00.000Z'); // Wed 04:00 CET
  assert.equal(haltUntil('blocked', ms('2026-10-31T18:00:00Z'), HOURS.tz, 4), '2026-11-01T10:00:00.000Z'); // Sun 04:00 CST, after the DST change
  assert.equal(haltUntil(null, t, HOURS.tz), null);
});

test('reset boundaries: last and next reset_hour:00 in the zone, across both DST changes', () => {
  const iso = (n) => new Date(n).toISOString();
  assert.equal(iso(lastResetAt(ms('2026-11-10T09:59:00Z'), HOURS.tz, 4)), '2026-11-09T10:00:00.000Z'); // 03:59 CST
  assert.equal(iso(lastResetAt(ms('2026-11-10T10:00:00Z'), HOURS.tz, 4)), '2026-11-10T10:00:00.000Z'); // 04:00 CST exactly
  assert.equal(iso(nextResetAt(ms('2026-11-10T10:00:00Z'), HOURS.tz, 4)), '2026-11-11T10:00:00.000Z'); // strictly after
  assert.equal(iso(nextResetAt(ms('2026-03-07T18:00:00Z'), HOURS.tz, 4)), '2026-03-08T09:00:00.000Z'); // 04:00 CDT, DST starts that night
  assert.equal(iso(lastResetAt(ms('2026-11-01T09:30:00Z'), HOURS.tz, 4)), '2026-10-31T09:00:00.000Z'); // 03:30 CST on the fall-back day
});

test('isHalted honors halt_until', () => {
  const s = { ...emptyState(), halt_until: '2026-10-28T11:00:00.000Z' };
  assert.equal(isHalted(s, ms('2026-10-28T10:59:00Z')), true);
  assert.equal(isHalted(s, ms('2026-10-28T11:00:00Z')), false);
  assert.equal(isHalted(emptyState(), ms('2026-10-28T11:00:00Z')), false);
});

test('per-query window: own last run plus buffer, else the last sweep, else the first-run backfill', () => {
  const now = ms('2026-10-27T20:00:00Z');
  const s = { ...emptyState(), last_successful_sweep: '2026-10-27T14:00:00Z', query_runs: { q1: { last_ok: '2026-10-27T18:00:00Z' } } };
  assert.equal(queryWindow(s, 'q1', now, WINDOW), 2 * 3600 + 6 * 3600);
  assert.equal(queryWindow(s, 'q2', now, WINDOW), 6 * 3600 + 6 * 3600);
  assert.equal(queryWindow(emptyState(), 'q1', now, WINDOW), 604800);
});

test('first tick is the canary, with its fixed 7-day window', () => {
  const p = pickTick(cfg, emptyState(), ms('2026-10-27T16:00:00Z'));
  assert.equal(p.kind, 'canary');
  assert.equal(p.id, 'ai-fractional-cto');
  assert.equal(p.tprSeconds, 604800);
});

test('after a canary tick, the never-run classic query comes next, in config order', () => {
  const s = { ...emptyState(), ticks_since_canary: 0 };
  const p = pickTick(cfg, s, ms('2026-10-27T16:00:00Z'));
  assert.equal(p.kind, 'query');
  assert.equal(p.id, 'fractional-leaders');
});

test('canary every 2nd tick: one classic tick since the canary makes the canary due', () => {
  const s = { ...emptyState(), ticks_since_canary: 1 };
  assert.equal(pickTick(cfg, s, ms('2026-10-27T16:00:00Z')).kind, 'canary');
});

test('classic queries rotate oldest-first', () => {
  const s = {
    ...emptyState(),
    ticks_since_canary: 0,
    query_runs: {
      'fractional-leaders': { last_ok: '2026-10-27T15:00:00Z' },
      'interim-part-time': { last_ok: '2026-10-27T14:00:00Z' },
      'contract-leadership': { last_ok: '2026-10-27T15:30:00Z' },
      'ai-transformation-senior': { last_ok: '2026-10-27T13:00:00Z' },
    },
  };
  // ai-transformation-senior is oldest but inside its 24 h minimum interval.
  assert.equal(pickTick(cfg, s, ms('2026-10-27T16:00:00Z')).id, 'interim-part-time');
});

test('a query past its minimum interval is eligible again', () => {
  const s = {
    ...emptyState(),
    ticks_since_canary: 0,
    query_runs: {
      'fractional-leaders': { last_ok: '2026-10-27T15:00:00Z' },
      'interim-part-time': { last_ok: '2026-10-27T15:00:00Z' },
      'contract-leadership': { last_ok: '2026-10-27T15:00:00Z' },
      'ai-transformation-senior': { last_ok: '2026-10-26T14:00:00Z' },
    },
  };
  assert.equal(pickTick(cfg, s, ms('2026-10-27T16:00:00Z')).id, 'ai-transformation-senior');
});

test('the classic query window comes from its own last run', () => {
  const s = { ...emptyState(), ticks_since_canary: 0, last_successful_sweep: '2026-10-27T14:00:00Z' };
  const p = pickTick(cfg, s, ms('2026-10-27T16:00:00Z'));
  assert.equal(p.tprSeconds, 2 * 3600 + 6 * 3600);
});

test('next tick delay: jittered gap inside hours, a hop of at most 3600 s toward the next window outside', () => {
  const gap = [1500, 2100];
  const inHours = nextTickDelay(ms('2026-10-27T16:00:00Z'), HOURS, gap, () => 0.5);
  assert.equal(inHours, 1800);
  assert.equal(nextTickDelay(ms('2026-10-31T19:00:00Z'), HOURS, gap, () => 0.5), 3600);
  // Mon 07:40 CST: next open in 20 min; wake then plus jitter inside [60, gap min].
  const nearOpen = nextTickDelay(ms('2026-11-02T13:40:00Z'), HOURS, gap, () => 0);
  assert.equal(nearOpen, 1200 + 60);
});
