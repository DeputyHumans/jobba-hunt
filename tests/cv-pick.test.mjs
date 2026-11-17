// Archetype mode, auto-apply's CV: the best-covering CV of the role's lane (config/apply.json
// auto_apply.cv_pool), not only the archetype's; a domain CV only for its own domain. No pool keeps
// the archetype's CV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCv } from '../scripts/lib/triage.mjs';

const POOL = { 'hands-on': ['lead-engineer', 'platform-architect', 'staff-product-engineer'], leadership: ['engineering-leader', 'mvp-build', 'health-platform'], domain: ['health-platform', 'bio-data'] };
const R = (o) => Object.entries(o).map(([slug, pct]) => ({ slug, pct }));
const LANES = ['leadership', 'hands-on'];

test('best CV: a better-covering CV of the same lane beats the archetype', () => {
  assert.deepEqual(pickCv(R({ 'staff-product-engineer': 80, 'lead-engineer': 55 }), { lane: 'hands-on', archetype: 'lead-engineer', pool: POOL, lanes: LANES }), { slug: 'staff-product-engineer', pct: 80, archetype_pct: 55 });
});

test('best CV: a tie keeps the archetype; another lane never wins', () => {
  assert.equal(pickCv(R({ 'platform-architect': 70, 'lead-engineer': 70 }), { lane: 'hands-on', archetype: 'lead-engineer', pool: POOL, lanes: LANES }).slug, 'lead-engineer');
  assert.equal(pickCv(R({ 'engineering-leader': 95, 'platform-architect': 61 }), { lane: 'hands-on', archetype: 'platform-architect', pool: POOL, lanes: LANES }).slug, 'platform-architect');
  assert.equal(pickCv(R({ 'lead-engineer': 95, 'mvp-build': 66 }), { lane: 'leadership', archetype: 'mvp-build', pool: POOL, lanes: LANES }).slug, 'mvp-build');
});

test('best CV: a domain CV only for its own domain', () => {
  assert.equal(pickCv(R({ 'health-platform': 90, 'mvp-build': 70 }), { lane: 'leadership', archetype: 'mvp-build', pool: POOL, lanes: LANES }).slug, 'mvp-build');
  assert.equal(pickCv(R({ 'health-platform': 90, 'mvp-build': 70 }), { lane: 'leadership', archetype: 'health-platform', pool: POOL, lanes: LANES }).slug, 'health-platform');
});

test('best CV: an omitted lane is the first lane; nothing of the lane in the ranking gives null', () => {
  assert.equal(pickCv(R({ 'lead-engineer': 90, 'mvp-build': 60 }), { lane: undefined, archetype: 'mvp-build', pool: POOL, lanes: LANES }).slug, 'mvp-build');
  assert.equal(pickCv(R({ 'bio-data': 90 }), { lane: 'hands-on', archetype: 'x', pool: POOL, lanes: LANES }), null);
});

test('no pool for the lane: the archetype CV and its own coverage, as before', () => {
  const ranked = R({ 'staff-product-engineer': 80, 'lead-engineer': 55 });
  assert.deepEqual(pickCv(ranked, { lane: 'hands-on', archetype: 'lead-engineer', pool: {}, lanes: LANES }), { slug: 'lead-engineer', pct: 55, archetype_pct: 55 });
  assert.deepEqual(pickCv(ranked, { lane: 'hands-on', archetype: 'lead-engineer', pool: undefined, lanes: LANES }), { slug: 'lead-engineer', pct: 55, archetype_pct: 55 });
  assert.deepEqual(pickCv(ranked, { lane: 'hands-on', archetype: 'unmeasured', pool: { leadership: ['mvp-build'] }, lanes: LANES }), { slug: 'unmeasured', pct: null, archetype_pct: null });
  assert.equal(pickCv(ranked, { lane: 'hands-on', archetype: null, pool: {}, lanes: LANES }), null);
});

test('the lanes default to preferences.lanes of the workspace', () => {
  assert.equal(pickCv(R({ 'mvp-build': 60 }), { archetype: 'mvp-build', pool: { leadership: ['mvp-build'] } }).slug, 'mvp-build');
});
