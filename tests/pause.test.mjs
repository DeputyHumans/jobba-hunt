// The hunt-wide pause switch (config/pause.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPause, pauseBlock } from '../scripts/lib/pause.mjs';

test('readPause: no file means not paused; a file reads its flag and reason', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pause-')), 'pause.json');
  assert.equal(readPause(file), null);
  writeFileSync(file, JSON.stringify({ paused: true, reason: 'CV refresh', since: '2026-01-05' }));
  assert.deepEqual(readPause(file), { paused: true, reason: 'CV refresh', since: '2026-01-05' });
});

test('readPause: the fixture workspace has no pause file, so nothing is paused', () => {
  assert.equal(pauseBlock(readPause()), null);
});

test('pauseBlock: a reason only while paused', () => {
  assert.equal(pauseBlock(null), null);
  assert.equal(pauseBlock({ paused: false, reason: 'x' }), null);
  assert.equal(pauseBlock({ paused: true, reason: 'CV refresh' }), 'paused: CV refresh');
  assert.equal(pauseBlock({ paused: true }), 'paused: no reason given');
});
