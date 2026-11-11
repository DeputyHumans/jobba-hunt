import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSearch, evaluateView } from '../scripts/lib/guards.mjs';

test('healthy canary passes', () => {
  assert.deepEqual(evaluateSearch({ status: 'ok' }, { canary: true, suspectStreak: 0 }), { abort: null, suspectStreak: 0 });
});

test('canary with zero IDs and no empty marker aborts (throttle or selector rot)', () => {
  assert.equal(evaluateSearch({ status: 'suspect' }, { canary: true, suspectStreak: 0 }).abort, 'canary-failed');
});

test('canary that LinkedIn says is empty also aborts: the canary is chosen never to be legitimately empty', () => {
  assert.equal(evaluateSearch({ status: 'empty' }, { canary: true, suspectStreak: 0 }).abort, 'canary-empty');
});

test('login loss and checkpoint abort on any search', () => {
  assert.equal(evaluateSearch({ status: 'login' }, { canary: false, suspectStreak: 0 }).abort, 'login-lost');
  assert.equal(evaluateSearch({ status: 'checkpoint' }, { canary: false, suspectStreak: 0 }).abort, 'checkpoint');
});

test('narrow query legitimately empty: no abort, streak resets', () => {
  assert.deepEqual(evaluateSearch({ status: 'empty' }, { canary: false, suspectStreak: 1 }), { abort: null, suspectStreak: 0 });
});

test('one suspect page is tolerated, two in a row abort', () => {
  const a = evaluateSearch({ status: 'suspect' }, { canary: false, suspectStreak: 0 });
  assert.deepEqual(a, { abort: null, suspectStreak: 1 });
  assert.equal(evaluateSearch({ status: 'suspect' }, { canary: false, suspectStreak: 1 }).abort, 'throttle-suspect');
});

test('unknown status aborts (fail closed)', () => {
  assert.equal(evaluateSearch({ status: 'weird' }, { canary: false, suspectStreak: 0 }).abort, 'unknown-status:weird');
});

test('view: ok and unreadable continue, login/checkpoint abort, two unreadable in a row abort', () => {
  assert.deepEqual(evaluateView({ status: 'ok' }, { unreadableStreak: 1 }), { abort: null, unreadableStreak: 0 });
  assert.equal(evaluateView({ status: 'checkpoint' }, { unreadableStreak: 0 }).abort, 'checkpoint');
  assert.equal(evaluateView({ status: 'login' }, { unreadableStreak: 0 }).abort, 'login-lost');
  assert.deepEqual(evaluateView({ status: 'unreadable' }, { unreadableStreak: 0 }), { abort: null, unreadableStreak: 1 });
  assert.equal(evaluateView({ status: 'unreadable' }, { unreadableStreak: 1 }).abort, 'views-unreadable');
});
