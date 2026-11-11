import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const cli = (env, script, ...args) => spawnSync(process.execPath, [join('scripts', script), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
const lastJson = (r) => JSON.parse(r.stdout.trim().split('\n').at(-1));

function seeded() {
  const data = mkdtempSync(join(tmpdir(), 'jobba-log-'));
  mkdirSync(join(data, 'log'), { recursive: true });
  const rows = [
    { at: '2026-11-09T14:00:00.000Z', actor: 'agent', action: 'triage.recorded', source: 'record-triage', job_id: '9000000001', detail: 'tier A, score 84' },
    { at: '2026-11-10T15:30:00.000Z', actor: 'user', action: 'triage.decided', source: 'record-triage', job_id: '9000000001', detail: 'pursue' },
    { at: '2026-11-10T16:00:00.000Z', actor: 'agent', action: 'mail.recorded', source: 'mail-scan', job_id: '9000000002', detail: { kind: 'reply' } },
  ];
  writeFileSync(join(data, 'log', 'actions.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { JOBBA_DATA_DIR: data };
}

test('log: a readable table in the profile time zone, oldest first', () => {
  const r = cli(seeded(), 'log.mjs');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^When \(America\/Chicago\)\s+Actor\s+Action\s+Job\s+Detail$/);
  assert.match(lines[2], /^2026-11-09 08:00\s+agent\s+triage\.recorded\s+9000000001\s+tier A, score 84$/);
  assert.match(lines.at(-1), /^2026-11-10 10:00\s+agent\s+mail\.recorded\s+9000000002\s+kind=reply$/);
});

test('log: --since, --job and --limit filter; --json prints one object', () => {
  const env = seeded();
  assert.deepEqual(lastJson(cli(env, 'log.mjs', '--json', '--since', '2026-11-10')).rows.map((r) => r.action), ['triage.decided', 'mail.recorded']);
  assert.deepEqual(lastJson(cli(env, 'log.mjs', '--json', '--job', '9000000001')).rows.map((r) => r.action), ['triage.recorded', 'triage.decided']);
  const one = lastJson(cli(env, 'log.mjs', '--json', '--limit', '1'));
  assert.deepEqual([one.success, one.count, one.rows[0].action], [true, 1, 'mail.recorded']);
  assert.equal(cli(env, 'log.mjs', '--since', 'yesterday').status, 1);
  assert.match(cli({ JOBBA_DATA_DIR: mkdtempSync(join(tmpdir(), 'jobba-log-')) }, 'log.mjs').stdout, /^No actions logged/);
});

test('record-triage logs every state change: record, decide, approve-docs, approve and applied', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-log-ws-'));
  cpSync(join(ROOT, 'tests', 'fixtures', 'workspace', 'profile'), join(home, 'profile'), { recursive: true });
  const data = join(home, 'data');
  mkdirSync(join(data, 'state'), { recursive: true });
  const job = { job_id: '9000000001', url: 'https://www.linkedin.com/jobs/view/9000000001/', title: 'Head of Engineering', company: 'Acme Corp', first_seen: '2026-11-10T14:00:00Z', status: 'viewed', triage: null,
    prefilter: { verdict: 'keep', reasons: [] }, detail: { fetched_at: '2026-11-10T14:05:00Z', description_text: 'x', apply: { type: 'easy' } } };
  writeFileSync(join(data, 'state', 'jobs.json'), JSON.stringify({ _schema: 2, jobs: { 9000000001: job }, sources: {} }));
  const results = join(home, 'results.json');
  writeFileSync(results, JSON.stringify([{ job_id: '9000000001', score: 84, gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, why_fit: [], gaps: [], red_flags: [] }]));
  const env = { JOBBA_HOME: home, JOBBA_DATA_DIR: data };
  const steps = [
    ['record', '--file', results],
    ['decide', '--id', '9000000001', '--decision', 'pursue', '--note', 'strong fit'],
    ['approve-docs', '--id', '9000000001', '--note', 'approve'],
    ['approve', '--id', '9000000001', '--cv', 'workspace/data/out/cv/share/jordan-example-cv-platform-lead.pdf'],
    ['applied', '--id', '9000000001', '--note', 'sent through the company site'],
  ];
  for (const s of steps) { const r = cli(env, 'record-triage.mjs', ...s); assert.equal(r.status, 0, `${s[0]}: ${r.stdout}`); }
  assert.equal(cli(env, 'record-triage.mjs', 'approve-docs', '--id', '9000000001').status, 1); // no note, and already submitted
  const log = readFileSync(join(data, 'log', 'actions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((r) => [r.actor, r.action, r.job_id]), [
    ['agent', 'triage.recorded', '9000000001'], ['user', 'triage.decided', '9000000001'], ['user', 'triage.docs_approved', '9000000001'],
    ['user', 'triage.approved', '9000000001'], ['user', 'apply.submitted_by_hand', '9000000001'],
  ]);
  assert.deepEqual([log[1].detail, log[2].detail, log[3].detail], ['pursue: strong fit', 'approve', 'cv jordan-example-cv-platform-lead.pdf']);
  const st = JSON.parse(readFileSync(join(data, 'state', 'jobs.json'), 'utf8')).jobs['9000000001'];
  assert.ok(st.application.docs_approved_at && st.application.submitted_at);
});

test('record-triage auto: off unless config/apply.json auto_apply.enabled is true', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-auto-ws-'));
  cpSync(join(ROOT, 'tests', 'fixtures', 'workspace', 'profile'), join(home, 'profile'), { recursive: true });
  const data = join(home, 'data');
  mkdirSync(join(data, 'state'), { recursive: true });
  const job = { job_id: '9000000001', title: 'Head of Engineering', company: 'Acme Corp', status: 'triaged', detail: { apply: { type: 'easy' } },
    triage: { score: 90, tier: 'A', gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, archetype: 'platform-lead', decision: null } };
  writeFileSync(join(data, 'state', 'jobs.json'), JSON.stringify({ _schema: 2, jobs: { 9000000001: job }, sources: {} }));
  const r = cli({ JOBBA_HOME: home, JOBBA_DATA_DIR: data }, 'record-triage.mjs', 'auto', '--id', '9000000001', '--dry-run');
  assert.equal(r.status, 2, r.stdout);
  assert.match(lastJson(r).blockers.join(' | '), /auto-apply is off/);
});
