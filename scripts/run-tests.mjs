#!/usr/bin/env node
// npm test: runs every tests/*.test.mjs against a temporary copy of the synthetic workspace in
// tests/fixtures/workspace, with data in a fresh temporary directory, so a test never reads or
// writes a real workspace and never leaves files in the repo.
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CODE_ROOT } from './lib/paths.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'jobba-test-data-'));
const home = mkdtempSync(join(tmpdir(), 'jobba-test-home-'));
cpSync(join(CODE_ROOT, 'tests', 'fixtures', 'workspace'), home, { recursive: true });
const files = readdirSync(join(CODE_ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort()
  .map((f) => join('tests', f));
const only = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test', ...(only.length ? only : files)], {
  cwd: CODE_ROOT,
  stdio: 'inherit',
  env: { ...process.env, JOBBA_HOME: home, JOBBA_DATA_DIR: dataDir, TZ: 'UTC' },
});
rmSync(dataDir, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
process.exit(r.status ?? 1);
