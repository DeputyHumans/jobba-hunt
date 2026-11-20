// check:pii --history: every blob ever committed and every commit message, not only today's files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanHistory, termsFrom } from '../scripts/check-pii.mjs';

function repoWith(steps) {
  const dir = mkdtempSync(join(tmpdir(), 'jobba-pii-history-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  for (const s of steps) {
    for (const [f, text] of Object.entries(s.write || {})) writeFileSync(join(dir, f), text);
    for (const f of s.remove || []) unlinkSync(join(dir, f));
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', s.message);
  }
  return dir;
}

test('scanHistory finds a term in a deleted file and in a commit message, masked by caller', () => {
  const dir = repoWith([
    { write: { 'notes.md': 'call Zorblax Corp on Monday\n', 'keep.md': 'nothing personal\n' }, message: 'docs: add notes' },
    { remove: ['notes.md'], message: 'docs: drop notes' },
    { write: { 'keep.md': 'still nothing\n' }, message: 'chore: tidy after the Zorblax Corp call' },
  ]);
  try {
    const terms = termsFrom({ master: { roles: { a: { company: 'Zorblax Corp' } } } });
    const hits = scanHistory(dir, terms);
    const blob = hits.filter((h) => h.kind === 'blob');
    const msg = hits.filter((h) => h.kind === 'message');
    assert.deepEqual(blob.map((h) => h.file), ['notes.md']);
    assert.equal(blob[0].line, 1);
    assert.equal(msg.length, 1);
    assert.match(msg[0].file, /^commit [0-9a-f]{7}$/);
    assert.ok(hits.every((h) => h.term === 'Zorblax Corp'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanHistory skips binary files but scans a committed workspace/ file (a leak in history)', () => {
  const dir = repoWith([
    { write: { 'a.md': 'hello\n', 'logo.png': 'Zorblax Corp inside a binary\n' }, message: 'init' },
  ]);
  try {
    const terms = termsFrom({ master: { roles: { a: { company: 'Zorblax Corp' } } } });
    assert.deepEqual(scanHistory(dir, terms), []);
    assert.deepEqual(scanHistory(dir, termsFrom({ master: { roles: { a: { company: 'Nobody Inc' } } } })), []);
    execFileSync('mkdir', ['-p', join(dir, 'workspace')]);
    writeFileSync(join(dir, 'workspace', 'cv.md'), 'Zorblax Corp\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add workspace'], { cwd: dir });
    assert.deepEqual(scanHistory(dir, terms).map((h) => h.file), ['workspace/cv.md']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
