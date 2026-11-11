import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { scanText } from '../scripts/check-portable.mjs';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

const rules = (file, text) => scanText(file, text).map((h) => h.rule);

test('flags host home paths on macOS, Linux and Windows', () => {
  assert.deepEqual(rules('docs/a.md', 'see /Users/someone/work/x'), ['home-path']);
  assert.deepEqual(rules('docs/a.md', 'see /home/someone/x'), ['home-path']);
  assert.deepEqual(rules('docs/a.md', 'see C:\\Users\\someone\\x'), ['home-path']);
});

test('flags ~/ paths except generic tool folders in vendored skill install notes', () => {
  assert.deepEqual(rules('docs/a.md', 'clone into ~/work/repo'), ['tilde-path']);
  assert.deepEqual(rules('.agents/skills/x/INSTALL.md', 'or cp -r x ~/.claude/skills/'), []);
  assert.deepEqual(rules('.agents/skills/x/INSTALL.md', 'or cp -r x ~/work/'), ['tilde-path']);
});

test('flags homedir() outside the path layer', () => {
  assert.deepEqual(rules('scripts/x.mjs', "const p = join(homedir(), 'x');"), ['homedir']);
  assert.deepEqual(rules('scripts/lib/env.mjs', "const p = homedir();"), []);
});

test('flags ../ that leaves the repo, accepts ../ that stays inside', () => {
  assert.deepEqual(rules('scripts/lib/x.mjs', "import a from '../../../outside.mjs';"), ['dotdot-escape']);
  assert.deepEqual(rules('scripts/lib/x.mjs', "import a from '../tick.mjs';"), []);
  assert.deepEqual(rules('docs/a.md', '[link](../README.md)'), []);
  assert.deepEqual(rules('docs/a.md', '[link](../../elsewhere.md)'), ['dotdot-escape']);
});

test("flags bare '..' segments in scripts (join(ROOT, '..')), ignores comments", () => {
  assert.deepEqual(rules('scripts/x.mjs', "const R = join(ROOT, '..', 'docs');"), ['bare-dotdot']);
  assert.deepEqual(rules('scripts/x.mjs', "const R = join(dirname(fileURLToPath(import.meta.url)), '..');"), ['bare-dotdot']);
  assert.deepEqual(rules('scripts/x.mjs', "if (relative(a, b).startsWith('..')) return;"), []);
  assert.deepEqual(rules('scripts/x.mjs', "// join(here, '..') used to be here"), []);
});

test('the repository itself is portable', () => {
  const r = JSON.parse(execFileSync(process.execPath, [join(CODE_ROOT, 'scripts', 'check-portable.mjs'), '--json'], { cwd: CODE_ROOT, encoding: 'utf8' }).trim().split('\n').pop());
  assert.deepEqual(r.hits, []);
});
