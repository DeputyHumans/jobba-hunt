// Entrypoint gates, end to end: each command runs against a throwaway copy of the synthetic
// workspace and must refuse before any browser starts. Nothing here launches a browser: every
// case stops at a gate (a halt, the pause, a cap) or writes state only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

const FUTURE = '2099-01-01T00:00:00.000Z';

function workspace() {
  const home = mkdtempSync(join(tmpdir(), 'jobba-gates-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  const data = join(home, 'data');
  mkdirSync(join(data, 'state'), { recursive: true });
  return { home, data };
}

const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2)); };
const jobsState = (extra = {}) => ({ _schema: 2, query_runs: {}, sources: {}, jobs: {}, ...extra });
const pause = (ws) => writeJson(join(ws.home, 'config', 'pause.json'), { paused: true, reason: 'CV refresh', since: '2026-11-18', by: 'operator' });
// A verified copy of a template query set: the live paths refuse an unverified one first.
function verified(ws, name) {
  const t = JSON.parse(readFileSync(join(CODE_ROOT, 'templates', 'workspace', 'config', name), 'utf8'));
  writeJson(join(ws.home, 'config', name), { ...t, verified: true, verified_at: '2026-11-01T00:00:00Z', verified_by: 'test' });
}

function cli(ws, script, ...args) {
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', script), ...args], {
    cwd: CODE_ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, JOBBA_HOME: ws.home, JOBBA_DATA_DIR: ws.data, JOBBA_LIMITS_LOG: join(ws.data, 'state', 'limits-log.json'), JOBBA_NO_BROWSER: '1' },
  });
  const last = r.stdout.trim().split('\n').pop() || '{}';
  return { code: r.status, json: JSON.parse(last), stderr: r.stderr };
}

// ---------- D6: triage record ----------

test('triage record: a results file with a bad row exits 1, and the good rows are still recorded', () => {
  const ws = workspace();
  const job = (id) => ({ job_id: id, title: 'Head of Platform', company: 'Acme Corp', status: 'viewed', detail: { fetched_at: '2026-11-01T10:00:00Z', description_text: 'A real posting.' } });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ jobs: { 9000000001: job('9000000001'), 9000000002: job('9000000002') } }));
  const row = (id, score) => ({ job_id: id, lane: 'leadership', archetype: 'platform', score, gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, dimensions: {}, why_fit: ['x'], gaps: [], red_flags: [] });
  const file = join(ws.data, 'results.json');
  writeJson(file, [row('9000000001', 80), row('9000000002', 300)]);
  const r = cli(ws, 'record-triage.mjs', 'record', '--file', file);
  assert.equal(r.code, 1, 'any reported error exits 1');
  assert.equal(r.json.success, false);
  assert.ok(r.json.errors.length >= 1);
  assert.deepEqual(r.json.applied, ['9000000001']);
});

// ---------- D11: pause and halt outside the ticks ----------

test('sweep: refuses while paused (exit 4) and while halted (exit 2), before any browser', () => {
  const ws = workspace();
  verified(ws, 'searches.json');
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  pause(ws);
  const p = cli(ws, 'sweep-jobs.mjs');
  assert.equal(p.code, 4);
  assert.equal(p.json.paused, true);
  assert.match(p.json.reason, /paused: CV refresh/);
  writeJson(join(ws.home, 'config', 'pause.json'), { paused: false });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ halt_until: FUTURE }));
  const h = cli(ws, 'sweep-jobs.mjs');
  assert.equal(h.code, 2);
  assert.equal(h.json.halted, true);
});

test('probe: a live probe refuses while paused (exit 4) or halted (exit 5); the dry run still plans', () => {
  const ws = workspace();
  const probe = join(ws.home, 'config', 'probes', 'gate-probe.json');
  writeJson(probe, { name: 'gate-probe', tpr_seconds: 604800, defaults: { geo: 'us', workplace: 'remote' }, views: [], searches: [{ id: 'P1', keywords: 'head of platform' }] });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  pause(ws);
  assert.equal(cli(ws, 'probe-searches.mjs', '--file', probe, '--dry-run').code, 0, 'a dry run launches no browser and stays allowed');
  const p = cli(ws, 'probe-searches.mjs', '--file', probe);
  assert.equal(p.code, 4);
  assert.equal(p.json.paused, true);
  writeJson(join(ws.home, 'config', 'pause.json'), { paused: false });
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ halt_until: FUTURE }));
  const h = cli(ws, 'probe-searches.mjs', '--file', probe);
  assert.equal(h.code, 5);
  assert.equal(h.json.halted, true);
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ sources: { dice: { halt_until: FUTURE } } }));
  const d = cli(ws, 'probe-searches.mjs', '--file', probe, '--source', 'dice');
  assert.equal(d.code, 5, 'a Dice probe waits on the Dice halt');
});

test('reader CLIs: search and view refuse while paused or halted; limits still answers', () => {
  const ws = workspace();
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ halt_until: FUTURE }));
  const li = cli(ws, 'linkedin-jobs.mjs', 'view', '--id', '9000000001');
  assert.equal(li.code, 1);
  assert.equal(li.json.halted, true);
  assert.equal(cli(ws, 'linkedin-jobs.mjs', 'limits').code, 0);
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState({ sources: { dice: { halt_until: FUTURE } } }));
  const dv = cli(ws, 'dice-jobs.mjs', 'search', '--query', 'platform');
  assert.equal(dv.code, 1);
  assert.equal(dv.json.halted, true);
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  pause(ws);
  const ls = cli(ws, 'linkedin-jobs.mjs', 'search', '--query', 'platform');
  assert.equal(ls.code, 1);
  assert.equal(ls.json.paused, true);
  const dl = cli(ws, 'dice-jobs.mjs', 'view', '--id', 'dice-00000000-0000-0000-0000-000000000001');
  assert.equal(dl.code, 1);
  assert.equal(dl.json.paused, true);
});

// ---------- D12: the Dice sweep cap ----------

test('dice-tick --sweep: refused once dice_jobs sweeps_per_day is used up', () => {
  const ws = workspace();
  verified(ws, 'dice-searches.json');
  writeJson(join(ws.data, 'state', 'jobs.json'), jobsState());
  writeJson(join(ws.data, 'state', 'limits-log.json'), [{ timestamp: new Date().toISOString(), platform: 'dice_jobs', actionType: 'sweeps_per_day', sweepId: 'earlier' }]);
  const r = cli(ws, 'dice-tick.mjs', '--sweep');
  assert.equal(r.code, 2);
  assert.equal(r.json.refused, true);
  assert.equal(r.json.cap, 'sweeps_per_day');
});

test('dice-tick records a sweep against sweeps_per_day', () => {
  const src = readFileSync(join(CODE_ROOT, 'scripts', 'dice-tick.mjs'), 'utf8');
  assert.match(src, /recordPost\('dice_jobs', 'sweeps_per_day'/);
});
