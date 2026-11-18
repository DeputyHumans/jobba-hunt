// The four example letters (tests/fixtures/letters, the examples in docs/tailoring.md) build through
// scripts/build-cover.mjs (npm run cover) against the synthetic workspace: every check, one page, fonts, the never-claim lint.
// Skipped when the project's Chromium is not downloaded (npm run setup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';
import { chromiumPath } from '../scripts/lib/pdf.mjs';

const skip = await chromiumPath().then(() => false, (err) => err.message);
const FILES = ['a-requirements-map', 'b-first-two-weeks', 'c-three-questions', 'd-lean-ps'];

test('the four example letters build clean, one page each', { skip }, () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-letters-'));
  cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
  const data = join(home, 'data');
  const prefsPath = join(home, 'profile', 'preferences.json');
  const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
  writeFileSync(prefsPath, JSON.stringify({ ...prefs, tailoring: { ...(prefs.tailoring || {}), letter: 'per-job' } }));
  for (const f of FILES) {
    const letter = JSON.parse(readFileSync(join(CODE_ROOT, 'tests', 'fixtures', 'letters', `${f}.json`), 'utf8'));
    const dir = join(data, 'applications', letter.job_id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cover-letter.json'), JSON.stringify(letter));
    const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', 'build-cover.mjs'), '--job', letter.job_id], {
      cwd: CODE_ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, JOBBA_HOME: home, JOBBA_DATA_DIR: data },
    });
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(r.status, 0, `${f}: ${JSON.stringify(out)}`);
    assert.equal(out.pages, 1, f);
  }
});
