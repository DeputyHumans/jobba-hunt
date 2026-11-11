// The comment watch against a stub bikeshed CLI: the stub answers `comments <doc> --json` from a
// JSON file the test rewrites between polls, and records every call it gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

function setup(trackerCfg = { bikeshed: { doc_id: 'doc-tracker' } }) {
  const home = mkdtempSync(join(tmpdir(), 'jobba-watch-'));
  cpSync(join(ROOT, 'tests', 'fixtures', 'workspace', 'profile'), join(home, 'profile'), { recursive: true });
  mkdirSync(join(home, 'config'));
  writeFileSync(join(home, 'config', 'tracker.json'), JSON.stringify(trackerCfg));
  const data = join(home, 'data');
  mkdirSync(join(data, 'tracker'), { recursive: true });
  const docs = join(home, 'stub-docs.json');
  const calls = join(home, 'stub-calls.log');
  const bin = join(home, 'bikeshed');
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
const docs = JSON.parse(fs.readFileSync(${JSON.stringify(docs)}, 'utf8'));
if (args[0] !== 'comments') { process.stderr.write('stub: unexpected ' + args[0]); process.exit(1); }
const d = docs[args[1]];
if (d === 'auth') { process.stderr.write('error: That token was not accepted. Run bikeshed login again.'); process.exit(1); }
process.stdout.write(JSON.stringify({ threads: d || [] }));
`);
  chmodSync(bin, 0o755);
  const state = (o) => writeFileSync(docs, JSON.stringify(o));
  const once = () => {
    const r = spawnSync(process.execPath, ['scripts/tracker-watch.mjs', '--once'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, JOBBA_HOME: home, JOBBA_DATA_DIR: data, JOBBA_BIKESHED_BIN: bin } });
    return { code: r.status, events: r.stdout.trim() ? r.stdout.trim().split('\n').map((l) => JSON.parse(l)) : [], stderr: r.stderr };
  };
  const callLog = () => readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { home, data, state, once, callLog };
}

test('watch --once: the tracker and every review doc, one line per new thread or comment, deduped across polls, never a reply or resolve', () => {
  const w = setup();
  writeFileSync(join(w.data, 'tracker', 'review-docs.json'), JSON.stringify({ 9000000007: { doc_id: 'doc-review-7', url: 'https://bikeshed.now/d/doc-review-7' } }));
  const t1 = { threadId: 't1', section: 'job-9000000004', quote: 'Head of Engineering', comments: [{ author: { name: 'Jordan Example' }, body: 'skip this one', createdAt: '2026-11-10T15:00:00Z' }] };
  const r1 = { threadId: 'r1', section: 'summary', quote: 'Led a team of 12', comments: [{ author: 'Jordan Example', body: '' }] };
  w.state({ 'doc-tracker': [t1], 'doc-review-7': [r1] });
  let r = w.once();
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.events, [
    { doc: 'doc-tracker', kind: 'tracker', thread_id: 't1', section: 'job-9000000004', quote: 'Head of Engineering', text: 'skip this one', author: 'Jordan Example', at: '2026-11-10T15:00:00Z' },
    { doc: 'doc-review-7', kind: 'review', job_id: '9000000007', thread_id: 'r1', section: 'summary', quote: 'Led a team of 12', text: '', author: 'Jordan Example', at: null, typing: true },
  ]);
  assert.deepEqual(w.once().events, []); // same data: nothing new, and typing is not repeated
  w.state({ 'doc-tracker': [{ ...t1, comments: [...t1.comments, { author: 'Jordan Example', body: 'Skipped.', via: 'cli' }] }], 'doc-review-7': [{ ...r1, comments: [{ author: 'Jordan Example', body: 'approve' }] }] });
  r = w.once();
  assert.deepEqual(r.events.map((e) => [e.doc, e.thread_id, e.text]), [['doc-review-7', 'r1', 'approve']]);
  assert.ok(w.callLog().every((a) => a[0] === 'comments' && a.at(-1) === '--json'));
  const st = JSON.parse(readFileSync(join(w.data, 'tracker', 'watch-state.json'), 'utf8'));
  assert.deepEqual([st['doc-tracker'].threads.t1.n, st['doc-review-7'].threads.r1.n], [2, 1]);
});

test('watch --once: a signed-out CLI prints one error line and exits 2; publisher local or no document exits 0 quietly', () => {
  const w = setup();
  w.state({ 'doc-tracker': 'auth' });
  let r = w.once();
  assert.equal(r.code, 2);
  assert.deepEqual(r.events.map((e) => [e.doc, e.error]), [['doc-tracker', 'auth']]);
  assert.deepEqual(w.once().events, []); // the same error is not repeated
  const local = setup({ publisher: 'local' });
  local.state({});
  r = local.once();
  assert.deepEqual([r.code, r.events], [0, []]);
  assert.match(r.stderr, /publisher local/);
  const empty = setup({ bikeshed: {} });
  empty.state({});
  r = empty.once();
  assert.deepEqual([r.code, r.events], [0, []]);
});

test('watch --once: a tailored job lists its CV and letter as separate review documents, each tagged with its part', () => {
  const w = setup();
  writeFileSync(join(w.data, 'tracker', 'review-docs.json'), JSON.stringify({ 9000000042: { cv: { doc_id: 'doc-cv-42', url: 'u1', version_id: 'v1' }, letter: { doc_id: 'doc-letter-42', url: 'u2', version_id: 'v1' }, updated_at: '2026-11-10T15:00:00Z' } }));
  const c = { threadId: 'c1', section: 's', quote: 'Platform lead', comments: [{ author: 'Jordan Example', body: 'shorter summary please' }] };
  const l = { threadId: 'l1', section: 's', quote: 'Dear team', comments: [{ author: 'Jordan Example', body: 'approve' }] };
  w.state({ 'doc-tracker': [], 'doc-cv-42': [c], 'doc-letter-42': [l] });
  const r = w.once();
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.events.map((e) => [e.doc, e.kind, e.job_id, e.part, e.text]), [
    ['doc-cv-42', 'review', '9000000042', 'cv', 'shorter summary please'],
    ['doc-letter-42', 'review', '9000000042', 'letter', 'approve'],
  ]);
});
