// The chrome driver's bridge, with the test playing the agent: it reads each request, writes the
// envelope the page would write, and acknowledges it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BridgeBusyError, BrowserUnavailableError, acknowledge, bridgeRun, claimRun, nextEvent } from '../scripts/lib/bridge.mjs';
import { dashHash, envelopeText } from '../scripts/lib/page-script.mjs';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

const env = (runId) => ({ JOBBA_BRIDGE_RUN: runId, JOBBA_BRIDGE_FAKE_AGENT: '1', JOBBA_NO_BROWSER: '1' });
const envelopeFor = (req, payload, href = 'https://www.linkedin.com/jobs/view/1/') => envelopeText({ v: 1, id: req.id, nonce: req.nonce, href, at: new Date().toISOString(), status: 'ok', error: null, sha256: dashHash(JSON.stringify(payload)), payload });

// Serve requests as they come: `answer(req)` returns the text to write, or { failed } to fail it.
function fakeAgent(dir, answer) {
  let stop = false;
  const served = [];
  (async () => {
    while (!stop) {
      const ev = nextEvent({ dir });
      if (ev.kind === 'request') {
        const req = ev.request;
        served.push(req);
        const a = answer(req, served.length);
        if (a?.failed) acknowledge(req.id, { failed: a.failed, dir });
        else if (a?.skip) { /* never answer */ } else {
          if (req.kind !== 'act') writeFileSync(req.respond_to, `Title: x\nURL: ${req.url || ''}\n---\n${a}\n`);
          acknowledge(req.id, { url: req.url || 'https://www.linkedin.com/x', dir });
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  return { served, stop: () => { stop = true; } };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'jobba-bridge-'));
  const row = claimRun({ command: 'test', pid: process.pid, dir });
  return { dir, row, run: bridgeRun('test', { env: env(row.run_id), dir, pollMs: 20, timeoutSec: 2 }) };
}
const main = async function probe(arg) { return { echo: arg }; };

test('bridgeRun refuses outside the bridge, and under JOBBA_NO_BROWSER without the fake agent', () => {
  assert.throws(() => bridgeRun('tick', { env: {} }), /through the bridge/);
  assert.throws(() => bridgeRun('tick', { env: { JOBBA_BRIDGE_RUN: 'run-x', JOBBA_NO_BROWSER: '1' } }), /blocked/);
});

test('a load comes back as the verified envelope and counts as a page load', async () => {
  const { dir, run } = setup();
  const agent = fakeAgent(dir, (req) => envelopeFor(req, { echo: { n: 7 } }));
  try {
    const r = await run.page({ kind: 'load', url: 'https://www.linkedin.com/jobs/view/1/', host: 'linkedin.com', main, arg: { n: 7 }, summary: 'view 1' });
    assert.deepEqual(r.env.payload, { echo: { n: 7 } });
    assert.equal(r.loaded, true);
    assert.equal(run.loads, 1);
    const req = agent.served[0];
    assert.equal(req.kind, 'load');
    assert.equal(req.steps[0].tool, 'navigate');
    assert.ok(req.steps.some((s) => s.tool === 'file_upload') && req.steps.some((s) => s.tool === 'get_page_text'));
    assert.equal(existsSync(req.script), false, 'the bundle is removed once served');
  } finally { agent.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('a tampered copy is read again once on the same page, with no new navigation; twice ends the run', async () => {
  const { dir, run } = setup();
  const good = (req) => envelopeFor(req, { echo: 1 });
  let agent = fakeAgent(dir, (req, n) => (n === 1 ? good(req).replace('echo', 'ecHo') : good(req)));
  try {
    const r = await run.page({ kind: 'load', url: 'https://www.linkedin.com/jobs/view/2/', host: 'linkedin.com', main, arg: 1 });
    assert.deepEqual(r.env.payload, { echo: 1 });
    assert.deepEqual(agent.served.map((q) => q.kind), ['load', 'eval']);
    assert.equal(run.loads, 1);
  } finally { agent.stop(); }
  agent = fakeAgent(dir, (req) => good(req).replace('echo', 'ecHo'));
  try {
    await assert.rejects(run.page({ kind: 'load', url: 'https://www.linkedin.com/jobs/view/3/', host: 'linkedin.com', main, arg: 1 }), (e) => e instanceof BrowserUnavailableError && /integrity/.test(e.why) && e.loaded === true);
  } finally { agent.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('no answer in time, or a failed load, ends with BrowserUnavailableError; another host fails the check', async () => {
  const { dir, run } = setup();
  let agent = fakeAgent(dir, () => ({ skip: true }));
  try {
    await assert.rejects(run.page({ kind: 'load', url: 'https://www.linkedin.com/a', host: 'linkedin.com', main, timeoutSec: 1 }), (e) => e instanceof BrowserUnavailableError && e.loaded === false && /no response/.test(e.why));
  } finally { agent.stop(); }
  agent = fakeAgent(dir, () => ({ failed: 'no browser connected' }));
  try {
    await assert.rejects(run.page({ kind: 'eval', host: 'linkedin.com', main }), (e) => e instanceof BrowserUnavailableError && /no browser connected/.test(e.why));
  } finally { agent.stop(); }
  agent = fakeAgent(dir, (req) => envelopeFor(req, { echo: null }, 'https://evil.example/x'));
  try {
    await assert.rejects(run.page({ kind: 'eval', host: 'linkedin.com', main }), (e) => e instanceof BrowserUnavailableError && /integrity/.test(e.why));
  } finally { agent.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('an act request returns the acknowledgement; done refuses a load without its envelope; the lock is single', async () => {
  const { dir, row, run } = setup();
  const agent = fakeAgent(dir, () => 'ignored');
  try {
    const a = await run.act({ action: 'click', label: 'Next', summary: 'Click Next' });
    assert.equal(a.ok, true);
    assert.equal(agent.served[0].act.label, 'Next');
  } finally { agent.stop(); }
  assert.throws(() => claimRun({ command: 'other', pid: process.pid, dir }), BridgeBusyError);
  const p = run.page({ kind: 'eval', host: 'linkedin.com', main, timeoutSec: 1 });
  await new Promise((r) => setTimeout(r, 100));
  const ev = nextEvent({ dir });
  assert.throws(() => acknowledge(ev.request.id, { dir }), /write the envelope/);
  await assert.rejects(p, BrowserUnavailableError);
  assert.equal(row.command, 'test');
  rmSync(dir, { recursive: true, force: true });
});

test('npm run browser: start serves the first request, done --next returns the finished command', () => {
  const data = mkdtempSync(join(tmpdir(), 'jobba-bridge-cli-'));
  const script = join(data, 'probe-cmd.mjs');
  writeFileSync(script, `import { bridgeRun } from ${JSON.stringify(pathToFileURL(join(CODE_ROOT, 'scripts', 'lib', 'bridge.mjs')).href)};
const run = bridgeRun('test', { pollMs: 50, timeoutSec: 20 });
const r = await run.page({ kind: 'load', url: 'https://www.dice.com/jobs', host: 'dice.com', main: async function m() { return 1; }, summary: 'one load' });
console.log(JSON.stringify({ success: true, payload: r.env.payload, loads: run.loads }));
process.exit(0);
`);
  const cli = (...a) => {
    const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', 'browser.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, JOBBA_DATA_DIR: data, JOBBA_BRIDGE_TEST_SCRIPT: script, JOBBA_BRIDGE_FAKE_AGENT: '1' } });
    return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop() || '{}'), err: r.stderr };
  };
  try {
    const s = cli('start', 'test', '--timeout', '20');
    assert.equal(s.code, 0, s.err + JSON.stringify(s.json));
    const req = s.json.request;
    assert.equal(req.kind, 'load');
    assert.equal(cli('done', '--id', req.id).code, 1, 'no envelope yet');
    writeFileSync(req.respond_to, envelopeFor(req, 1, 'https://www.dice.com/jobs'));
    const d = cli('done', '--id', req.id, '--url', 'https://www.dice.com/jobs', '--next', '--timeout', '20');
    assert.equal(d.code, 10, JSON.stringify(d.json));
    assert.equal(d.json.exit, 0);
    assert.deepEqual(d.json.result, { success: true, payload: 1, loads: 1 });
    assert.equal(cli('next', '--timeout', '1').code, 3, 'idle once the run ended');
    assert.equal(cli('start', 'nope').code, 2);
  } finally { rmSync(data, { recursive: true, force: true }); }
});
