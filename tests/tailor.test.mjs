import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { companyLeak, parseTerms, shouldContinue, suggestTerms } from '../scripts/tailor.mjs';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

test('parseTerms drops comments and blank lines', () => {
  assert.deepEqual(parseTerms('# head\nKubernetes\n\nGo|Golang # alt\n'), ['Kubernetes', 'Go|Golang']);
});

test('suggestTerms finds known vocabulary in the posting and lifts requirement lines', () => {
  const jd = 'We need:\n- 8+ years with Kubernetes\n- Go or Rust\nNice: kafka streams.';
  const { hits, asks } = suggestTerms(jd, ['Kubernetes', 'Kafka', 'Terraform', 'Go|Golang', 'kubernetes']);
  assert.deepEqual(hits, ['Kubernetes', 'Kafka', 'Go|Golang']);
  assert.ok(asks.some((a) => a.includes('Kubernetes')));
});

test('companyLeak looks only at the text the draft writes itself', () => {
  const draft = { summary: { text: 'Led platform teams' }, experience: [{ role: 'vandelay' }] };
  assert.equal(companyLeak(draft, 'Vandelay Industries'), false);
  assert.equal(companyLeak({ headline: 'Ready for Vandelay Industries' }, 'Vandelay Industries, Inc.'), true);
  assert.equal(companyLeak({ headline: 'x' }, ''), false);
});

test('shouldContinue stops at max rounds or when a round did not improve', () => {
  assert.equal(shouldContinue([], 3), true);
  assert.equal(shouldContinue([{ pct: 50 }], 3), true);
  assert.equal(shouldContinue([{ pct: 50 }, { pct: 60 }], 3), true);
  assert.equal(shouldContinue([{ pct: 60 }, { pct: 60 }], 3), false);
  assert.equal(shouldContinue([{ pct: 1 }, { pct: 2 }, { pct: 3 }], 3), false);
});

test('prepare, freeze and measure run against a fetched job and keep the yardstick fixed', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-tailor-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  const dataDir = join(home, 'data');
  mkdirSync(join(dataDir, 'state'), { recursive: true });
  const desc = 'Vandelay Industries is hiring a Head of Platform Engineering.\n- Kubernetes, Terraform and AWS at scale\n- Python and Go\n- Kafka data platform\n- SOC 2\n- mentoring engineering managers';
  writeFileSync(join(dataDir, 'state', 'jobs.json'), JSON.stringify({ _schema: 2, query_runs: {}, sources: {}, jobs: { 9000000042: { job_id: '9000000042', title: 'Head of Platform Engineering', company: 'Vandelay Industries', detail: { fetched_at: '2026-01-05T10:00:00Z', description_text: desc } } } }));
  const env = { ...process.env, JOBBA_HOME: home, JOBBA_DATA_DIR: dataDir };
  const run = (...a) => {
    const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', 'tailor.mjs'), ...a, '--job', '9000000042'], { cwd: CODE_ROOT, env, encoding: 'utf8' });
    return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop()) };
  };
  assert.equal(run('freeze').code, 1, 'freeze before prepare is refused');
  assert.equal(run('prepare').code, 0);
  const app = join(dataDir, 'applications', '9000000042');
  writeFileSync(join(app, 'jd.terms.txt'), 'Kubernetes\nTerraform\nAWS\nPython\nGo|Golang\nKafka\nSOC 2\n');
  const f = run('freeze');
  assert.equal(f.code, 0, JSON.stringify(f.json));
  assert.equal(typeof f.json.baseline.pct, 'number');
  const v = JSON.parse(readFileSync(join(home, 'collateral', 'cv', 'variants', 'platform-director.json'), 'utf8'));
  writeFileSync(join(app, 'cv', 'job-9000000042.json'), JSON.stringify({ ...v, slug: 'job-9000000042', share: 'head-of-platform-engineering' }));
  const m = run('measure');
  assert.equal(m.code, 0, JSON.stringify(m.json));
  assert.equal(m.json.round, 1);
  assert.equal(run('prepare').code, 1, 'prepare after freeze is refused: the yardstick stays fixed');
  writeFileSync(join(app, 'jd.terms.txt'), 'Kubernetes\nTerraform\nAWS\nPython\nRust\n');
  assert.equal(run('measure').code, 1, 'a changed term list is refused');
});

test('prepare takes a JD file for a role the tick never viewed, and refuses one without company and title', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-tailor-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  const dataDir = join(home, 'data');
  const jd = join(home, 'jd-from-mail.txt');
  writeFileSync(jd, 'Staff engineer, data platform. Kafka, Python, AWS required.');
  const env = { ...process.env, JOBBA_HOME: home, JOBBA_DATA_DIR: dataDir };
  const run = (...a) => {
    const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', 'tailor.mjs'), ...a], { cwd: CODE_ROOT, env, encoding: 'utf8' });
    return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop()) };
  };
  assert.equal(run('prepare', '--job', 'mail-1', '--jd', jd).code, 2);
  const ok = run('prepare', '--job', 'mail-1', '--jd', jd, '--company', 'Hooli', '--title', 'Staff Engineer');
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  const rec = JSON.parse(readFileSync(join(dataDir, 'applications', 'mail-1', 'tailor.json'), 'utf8'));
  assert.equal(rec.company, 'Hooli');
  assert.match(rec.posting_source, /^file:/);
  assert.equal(run('prepare', '--job', 'nothing-here').code, 1, 'no posting at all is refused');
});
