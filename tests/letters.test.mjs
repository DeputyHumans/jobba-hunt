import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../scripts/lib/paths.mjs';
import { sentLetters, letterPrivacy, letterUrls, docPath, publishLetters } from '../scripts/lib/letters.mjs';

const job = (id, application) => ({ job_id: id, title: `Role ${id}`, company: `Co ${id}`, application });

test('only letters that went out are published: a submit or a hand-off, never a closed or merely approved role', () => {
  const state = { jobs: {
    a: job('a', { status: 'submitted', cover_pdf: 'workspace/data/applications/a/l.pdf' }),
    b: job('b', { status: 'submitted-by-hand', cover_pdf: '/abs/b/l.pdf' }),
    c: job('c', { status: 'approved', cover_pdf: 'x/c.pdf', attempts: [{ outcome: 'manual' }] }),
    d: job('d', { status: 'closed', cover_pdf: 'x/d.pdf' }),
    e: job('e', { status: 'approved', cover_pdf: 'x/e.pdf', attempts: [{ outcome: 'needs_answers' }] }),
    f: job('f', { status: 'submitted' }),
    g: job('g', { status: 'closed', cover_pdf: 'x/g.pdf', attempts: [{ outcome: 'manual' }] }),
  } };
  const got = sentLetters(state, { repo: '/repo', home: '/ws', data: '/ws/data' });
  assert.deepEqual(got.map((l) => l.id), ['a', 'b', 'c']);
  assert.equal(got[0].html, '/repo/workspace/data/applications/a/l.html');
  assert.equal(got[1].html, '/abs/b/l.html');
});

test('stored paths: absolute, $JOBBA_HOME/ and $JOBBA_DATA_DIR/ spellings, else repo-relative', () => {
  const o = { repo: '/repo', home: '/ws', data: '/data' };
  assert.equal(docPath('/abs/x.pdf', o), '/abs/x.pdf');
  assert.equal(docPath('$JOBBA_HOME/data/applications/1/l.pdf', o), '/ws/data/applications/1/l.pdf');
  assert.equal(docPath('$JOBBA_DATA_DIR/applications/1/l.pdf', o), '/data/applications/1/l.pdf');
  assert.equal(docPath('workspace/data/l.pdf', o), '/repo/workspace/data/l.pdf');
});

test('letter privacy: only the application email, no phone number', () => {
  assert.deepEqual(letterPrivacy('<p>jordan@example.com</p>'), [], 'the default allow-list is the profile\'s application email');
  assert.deepEqual(letterPrivacy('<p>Jordan@Example.com</p>', ['jordan@example.com']), []);
  assert.deepEqual(letterPrivacy('<p>someone@example.org</p>'), ['email someone@example.org']);
  assert.deepEqual(letterPrivacy('<p>Call 555-555-0100</p>'), ['phone number']);
  assert.deepEqual(letterPrivacy('<style>.x{width:555 555 0100}</style><p>ok</p>'), [], 'style blocks are not page text');
});

test('letter URLs map job ids to their bikeshed docs', () => {
  assert.deepEqual(letterUrls({ a: { cfg: { url: 'https://bikeshed.now/d/x' } }, b: { cfg: {} } }), { a: 'https://bikeshed.now/d/x' });
});

function fixture() {
  const dir = mkdtempSync(join(DATA_DIR, 'letters-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'l.html'), '<html><body><p>Hello. jordan@example.com</p></body></html>');
  writeFileSync(join(dir, 'app', 'bad.html'), '<html><body><p>Call 555-555-0100</p></body></html>');
  const state = { jobs: {
    '9000000001': job('9000000001', { status: 'submitted', cover_pdf: join(dir, 'app', 'l.pdf') }),
    '9000000002': job('9000000002', { status: 'submitted', cover_pdf: join(dir, 'app', 'bad.pdf') }),
    '9000000003': job('9000000003', { status: 'submitted', cover_pdf: join(dir, 'app', 'missing.pdf') }),
  } };
  return { dir, state, path: join(dir, 'state.json') };
}

test('publisher local: nothing is published and the state file is untouched', async () => {
  const { state, path } = fixture();
  const calls = [];
  const r = await publishLetters({ state, folderId: 'folder-1', run: async (a) => { calls.push(a); return { code: 0, stdout: '{}', stderr: '' }; }, path, local: true });
  assert.equal(r.published, false);
  assert.deepEqual(calls, []);
  assert.equal(existsSync(path), false);
});

test('a sent letter is published once through the injected runner; the privacy guard and a missing render refuse', async () => {
  const { state, path } = fixture();
  const calls = [];
  const run = async (a) => {
    calls.push(a);
    if (a[0] === 'publish') return { code: 0, stdout: JSON.stringify({ docId: 'doc-1', url: 'https://bikeshed.now/d/doc-1', versionId: 'v1' }), stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  const r = await publishLetters({ state, folderId: 'folder-1', run, path, local: false });
  assert.equal(r.published, true);
  const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
  assert.equal(by['9000000001'].status, 'created');
  assert.equal(by['9000000001'].url, 'https://bikeshed.now/d/doc-1');
  assert.deepEqual(by['9000000002'].bad, ['phone number']);
  assert.equal(by['9000000003'].status, 'no-render');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 1), ['publish']);
  assert.ok(calls[0].includes('Cover letter · Co 9000000001 · Role 9000000001'), 'the title names the company and role');
  assert.deepEqual(letterUrls(JSON.parse(readFileSync(path, 'utf8'))), { '9000000001': 'https://bikeshed.now/d/doc-1' });
  const again = await publishLetters({ state, folderId: 'folder-1', run, path, local: false });
  assert.equal(again.results.find((x) => x.id === '9000000001').status, 'unchanged', 'unchanged HTML makes no call');
  assert.equal(calls.length, 1);
});
