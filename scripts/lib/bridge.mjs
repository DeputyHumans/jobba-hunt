// The browser bridge for the chrome driver: a command (tick, sweep, probe, the readers, apply) that
// runs under `npm run browser -- start` keeps every gate, cap, plan and record, and hands each page
// action to the agent, which does it with the Claude in Chrome tools and acknowledges it with
// `npm run browser -- done`. Files under <data>/bridge/:
//   active.json            the one run allowed at a time {run_id, command, pid, started_at}
//   runs/<run>.json        the run; runs/<run>.exit.json its exit code; runs/<run>.log its output
//   requests/<id>.json     one page action: kind load | eval | act, the exact tool steps
//   requests/<id>.js       the page script bundle of a load or eval (lib/page-script.mjs)
//   responses/<id>.txt     the agent's copy of get_page_text (the envelope) for a load or eval
//   responses/<id>.done.json  the agent's acknowledgement {ok, why, url, screenshot}
// A load counts as a page load (the rate limiter) only once the agent acknowledged it. A request
// with no acknowledgement within its time, or whose envelope fails its checks twice, ends the run
// with BrowserUnavailableError: never a halt (lib/tick-plan.mjs haltsSource).

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR, display } from './paths.mjs';
import { CLEAR_JS, EVAL_JS, LOADER_JS, READ_JS, RUN_JS, buildBundle, readEnvelope } from './page-script.mjs';

export class BridgeBusyError extends Error {
  constructor(holder) { super(`the browser bridge is busy: run ${holder.run_id} (${holder.command}) holds it`); this.profileBusy = true; this.holder = holder; }
}
export class BrowserUnavailableError extends Error {
  constructor(why, { loaded = false } = {}) { super(`browser unavailable: ${why}`); this.why = why; this.loaded = loaded; }
}
export class ChromeNeedsBridgeError extends Error {
  constructor(cmd) { super(`under the chrome driver run it through the bridge: npm run -s browser -- start ${cmd} -- <args>`); this.cap = 'chrome-needs-bridge'; }
}

export const bridgeDir = (dir = join(DATA_DIR, 'bridge')) => dir;
const paths = (dir) => ({ active: join(dir, 'active.json'), runs: join(dir, 'runs'), requests: join(dir, 'requests'), responses: join(dir, 'responses') });
const writeJson = (p, obj) => { mkdirSync(dirname(p), { recursive: true }); const t = `${p}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(obj, null, 2)}\n`); renameSync(t, p); };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the lock ----------
export function activeRun(dir = bridgeDir()) {
  const a = readJson(paths(dir).active);
  if (!a) return null;
  if (a.pid && !alive(a.pid) && !existsSync(join(paths(dir).runs, `${a.run_id}.exit.json`))) return { ...a, dead: true };
  return a;
}
export function claimRun({ command, pid, dir = bridgeDir() }) {
  const held = activeRun(dir);
  if (held && !held.dead && !existsSync(join(paths(dir).runs, `${held.run_id}.exit.json`))) throw new BridgeBusyError(held);
  const run_id = `run-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const row = { run_id, command, pid, started_at: new Date().toISOString() };
  writeJson(paths(dir).active, row);
  writeJson(join(paths(dir).runs, `${run_id}.json`), row);
  return row;
}
export function releaseRun(runId, dir = bridgeDir()) {
  const a = readJson(paths(dir).active);
  if (a?.run_id === runId) rmSync(paths(dir).active, { force: true });
}

// ---------- the command's side ----------
// The run this process serves, from JOBBA_BRIDGE_RUN (set by `browser -- start`). It records its
// exit code for the agent's `next`. Throws ChromeNeedsBridgeError when started directly.
export function bridgeRun(command, { env = process.env, dir = bridgeDir(), pollMs = 1000, timeoutSec = 300 } = {}) {
  const runId = env.JOBBA_BRIDGE_RUN;
  if (!runId) throw new ChromeNeedsBridgeError(command);
  if (env.JOBBA_NO_BROWSER === '1' && env.JOBBA_BRIDGE_FAKE_AGENT !== '1') throw new Error('browser launches are blocked (JOBBA_NO_BROWSER): npm test never opens a real browser');
  const p = paths(dir);
  process.on('exit', (code) => { try { writeFileSync(join(p.runs, `${runId}.exit.json`), JSON.stringify({ code, at: new Date().toISOString() })); } catch { /* nothing to record into */ } });
  let seq = 0;
  const run = { runId, command, dir, pollMs, timeoutSec, tab: null, loads: 0 };

  const newRequest = (kind, extra) => {
    seq += 1;
    const id = `rq-${runId.slice(4)}-${String(seq).padStart(3, '0')}`;
    const created = new Date();
    const row = { id, run_id: runId, seq, kind, created_at: created.toISOString(), expires_at: new Date(created.getTime() + (extra.timeoutSec || timeoutSec) * 1000).toISOString(), ...extra };
    delete row.timeoutSec;
    return row;
  };
  const waitAck = async (row) => {
    const ack = join(p.responses, `${row.id}.done.json`);
    const until = Date.parse(row.expires_at);
    while (Date.now() < until) {
      const a = readJson(ack);
      if (a) return a;
      await sleepMs(pollMs);
    }
    return null;
  };
  const close = (id) => { for (const f of [`${id}.json`, `${id}.js`]) rmSync(join(p.requests, f), { force: true }); for (const f of [`${id}.txt`, `${id}.done.json`]) rmSync(join(p.responses, f), { force: true }); };

  // A page script on the current page (eval) or on a URL first (load). Returns { env, url }.
  // An integrity failure is read again once on the same page, never with a new navigation.
  run.page = async ({ kind = 'eval', url = null, host = null, main, arg = null, helpers = [], summary, timeoutSec: t } = {}, again = false) => {
    const nonce = randomUUID().replace(/-/g, '').slice(0, 16);
    const row = newRequest(again ? 'eval' : kind, { url: again ? null : url, host, summary, nonce, timeoutSec: t });
    const script = join(p.requests, `${row.id}.js`);
    const respond = join(p.responses, `${row.id}.txt`);
    mkdirSync(p.responses, { recursive: true });
    mkdirSync(p.requests, { recursive: true });
    writeFileSync(script, buildBundle({ id: row.id, nonce, main, arg, helpers }));
    row.script = script;
    row.respond_to = respond;
    row.steps = pageSteps(row);
    writeJson(join(p.requests, `${row.id}.json`), row);
    process.stderr.write(`[browser-bridge] ${row.kind} ${row.id}: ${summary || ''}\n`);
    const a = await waitAck(row);
    const text = existsSync(respond) ? readFileSync(respond, 'utf8') : null;
    close(row.id);
    const loaded = row.kind === 'load' && !!a && (a.ok || a.loaded === true);
    if (loaded) run.loads += 1;
    if (!a) throw new BrowserUnavailableError(`no response to ${row.id} within ${Math.round((Date.parse(row.expires_at) - Date.parse(row.created_at)) / 1000)} s`, { loaded: false });
    if (!a.ok) throw new BrowserUnavailableError(`${row.id} failed: ${String(a.why || 'no reason').slice(0, 200)}`, { loaded });
    try {
      return { env: readEnvelope(text || '', { id: row.id, nonce, host }), url: a.url || null, loaded };
    } catch (err) {
      if (again) throw new BrowserUnavailableError(`integrity: ${err.message}`, { loaded: true });
      process.stderr.write(`[browser-bridge] ${row.id}: ${err.message}; reading the page again\n`);
      const r = await run.page({ kind: 'eval', host, main, arg, helpers, summary: `${summary || ''} (read again)`, timeoutSec: t }, true);
      return { ...r, loaded: loaded || r.loaded };
    }
  };

  // An action for the agent to do with its own judgment and tools (click a named control, pick an
  // option, upload a file, open or close a tab). Returns the acknowledgement.
  run.act = async ({ action, label = null, value = null, file = null, target = null, summary, secret = false, timeoutSec: t } = {}) => {
    const row = newRequest('act', { act: { action, label, value: secret ? null : value, file, target }, summary, timeoutSec: t });
    row.steps = actSteps(row);
    writeJson(join(p.requests, `${row.id}.json`), row);
    process.stderr.write(`[browser-bridge] act ${row.id}: ${summary || action}\n`);
    const a = await waitAck(row);
    close(row.id);
    if (!a) throw new BrowserUnavailableError(`no response to ${row.id}`, { loaded: false });
    return a;
  };
  return run;
}

// The exact tool steps the agent follows for a load or eval (hunt-browser skill).
export function pageSteps(row) {
  const done = `npm run -s browser -- done --id ${row.id} --url <the tab's URL> --next`;
  return [
    ...(row.kind === 'load' ? [{ tool: 'navigate', input: { url: row.url } }] : []),
    { tool: 'javascript_tool', input: { action: 'javascript_exec', text: LOADER_JS } },
    { tool: 'find', input: { query: 'file input labelled jobba loader' }, note: 'take its ref' },
    { tool: 'file_upload', input: { paths: [row.script], ref: '<the ref from find>' } },
    { tool: 'javascript_tool', input: { action: 'javascript_exec', text: READ_JS } },
    { tool: 'javascript_tool', input: { action: 'javascript_exec', text: EVAL_JS }, note: `prints loaded ${row.id}` },
    { tool: 'javascript_tool', input: { action: 'javascript_exec', text: RUN_JS }, note: 'prints JOBBA ok …' },
    { tool: 'get_page_text', input: {} },
    { write: row.respond_to, what: 'everything from JOBBA-ENVELOPE to JOBBA-END, exactly as get_page_text printed it' },
    { tool: 'javascript_tool', input: { action: 'javascript_exec', text: CLEAR_JS } },
    { bash: done },
  ];
}
export function actSteps(row) {
  return [{ do: row.summary || row.act.action, act: row.act }, { bash: `npm run -s browser -- done --id ${row.id} --next` }, { bash_failed: `npm run -s browser -- done --id ${row.id} --failed "<what happened>" --next` }];
}

// ---------- the agent's side ----------
// The next thing for the agent: the oldest open request of the active run, or the run's end.
export function nextEvent({ dir = bridgeDir() } = {}) {
  const p = paths(dir);
  const a = readJson(p.active);
  if (!a) return { kind: 'idle' };
  const open = existsSync(p.requests) ? readdirSync(p.requests).filter((f) => f.endsWith('.json')).map((f) => readJson(join(p.requests, f))).filter((r) => r && r.run_id === a.run_id && !existsSync(join(p.responses, `${r.id}.done.json`))).sort((x, y) => x.seq - y.seq) : [];
  if (open.length) return { kind: 'request', request: open[0] };
  const exit = readJson(join(p.runs, `${a.run_id}.exit.json`));
  if (exit || (a.pid && !alive(a.pid))) {
    const log = existsSync(join(p.runs, `${a.run_id}.log`)) ? readFileSync(join(p.runs, `${a.run_id}.log`), 'utf8') : '';
    const last = log.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
    let result = null;
    try { result = last ? JSON.parse(last) : null; } catch { result = null; }
    releaseRun(a.run_id, dir);
    return { kind: 'done', run_id: a.run_id, command: a.command, exit: exit ? exit.code : null, crashed: !exit, result, log: display(join(p.runs, `${a.run_id}.log`)) };
  }
  return { kind: 'waiting', run_id: a.run_id };
}

export function acknowledge(id, { failed = null, url = null, screenshot = null, dir = bridgeDir() } = {}) {
  const p = paths(dir);
  const req = readJson(join(p.requests, `${id}.json`));
  if (!req) throw new Error(`no open request ${id}`);
  if (!failed && (req.kind === 'load' || req.kind === 'eval') && !existsSync(join(p.responses, `${id}.txt`))) throw new Error(`write the envelope to ${display(join(p.responses, `${id}.txt`))} first (get_page_text, from JOBBA-ENVELOPE to JOBBA-END), or pass --failed "<why>"`);
  writeJson(join(p.responses, `${id}.done.json`), { ok: !failed, why: failed || null, url, screenshot, at: new Date().toISOString() });
  return req;
}

export const waitFor = async (fn, { timeoutMs, pollMs = 500 }) => {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v.kind === 'request' || v.kind === 'done' || v.kind === 'idle') return v;
    if (Date.now() >= until) return v;
    await sleepMs(pollMs);
  }
};
