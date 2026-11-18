import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'jobba-limits-'));
process.env.JOBBA_LIMITS_LOG = join(dir, 'limits-log.json');
const { canPost, recordPost, getUsageSummary, loadLimits, capOverride, allowance } = await import('../scripts/rate-limiter.mjs');

const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/workspace/config/limits.json', import.meta.url), 'utf8'));
const tplMax = (platform, action) => TEMPLATE[platform][action].max;

test('one sweep per day: the second same-day sweep is refused', () => {
  assert.equal(canPost('linkedin_jobs', 'sweeps_per_day').allowed, true);
  recordPost('linkedin_jobs', 'sweeps_per_day', { sweepId: 't' });
  const second = canPost('linkedin_jobs', 'sweeps_per_day');
  assert.equal(second.allowed, false);
  assert.match(second.reason, /Limit reached: 1\/1/);
  assert.ok(second.nextAllowedAt);
});

test('the caps come from config/limits.json (the shipped template when the workspace has none)', () => {
  const s = getUsageSummary();
  for (const [platform, actions] of Object.entries(loadLimits())) {
    for (const action of Object.keys(actions)) assert.equal(s[platform][action].max, tplMax(platform, action), `${platform}.${action}`);
  }
  assert.equal(s.linkedin_jobs.sweeps_per_day.max, 1);
});

test('a second tick inside the jitter gap is refused', () => {
  assert.equal(canPost('linkedin_jobs', 'ticks_per_day').allowed, true);
  recordPost('linkedin_jobs', 'ticks_per_day', { tickId: 't1' });
  const second = canPost('linkedin_jobs', 'ticks_per_day');
  assert.equal(second.allowed, false);
  assert.match(second.reason, /Jitter gap/);
});

test('only job reading (LinkedIn, Dice) and approved applications are configured; comment keys are skipped', () => {
  assert.deepEqual(Object.keys(getUsageSummary()).sort(), ['ats_apply', 'dice_apply', 'dice_jobs', 'linkedin_apply', 'linkedin_jobs']);
});

test('an unknown platform or action is refused, never allowed', () => {
  assert.equal(canPost('linkedin_jobs', 'posts_per_day').allowed, false);
  assert.equal(canPost('other_site', 'searches_per_day').allowed, false);
});

// The daily reset is reset_hour:00 in the configured zone, not the host's zone.
test('daily caps reset at schedule.reset_hour in schedule.tz', () => {
  const limits = { demo: { loads_per_day: { max: 1, windowHours: 24 } } };
  const sched = { tz: 'America/Chicago', reset_hour: 4 };
  process.env.JOBBA_LIMITS_LOG = join(dir, 'reset-log.json');
  // 2026-11-10 09:30 UTC is 03:30 in Chicago (CST): before that day's reset.
  recordPost('demo', 'loads_per_day', {}, { now: Date.parse('2026-11-10T09:30:00Z') });
  const before = canPost('demo', 'loads_per_day', { limits, schedule: sched, now: Date.parse('2026-11-10T09:45:00Z') });
  assert.equal(before.allowed, false);
  assert.equal(before.nextAllowedAt, '2026-11-10T10:00:00.000Z', '04:00 CST');
  assert.match(before.reason, /resets 04:00 America\/Chicago/);
  assert.equal(canPost('demo', 'loads_per_day', { limits, schedule: sched, now: Date.parse('2026-11-10T10:00:00Z') }).allowed, true);
  // The same log under another zone: 09:30 UTC is 10:30 in Paris (CET), after its 04:00 reset.
  const paris = { tz: 'Europe/Paris', reset_hour: 4 };
  assert.equal(canPost('demo', 'loads_per_day', { limits, schedule: paris, now: Date.parse('2026-11-10T12:00:00Z') }).allowed, false);
  assert.equal(canPost('demo', 'loads_per_day', { limits, schedule: paris, now: Date.parse('2026-11-11T03:00:00Z') }).allowed, true);
  const u = getUsageSummary({ limits, schedule: sched, now: Date.parse('2026-11-10T09:45:00Z') }).demo.loads_per_day;
  assert.deepEqual([u.count, u.available, u.resetsAtHour, u.tz], [1, 0, 4, 'America/Chicago']);
  process.env.JOBBA_LIMITS_LOG = join(dir, 'limits-log.json');
});

test('a rolling limit counts a trailing window instead of the daily reset', () => {
  const limits = { demo: { burst: { max: 1, windowHours: 2, rolling: true } } };
  process.env.JOBBA_LIMITS_LOG = join(dir, 'rolling-log.json');
  recordPost('demo', 'burst', {}, { now: Date.parse('2026-11-10T09:00:00Z') });
  assert.equal(canPost('demo', 'burst', { limits, now: Date.parse('2026-11-10T10:59:00Z') }).allowed, false);
  assert.equal(canPost('demo', 'burst', { limits, now: Date.parse('2026-11-10T11:01:00Z') }).allowed, true);
  process.env.JOBBA_LIMITS_LOG = join(dir, 'limits-log.json');
});

test('cap overrides: only today\'s dated entry matches, and a load past the cap is written to the action log', async () => {
  const path = join(dir, 'cap-overrides.json');
  writeFileSync(path, JSON.stringify([
    { date: '2026-11-10', platform: 'linkedin_apply', action: 'applications_per_day', max: 30, by: 'user, in session' },
    { date: '2026-11-09', platform: 'dice_apply', action: 'applications_per_day', max: 60, by: 'user' },
  ]));
  const sched = { tz: 'America/Chicago', reset_hour: 4 };
  const now = Date.parse('2026-11-10T18:00:00Z');
  assert.equal(capOverride('linkedin_apply', 'applications_per_day', { now, path, schedule: sched }).max, 30);
  assert.equal(capOverride('dice_apply', 'applications_per_day', { now, path, schedule: sched }), null);
  // 2026-11-11 02:00 UTC is still 2026-11-10 in Chicago.
  assert.ok(capOverride('linkedin_apply', 'applications_per_day', { now: Date.parse('2026-11-11T02:00:00Z'), path, schedule: sched }));

  const { readActions } = await import('../scripts/lib/actions-log.mjs');
  const n = readActions().filter((r) => r.action === 'cap.override').length;
  const e = recordPost('linkedin_apply', 'applications_per_day', { jobId: '9000000001', cap_override: true, override_reason: 'user, in session' });
  assert.equal(e.cap_override, true);
  const rows = readActions().filter((r) => r.action === 'cap.override');
  assert.equal(rows.length, n + 1);
  assert.deepEqual([rows.at(-1).source, rows.at(-1).job_id, rows.at(-1).detail.action], ['linkedin_apply', '9000000001', 'applications_per_day']);
});

test('allowance: past the standing cap only today\'s dated override lets one more through, tagged cap_override (every apply cap, ats_apply included)', () => {
  const path = join(dir, 'cap-overrides-ats.json');
  const sched = { tz: 'UTC', reset_hour: 4 };
  const now = Date.parse('2030-03-05T12:00:00Z');
  const opts = { now, path, schedule: sched };
  const max = tplMax('ats_apply', 'applications_per_day');
  for (let i = 0; i < max; i++) recordPost('ats_apply', 'applications_per_day', { jobId: `a${i}` }, { now: now - 60000 });
  writeFileSync(path, '[]');
  assert.deepEqual(allowance('ats_apply', 'applications_per_day', opts), { ok: false, meta: {} });
  writeFileSync(path, JSON.stringify([{ date: '2030-03-05', platform: 'ats_apply', action: 'applications_per_day', max: max + 1, by: 'user, in session' }]));
  assert.deepEqual(allowance('ats_apply', 'applications_per_day', opts), { ok: true, meta: { cap_override: true, override_reason: 'user, in session' } });
  recordPost('ats_apply', 'applications_per_day', { jobId: 'over', cap_override: true }, { now: now - 30000 });
  assert.equal(allowance('ats_apply', 'applications_per_day', opts).ok, false, 'the override max is a ceiling too');
});

test('apply-job takes every applications cap through allowance, ats_apply included', () => {
  const src = readFileSync(new URL('../scripts/apply-job.mjs', import.meta.url), 'utf8');
  assert.match(src, /allowance\('ats_apply', 'applications_per_day'\)/);
  assert.doesNotMatch(src, /canPost\('ats_apply'/);
});
