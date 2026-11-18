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
