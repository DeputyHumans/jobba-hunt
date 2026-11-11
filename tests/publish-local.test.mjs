import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { trackerPublisher, bikeshedCfg, loadReviewDocs, setReviewDoc, dropReviewDoc } from '../scripts/lib/adapters/publish.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

test('local publisher: writes data/tracker/tracker.html, publishes nothing, has no comments', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'jobba-pub-'));
  const run = async () => assert.fail('no bikeshed call expected');
  const p = trackerPublisher({ cfg: { publisher: 'local' }, run, dataDir });
  assert.equal(p.kind, 'local');
  const r = await p.publish({ html: '<p>x</p>' });
  assert.deepEqual([r.status, r.published, r.path], ['local', false, join(dataDir, 'tracker', 'tracker.html')]);
  assert.equal(readFileSync(r.path, 'utf8'), '<p>x</p>');
  assert.deepEqual(await p.comments(), { status: 'local', threads: [] });
  assert.equal((await p.reply('d', 't', 'x')).published, false);
});

test('bikeshed publisher: the tracker.json bikeshed block, the publish protocol, and comments, reply and resolve through the runner', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === 'publish') return { code: 0, stdout: JSON.stringify({ docId: 'doc1', versionId: 'v1', url: 'https://bikeshed.now/d/doc1' }), stderr: '' };
    if (args[0] === 'comments') return { code: 0, stdout: JSON.stringify({ threads: [{ threadId: 't1', comments: [] }] }), stderr: '' };
    if (args[0] === 'resolve') return { code: 1, stdout: '', stderr: 'error: not signed in. Run `bikeshed login`.' };
    return { code: 0, stdout: '{}', stderr: '' };
  };
  const cfg = { publisher: 'bikeshed', title: 'Job hunt · Applications', bikeshed: { folder_id: 'f1', doc_id: null } };
  const p = trackerPublisher({ cfg, run });
  assert.deepEqual(bikeshedCfg(cfg), { folder_id: 'f1', doc_id: null, url: null, letters_folder_id: null, reviews_folder_id: null });
  const r = await p.publish({ html: '<a>', file: '/tmp/t.html' });
  assert.equal(r.status, 'created');
  assert.deepEqual(calls[0], ['publish', '/tmp/t.html', '--title', 'Job hunt · Applications', '--folder', 'f1', '--json']);
  assert.deepEqual((await p.comments('doc1')).threads.map((t) => t.threadId), ['t1']);
  assert.equal((await p.reply('doc1', 't1', 'Done.')).status, 'ok');
  assert.deepEqual(calls.at(-1), ['reply', 'doc1', 't1', 'Done.', '--json']);
  assert.equal((await p.resolve('doc1', 't1')).status, 'auth');
  assert.equal((await trackerPublisher({ cfg: { bikeshed: {} }, run }).comments()).status, 'no-doc');
});

test('review-docs.json: set, read and drop one job\'s review document', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'jobba-rev-')), 'tracker', 'review-docs.json');
  assert.deepEqual(loadReviewDocs(path), {});
  setReviewDoc('9000000001', { doc_id: 'rev1', url: 'https://bikeshed.now/d/rev1' }, path);
  assert.deepEqual(loadReviewDocs(path), { 9000000001: { doc_id: 'rev1', url: 'https://bikeshed.now/d/rev1' } });
  assert.throws(() => setReviewDoc('x', {}, path), /doc_id/);
  dropReviewDoc('9000000001', path);
  assert.deepEqual(loadReviewDocs(path), {});
});

test('tracker CLI with publisher local: --publish renders, skips bikeshed, exits 0 with published false and the path', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-trk-ws-'));
  cpSync(join(ROOT, 'tests', 'fixtures', 'workspace', 'profile'), join(home, 'profile'), { recursive: true });
  cpSync(join(ROOT, 'tests', 'fixtures', 'workspace', 'pipeline'), join(home, 'pipeline'), { recursive: true });
  mkdirSync(join(home, 'config'));
  writeFileSync(join(home, 'config', 'tracker.json'), JSON.stringify({ publisher: 'local' }));
  const data = join(home, 'data');
  // A bikeshed that fails if it is ever called.
  const env = { ...process.env, JOBBA_HOME: home, JOBBA_DATA_DIR: data, JOBBA_BIKESHED_BIN: join(home, 'no-such-bikeshed') };
  const r = spawnSync(process.execPath, ['scripts/tracker.mjs', '--publish'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.deepEqual([out.success, out.status, out.published, out.path], [true, 'local', false, '$JOBBA_HOME/data/tracker/tracker.html']);
  const html = readFileSync(join(data, 'tracker', 'tracker.html'), 'utf8');
  assert.match(html, /<span class="wordmark">Jordan Example<\/span>/);
  assert.match(html, /<tr id="mail-0000aaaa00000001">/); // the fixture's open mail thread is a card
  assert.ok(!existsSync(join(home, 'config', 'tracker.json.tmp')));
});

test('tracker CLI privacy guard: a stray address in the data stops the publish with exit 1', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobba-trk-ws-'));
  cpSync(join(ROOT, 'tests', 'fixtures', 'workspace', 'profile'), join(home, 'profile'), { recursive: true });
  mkdirSync(join(home, 'config'));
  writeFileSync(join(home, 'config', 'tracker.json'), JSON.stringify({ publisher: 'local' }));
  const data = join(home, 'data');
  mkdirSync(join(data, 'state'), { recursive: true });
  const job = { job_id: '9000000001', url: 'https://www.linkedin.com/jobs/view/9000000001/', title: 'Head of Engineering, write to hr@acme.example', company: 'Acme Corp', first_seen: '2026-11-02T15:00:00Z', prefilter: { verdict: 'drop', reasons: ['onsite'] }, status: 'dropped' };
  writeFileSync(join(data, 'state', 'jobs.json'), JSON.stringify({ _schema: 2, jobs: { 9000000001: job }, sources: {} }));
  const r = spawnSync(process.execPath, ['scripts/tracker.mjs', '--dry-run'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, JOBBA_HOME: home, JOBBA_DATA_DIR: data } });
  assert.equal(r.status, 1, r.stdout);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').at(-1)).privacy, ['email hr@acme.example']);
});
