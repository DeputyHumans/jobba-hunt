import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../scripts/lib/config.mjs';
import { scanPending, scanQuery, ownText, signatureNames } from '../scripts/lib/mail-scan.mjs';

const cfg = { ...loadConfig('mail.json'), first_scan_after: '2026-11-01T00:00:00Z' };
const ME = 'jordan@example.com';
const NOW = new Date('2026-11-02T20:40:00Z');
const H = {
  a: { id: 'a', threadId: 'ta', fromAddr: 'friend@gmail.example', from: 'Friend', subject: 'Dinner?', date: '2026-11-02T18:00:00.000Z', labels: ['INBOX'] },
  b: { id: 'b', threadId: 'tb', fromAddr: 'sam@staffco.example', from: 'Sam Recruiter', subject: 'Re: Senior Architect', date: '2026-11-02T18:10:00.000Z', labels: ['INBOX'] },
  c: { id: 'c', threadId: 'tc', fromAddr: 'deals@shop.example', from: 'Shop', subject: 'Sale', date: '2026-11-02T18:20:00.000Z', labels: ['CATEGORY_PROMOTIONS'] },
};
const fakeGws = ({ failOn } = {}) => {
  const bodies = [];
  return {
    bodies,
    list: async () => Object.values(H).map((h) => ({ id: h.id, threadId: h.threadId })),
    headers: async (id) => { if (id === failOn) throw new Error('gws: bad json'); return H[id]; },
    body: async (id) => { bodies.push(id); return `body ${id}`; },
    thread: async () => [
      { id: 'p0', fromAddr: ME, date: '2026-11-02T17:00:00.000Z', labels: ['SENT'], text: 'Old note' },
      { id: 'p1', fromAddr: ME, date: '2026-11-02T18:30:00.000Z', labels: ['SENT'], text: 'Hi Sam\n\nOn Mon, Nov 2, 2026 Sam Recruiter wrote:\n> what rate' },
    ],
  };
};

test('scanPending: headers only without a signal', async () => {
  const gws = fakeGws();
  const r = await scanPending({ gws, cfg, st: {}, known: new Set(), openThreads: [], now: NOW });
  assert.deepEqual(gws.bodies, ['b']);
  assert.deepEqual(r.pending.map((p) => p.id), ['b']);
  assert.equal(r.pending[0].text, 'body b');
  assert.ok(!JSON.stringify(r.st).includes('friend@gmail.example') && !r.st.seen.includes('a'));
});

test('scanPending: a reader failure leaves the state unchanged', async () => {
  const st = { last_scan_at: '2026-11-01T00:00:00.000Z', seen: ['z'] };
  const before = structuredClone(st);
  await assert.rejects(scanPending({ gws: fakeGws({ failOn: 'b' }), cfg, st, known: new Set(), openThreads: [], now: NOW }));
  assert.deepEqual(st, before);
});

test('scanPending: sent detection', async () => {
  const open = [{ thread_id: 'tm', status: 'draft', draft_at: '2026-11-02T18:00:00Z' }];
  const r = await scanPending({ gws: fakeGws(), cfg, st: {}, known: new Set(), openThreads: open, now: NOW });
  assert.deepEqual(r.sent.filter((s) => s.thread_id === 'tm'), [{ thread_id: 'tm', at: '2026-11-02T18:30:00.000Z', text: 'Hi Sam' }]);
});

test('scanQuery: the last scan minus an hour, and a clear error before the first scan date is set', () => {
  assert.deepEqual(scanQuery(cfg, { last_scan_at: '2026-11-02T12:00:00.000Z' }), { after: '2026-11-02T12:00:00.000Z', q: `${cfg.query} after:${Date.parse('2026-11-02T12:00:00Z') / 1000 - 3600}` });
  assert.throws(() => scanQuery({ ...cfg, first_scan_after: null }, {}), /first_scan_after/);
});

test('ownText: drops the signature block (the user\'s full name) and a wrapped quote header, keeps the first-name sign-off', () => {
  assert.deepEqual(signatureNames(), ['Jordan Example']); // from the fixture person.json
  const raw = 'Hi Sam,\n\nThanks.\n\nCheers,\nJordan\n\n\n\nJordan Example\nPrincipal Engineer\n\n\nOn Fri, Oct 30, 2026 at 8:24 AM Sam Recruiter <\nsam@staffco.example> wrote:';
  assert.equal(ownText(raw), 'Hi Sam,\n\nThanks.\n\nCheers,\nJordan');
});

test('ownText: the "-- " delimiter and injected names cut too; a name inside a sentence does not', () => {
  assert.equal(ownText('Sounds good.\n-- \nJ. E.\nPhone'), 'Sounds good.');
  assert.equal(ownText('Yes.\n\nAlex Sample | Engineering\nalex@example.net', ['Alex Sample']), 'Yes.');
  assert.equal(ownText('I told them Jordan Example would call.\nBest', ['Jordan Example']), 'I told them Jordan Example would call.\nBest');
});
