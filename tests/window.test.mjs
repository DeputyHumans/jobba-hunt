import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tprSeconds } from '../scripts/lib/window.mjs';

const W = { first_run_seconds: 604800, buffer_hours: 6, cap_seconds: 604800 };
const now = Date.parse('2026-10-27T09:00:00Z');

test('first run backfills the full first-run window', () => {
  assert.equal(tprSeconds(null, now, W), 604800);
});

test('window is time since last successful sweep plus the buffer', () => {
  const last = new Date(now - 20 * 3600e3).toISOString();
  assert.equal(tprSeconds(last, now, W), 20 * 3600 + 6 * 3600);
});

test('window is capped at seven days', () => {
  const last = new Date(now - 30 * 864e5).toISOString();
  assert.equal(tprSeconds(last, now, W), 604800);
});

test('a last-sweep timestamp in the future falls back to the buffer only', () => {
  const last = new Date(now + 3600e3).toISOString();
  assert.equal(tprSeconds(last, now, W), 6 * 3600);
});

test('an unparseable timestamp is treated as a first run', () => {
  assert.equal(tprSeconds('not-a-date', now, W), 604800);
});
