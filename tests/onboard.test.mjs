import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initWorkspace, nextPhase, validateWorkspace, PHASES } from '../scripts/onboard.mjs';
import { CODE_ROOT, TEMPLATES_DIR } from '../scripts/lib/paths.mjs';

test('init copies every template file, dotfiles included, and never overwrites', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-ws-'));
  const first = initWorkspace({ templates: TEMPLATES_DIR, home });
  assert.ok(first.created.includes(join('profile', 'person.json')));
  assert.ok(first.created.includes('.gitignore'));
  assert.ok(existsSync(join(home, 'data', 'log')));
  writeFileSync(join(home, 'profile', 'person.json'), '{"name":"Kept"}');
  const second = initWorkspace({ templates: TEMPLATES_DIR, home });
  assert.equal(second.created.length, 0);
  assert.equal(JSON.parse(readFileSync(join(home, 'profile', 'person.json'), 'utf8')).name, 'Kept');
});

test('a fresh template workspace fails validation on the empty identity, and only on content', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-ws-'));
  initWorkspace({ templates: TEMPLATES_DIR, home });
  const problems = validateWorkspace(home);
  assert.ok(problems.some((p) => p.file === 'profile/person.json'));
  assert.ok(!problems.some((p) => /invalid JSON|bad regex|must be/.test(p.msg)), JSON.stringify(problems));
});

test('the synthetic test workspace validates clean once completed from templates', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-ws-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  initWorkspace({ templates: TEMPLATES_DIR, home });
  assert.deepEqual(validateWorkspace(home), []);
});

test('validation catches a claim cited by the CV but missing from the bank', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-ws-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  initWorkspace({ templates: TEMPLATES_DIR, home });
  const p = join(home, 'collateral', 'cv', 'master.json');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  const first = Object.keys(m.bullets)[0];
  m.bullets[first].claims = ['C999'];
  writeFileSync(p, JSON.stringify(m));
  assert.ok(validateWorkspace(home).some((x) => /unknown claim C999/.test(x.msg)));
});

test('validation names a cited claim the bank holds as pending', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-ws-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  initWorkspace({ templates: TEMPLATES_DIR, home });
  const bank = join(home, 'collateral', 'claim-bank.md');
  writeFileSync(bank, readFileSync(bank, 'utf8').replace(/^\| C01 \|(.*)\| CV \|$/m, '| C01 |$1| pending |'));
  const p = join(home, 'collateral', 'cv', 'master.json');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  m.bullets[Object.keys(m.bullets)[0]].claims = ['C01'];
  writeFileSync(p, JSON.stringify(m));
  assert.ok(validateWorkspace(home).some((x) => /claim C01 is not usable \(status pending/.test(x.msg)));
});

test('nextPhase walks the phases in order', () => {
  assert.equal(nextPhase({}), PHASES[0]);
  assert.equal(nextPhase(Object.fromEntries(PHASES.map((p) => [p, 'x']))), null);
  assert.equal(nextPhase({ preflight: 'x', init: 'x' }), 'ingest');
});

test('validation: tailoring.letter is per-job or one of the approaches A to D', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-ws-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  initWorkspace({ templates: TEMPLATES_DIR, home });
  const p = join(home, 'profile', 'preferences.json');
  const prefs = JSON.parse(readFileSync(p, 'utf8'));
  for (const [v, ok] of [['per-job', true], ['B', true], ['E', false], ['requirements map', false]]) {
    writeFileSync(p, JSON.stringify({ ...prefs, tailoring: { ...(prefs.tailoring || {}), letter: v } }));
    assert.equal(validateWorkspace(home).some((x) => /tailoring.letter must be per-job, A, B, C or D/.test(x.msg)), !ok, v);
  }
});

