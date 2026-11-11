import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  emptyState, upsertCards, viewCandidates, postedAt, saveStateAtomic, loadState, normalizeKey, markSweepSuccess, setPrefilter, setDetail, touchedIds,
  markQueryRun, recordTick,
} from '../scripts/lib/state.mjs';

const card = (id, title = 'Fractional CTO', company = 'Acme Corp') => ({ job_id: id, title, company, location: 'Remote', url: `https://www.linkedin.com/jobs/view/${id}/` });
const T1 = '2026-10-26T15:00:00.000Z';
const T2 = '2026-10-27T15:00:00.000Z';

test('new cards are created with first_seen, seen_count 1 and the matching query', () => {
  const s = emptyState();
  const r = upsertCards(s, [card('9000000001')], { queryId: 'fractional-cto', scope: 'fractional', sweepId: 'sw1', now: T1 });
  assert.deepEqual(r.newIds, ['9000000001']);
  const j = s.jobs['9000000001'];
  assert.equal(j.first_seen, T1);
  assert.equal(j.seen_count, 1);
  assert.deepEqual(j.matched_queries, ['fractional-cto']);
  assert.deepEqual(j.scopes, ['fractional']);
  assert.equal(j.status, 'new');
});

test('the same job hit by two queries in one sweep counts as seen once', () => {
  const s = emptyState();
  upsertCards(s, [card('9000000001')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw1', now: T1 });
  const r = upsertCards(s, [card('9000000001')], { queryId: 'q2', scope: 'generic', sweepId: 'sw1', now: T1 });
  assert.deepEqual(r.newIds, []);
  assert.deepEqual(r.seenIds, ['9000000001']);
  const j = s.jobs['9000000001'];
  assert.equal(j.seen_count, 1);
  assert.deepEqual(j.matched_queries.sort(), ['q1', 'q2']);
  assert.deepEqual(j.scopes.sort(), ['fractional', 'generic']);
});

test('a later sweep increments seen_count and last_seen', () => {
  const s = emptyState();
  upsertCards(s, [card('9000000001')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw1', now: T1 });
  upsertCards(s, [card('9000000001')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw2', now: T2 });
  assert.equal(s.jobs['9000000001'].seen_count, 2);
  assert.equal(s.jobs['9000000001'].last_seen, T2);
  assert.equal(s.jobs['9000000001'].first_seen, T1);
});

test('a later card with richer text fills in fields the virtualized card left empty', () => {
  const s = emptyState();
  upsertCards(s, [{ job_id: '9000000001', title: null, company: null, location: null }], { queryId: 'q1', scope: 'fractional', sweepId: 'sw1', now: T1 });
  upsertCards(s, [card('9000000001')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw1', now: T1 });
  assert.equal(s.jobs['9000000001'].title, 'Fractional CTO');
});

test('a new ID with the same company+title within 30 days is marked as a repost', () => {
  const s = emptyState();
  upsertCards(s, [card('9000000001', 'Fractional CTO', 'Acme, Inc.')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw1', now: T1 });
  upsertCards(s, [card('9000000002', 'Fractional  CTO', 'acme inc')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw2', now: T2 });
  assert.equal(s.jobs['9000000002'].repost_of, '9000000001');
});

test('the repost window comes from prefilter.json repost_window_days, or the caller', async () => {
  const { repostWindowDays } = await import('../scripts/lib/state.mjs');
  const tpl = JSON.parse(readFileSync(new URL('../templates/workspace/config/prefilter.json', import.meta.url), 'utf8'));
  assert.equal(repostWindowDays(), tpl.repost_window_days);
  const s = emptyState();
  upsertCards(s, [card('9000000001', 'Interim CTO', 'Globex')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw1', now: T1 });
  upsertCards(s, [card('9000000002', 'Interim CTO', 'Globex')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw2', now: '2026-11-06T15:00:00.000Z', repostDays: 7 });
  assert.equal(s.jobs['9000000002'].repost_of, null, '11 days apart, outside a 7-day window');
  upsertCards(s, [card('9000000003', 'Interim CTO', 'Globex')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw3', now: '2026-11-06T15:00:00.000Z', repostDays: 30 });
  assert.equal(s.jobs['9000000003'].repost_of, '9000000001');
});

test('normalizeKey collapses case, punctuation and company suffixes', () => {
  assert.equal(normalizeKey('Acme, Inc.', 'Fractional CTO (Remote)'), normalizeKey('ACME', 'fractional cto remote'));
});

test('view candidates: keep/review, not yet viewed, not reposts; fractional scope breaks a tie', () => {
  const s = emptyState();
  upsertCards(s, [card('9000000001', 'CTO', 'Globex')], { queryId: 'g', scope: 'generic', sweepId: 'sw1', now: T1 });
  upsertCards(s, [card('9000000002', 'Fractional CTO', 'Initech')], { queryId: 'f', scope: 'fractional', sweepId: 'sw1', now: T1 });
  upsertCards(s, [card('9000000003', 'Junior Dev', 'Hooli')], { queryId: 'f', scope: 'fractional', sweepId: 'sw1', now: T1 });
  upsertCards(s, [card('9000000004', 'Interim CTO', 'Umbrella Labs')], { queryId: 'f', scope: 'fractional', sweepId: 'sw1', now: T1 });
  setPrefilter(s, '9000000001', { verdict: 'keep', reasons: [], flags: [] });
  setPrefilter(s, '9000000002', { verdict: 'review', reasons: ['location-unclear'], flags: [] });
  setPrefilter(s, '9000000003', { verdict: 'drop', reasons: ['title-excluded'], flags: [] });
  setPrefilter(s, '9000000004', { verdict: 'keep', reasons: [], flags: [] });
  setDetail(s, '9000000004', { fetched_at: T1, description_text: 'x' });
  assert.deepEqual(viewCandidates(s, { limit: 10 }), ['9000000002', '9000000001']);
  assert.deepEqual(viewCandidates(s, { limit: 1 }), ['9000000002']);
});

test('state saves atomically (no temp file left) and round-trips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobba-state-'));
  const p = join(dir, 'jobs.json');
  const s = emptyState();
  upsertCards(s, [card('9000000001')], { queryId: 'q1', scope: 'fractional', sweepId: 'sw1', now: T1 });
  markSweepSuccess(s, T1);
  saveStateAtomic(p, s);
  assert.deepEqual(readdirSync(dir), ['jobs.json']);
  const back = loadState(p);
  assert.equal(back.last_successful_sweep, T1);
  assert.equal(back.jobs['9000000001'].title, 'Fractional CTO');
  assert.equal(JSON.parse(readFileSync(p, 'utf8'))._schema, 2);
});

test('loading a missing state file returns an empty state', () => {
  const s = loadState(join(tmpdir(), 'definitely-missing-jobba-state.json'));
  assert.equal(s.last_successful_sweep, null);
  assert.deepEqual(s.jobs, {});
});

test('a dropped job that a later query re-qualifies goes back to new', () => {
  const s = emptyState();
  upsertCards(s, [card('9000000009', 'CTO', 'Soylent Systems')], { queryId: 'canary-cto', scope: 'canary', sweepId: 'sw1', now: T1 });
  setPrefilter(s, '9000000009', { verdict: 'drop', reasons: ['canary-only'], flags: [] });
  assert.equal(s.jobs['9000000009'].status, 'dropped');
  upsertCards(s, [card('9000000009', 'CTO', 'Soylent Systems')], { queryId: 'cto-contract', scope: 'generic', sweepId: 'sw1', now: T1 });
  setPrefilter(s, '9000000009', { verdict: 'keep', reasons: [], flags: [] });
  assert.equal(s.jobs['9000000009'].status, 'new');
  assert.deepEqual(viewCandidates(s, { limit: 5 }), ['9000000009']);
});

test('touchedIds returns only jobs seen in the given sweep', () => {
  const s = emptyState();
  upsertCards(s, [card('9000000001')], { queryId: 'q', scope: 'fractional', sweepId: 'sw1', now: T1 });
  upsertCards(s, [card('9000000002', 'Interim CTO', 'Globex')], { queryId: 'q', scope: 'fractional', sweepId: 'sw2', now: T2 });
  assert.deepEqual(touchedIds(s, 'sw2'), ['9000000002']);
});

test('a schema 1 state file migrates to schema 2 on load, jobs untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobba-state-'));
  const p = join(dir, 'jobs.json');
  const v1 = { _schema: 1, last_successful_sweep: T1, jobs: { 9000000001: { job_id: '9000000001', title: 'Fractional CTO' } } };
  writeFileSync(p, JSON.stringify(v1));
  const s = loadState(p);
  assert.equal(s._schema, 2);
  assert.equal(s.last_successful_sweep, T1);
  assert.deepEqual(s.query_runs, {});
  assert.equal(s.ticks_since_canary, null);
  assert.equal(s.suspect_streak, 0);
  assert.equal(s.halt_until, null);
  assert.equal(s.jobs['9000000001'].title, 'Fractional CTO');
});

test('an unknown schema still refuses to load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobba-state-'));
  const p = join(dir, 'jobs.json');
  writeFileSync(p, JSON.stringify({ _schema: 9, jobs: {} }));
  assert.throws(() => loadState(p), /unsupported state schema 9/);
});

test('markQueryRun records the per-query window start', () => {
  const s = emptyState();
  markQueryRun(s, 'fractional-leaders', T1);
  assert.deepEqual(s.query_runs['fractional-leaders'], { last_ok: T1 });
});

test('recordTick resets the canary counter on a canary tick and counts classic ticks', () => {
  const s = emptyState();
  recordTick(s, { kind: 'canary', id: 'c', at: T1 });
  assert.equal(s.ticks_since_canary, 0);
  recordTick(s, { kind: 'query', id: 'q', at: T2 });
  assert.equal(s.ticks_since_canary, 1);
  assert.deepEqual(s.last_tick, { kind: 'query', id: 'q', at: T2 });
});

test('the view page corrects a shifted card: title and company from the detail, a location that is really the company dropped', () => {
  const s = emptyState();
  upsertCards(s, [{ job_id: '9000000077', title: 'Interim CTO (Verified job)', company: 'Interim CTO', location: 'Initech' }], { queryId: 'q', scope: 'semantic', sweepId: 'sw1', now: T1 });
  setDetail(s, '9000000077', { title: 'Interim CTO', company: 'Initech', description_text: 'x' });
  const j = s.jobs['9000000077'];
  assert.equal(j.title, 'Interim CTO');
  assert.equal(j.company, 'Initech');
  assert.equal(j.location, null);
});

test('carryRun: an apply run hands over only what it changed, so triage recorded meanwhile survives', async () => {
  const { carryRun } = await import('../scripts/lib/state.mjs');
  const loaded = { halt_until: null, dice_halt_until: null };
  const run = { halt_until: null, sources: { dice: { halt_until: '2026-11-05T12:00:00.000Z' } }, cv_uploads: { 'cv.pdf': { sha: 'a' } }, jobs: { j1: { status: 'approved' } } };
  const fresh = { halt_until: null, sources: { dice: { halt_until: null, ticks: 3 } }, cv_uploads: { 'old.pdf': { sha: 'b' } }, jobs: { j1: { status: 'approved' }, j2: { status: 'triaged', triage: { tier: 'A' } } } };
  const out = carryRun(fresh, run, loaded);
  assert.equal(out.jobs.j2.status, 'triaged');
  assert.equal(out.jobs.j2.triage.tier, 'A');
  assert.deepEqual(Object.keys(out.cv_uploads).sort(), ['cv.pdf', 'old.pdf']);
  assert.equal(out.sources.dice.halt_until, '2026-11-05T12:00:00.000Z');
  assert.equal(out.sources.dice.ticks, 3);
  assert.equal(out.halt_until, null);
});

test('carryRun: a halt set elsewhere during the run is kept when the run did not touch it', async () => {
  const { carryRun } = await import('../scripts/lib/state.mjs');
  const out = carryRun({ halt_until: '2026-11-05T12:00:00.000Z', jobs: {} }, { halt_until: null, jobs: {} }, { halt_until: null, dice_halt_until: null });
  assert.equal(out.halt_until, '2026-11-05T12:00:00.000Z');
});

test('view candidates: newest posting first, from the card "N hours ago" against when it was seen', () => {
  const s = emptyState();
  const seen = '2026-11-05T18:00:00.000Z';
  upsertCards(s, [{ ...card('9000000011', 'Fractional CTO', 'Acme Corp'), posted_text: '5 days ago' }], { queryId: 'f', scope: 'fractional', sweepId: 'sw1', now: seen });
  upsertCards(s, [{ ...card('9000000012', 'Head of AI', 'Globex'), posted_text: '2 hours ago' }], { queryId: 'g', scope: 'generic', sweepId: 'sw1', now: seen });
  upsertCards(s, [{ ...card('9000000013', 'VP Engineering', 'Hooli'), posted_text: 'Reposted 1 day ago' }], { queryId: 'g', scope: 'generic', sweepId: 'sw1', now: seen });
  for (const id of ['9000000011', '9000000012', '9000000013']) setPrefilter(s, id, { verdict: 'keep', reasons: [], flags: [] });
  assert.deepEqual(viewCandidates(s, { limit: 10 }), ['9000000012', '9000000013', '9000000011']);
});

test('postedAt: reads LinkedIn relative ages against the time the card was seen', () => {
  const seen = '2026-11-05T18:00:00.000Z';
  const at = (t) => postedAt({ posted_text: t, last_seen: seen });
  assert.equal(at('2 hours ago'), Date.parse(seen) - 2 * 3600000);
  assert.equal(at('Reposted 1 day ago'), Date.parse(seen) - 86400000);
  assert.equal(at('3 weeks ago'), Date.parse(seen) - 21 * 86400000);
  assert.equal(at('30 minutes ago'), Date.parse(seen) - 30 * 60000);
  assert.equal(at(null), Date.parse(seen));
});

test('DATA_DIR and STATE_PATH are re-exported from the workspace paths', async () => {
  const paths = await import('../scripts/lib/paths.mjs');
  const { DATA_DIR, STATE_PATH } = await import('../scripts/lib/state.mjs');
  assert.equal(DATA_DIR, paths.DATA_DIR);
  assert.equal(STATE_PATH, join(paths.DATA_DIR, 'state', 'jobs.json'));
});
