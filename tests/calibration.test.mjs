import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkCalibration } from '../scripts/lib/triage.mjs';

const FIXTURE = new URL('./fixtures/calibration.json', import.meta.url);
const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const pass = { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' };
const res = (label, score, gates = pass) => ({ job_id: fx.roles.find((r) => r.label === label).job_id, score, gates, why_fit: [], gaps: [], red_flags: [] });
const good = [
  res('acme-head-of-engineering', 84), res('globex-insurance-cto', 58), res('initech-mvp-cto', 82),
  res('hooli-vp-full-time', 55),
  res('umbrella-boston-onsite', 70, { ...pass, G2: 'fail' }),
  res('soylent-erx', 60, { ...pass, G4: 'fail' }),
  res('globex-springfield-hybrid', 78),
  res('dice-lead-full-stack-ai', 84), res('dice-senior-python-ai', 76),
  res('dice-lead-full-stack-w2', 80),
  res('dice-desktop-support', 30, { ...pass, G3: 'fail' }),
  res('li-ai-engineer-contract', 82),
  res('li-ai-training-gig', 45, { ...pass, G3: 'fail' }),
  res('li-staff-engineer-full-time', 50),
];

test('fixture roles have unique labels and ids, synthetic ids only, and every expectation type', () => {
  assert.equal(new Set(fx.roles.map((r) => r.label)).size, fx.roles.length);
  assert.equal(new Set(fx.roles.map((r) => r.job_id)).size, fx.roles.length);
  for (const r of fx.roles) assert.match(r.job_id, /^(9000000[01]\d\d|dice-11111111-1111-4111-8111-1111111111\d\d)$/, r.job_id);
  assert.deepEqual([...new Set(fx.expectations.map((e) => e.type))].sort(), ['gate_is', 'order', 'reject_on', 'tier_at_least']);
});

test('a result set meeting every expectation passes', () => {
  assert.deepEqual(checkCalibration(good, fx), { pass: true, failures: [] });
});

test('ordering, tier floor and gate expectations each report a named failure', () => {
  const bad = good.map((r) => ({ ...r }));
  bad[0].score = 50; // Acme below Globex and below tier B
  bad[5].gates = pass; // e-Rx no longer rejected on G4
  const r = checkCalibration(bad, fx);
  assert.equal(r.pass, false);
  assert.deepEqual(r.failures.map((f) => f.type).sort(), ['order', 'reject_on', 'tier_at_least']);
});

test('tier floors use the tier cuts: raising tier B above a score fails tier_at_least', () => {
  const r = checkCalibration(good, fx, { tierCuts: { a: 95, b: 85 } });
  assert.ok(r.failures.every((f) => f.type === 'tier_at_least'));
  assert.ok(r.failures.length >= 1);
});

test('missing results are failures, not silent passes', () => {
  const r = checkCalibration(good.slice(1), fx);
  assert.equal(r.pass, false);
  assert.ok(r.failures.some((f) => f.type === 'missing'));
});

test('check-calibration CLI: --fixture picks the set; without one it reads data/calibration.json and says how to build it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobba-cal-'));
  const results = join(dir, 'results.json');
  writeFileSync(results, JSON.stringify(good));
  const cli = (args, data = join(dir, 'data')) => spawnSync(process.execPath, ['scripts/check-calibration.mjs', ...args], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', env: { ...process.env, JOBBA_DATA_DIR: data } });
  const ok = cli(['--file', results, '--fixture', FIXTURE.pathname]);
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(JSON.parse(ok.stdout.trim().split('\n').at(-1)).pass, true);
  const none = cli(['--file', results]);
  assert.equal(none.status, 1);
  assert.match(JSON.parse(none.stdout.trim().split('\n').at(-1)).error, /no calibration set .*\/hunt-onboard/);
});
