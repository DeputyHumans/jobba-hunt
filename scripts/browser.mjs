#!/usr/bin/env node
// npm run browser: the agent's side of the chrome driver (scripts/lib/bridge.mjs; the procedure is
// .agents/skills/hunt-browser/SKILL.md). The command keeps every gate, cap and record; the agent does
// each page action it asks for with the Claude in Chrome tools.
//
//   npm run -s browser -- start <tick|dice-tick|sweep|probe|jobs|dice|apply> [-- <the command's args>]
//   npm run -s browser -- next [--timeout <seconds>]
//   npm run -s browser -- done --id <request> [--url <the tab's URL>] [--screenshot <png>] [--failed "<why>"] [--next]
//   npm run -s browser -- status
//
// start runs the command in the background, under the bridge, then waits like next. done
// acknowledges a request (a load or eval needs its envelope written to respond_to first); --next
// then waits like next. Prints one JSON object as its last stdout line.
// Exit codes: 0 a request to serve (`request`), or done without --next acknowledged; 10 the command
// finished (`exit`, `result`: read them as that command's own exit code and JSON); 3 nothing yet
// (`waiting`), no run (`idle`) or the bridge is busy; 1 an error (no envelope, unknown request); 2 usage.

import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BridgeBusyError, acknowledge, activeRun, bridgeDir, claimRun, nextEvent, waitFor } from './lib/bridge.mjs';
import { SCRIPTS_DIR, display } from './lib/paths.mjs';

const COMMANDS = { tick: 'tick.mjs', 'dice-tick': 'dice-tick.mjs', sweep: 'sweep-jobs.mjs', probe: 'probe-searches.mjs', jobs: 'linkedin-jobs.mjs', dice: 'dice-jobs.mjs', apply: 'apply-job.mjs' };
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const has = (name) => argv.includes(`--${name}`);
const out = (obj, code) => { console.log(JSON.stringify(obj)); process.exit(code); };
const dir = bridgeDir();

async function wait(timeoutSec) {
  const ev = await waitFor(() => nextEvent({ dir }), { timeoutMs: timeoutSec * 1000 });
  if (ev.kind === 'request') out({ success: true, event: 'request', request: ev.request }, 0);
  if (ev.kind === 'done') out({ success: true, event: 'done', run_id: ev.run_id, command: ev.command, exit: ev.exit, crashed: ev.crashed, result: ev.result, log: ev.log }, 10);
  out({ success: true, event: ev.kind, run_id: ev.run_id ?? null }, 3);
}

const cmd = argv[0];
const timeout = Number(flag('timeout') || 240);
if (cmd === 'start') {
  const name = argv[1];
  const sep = argv.indexOf('--', 2);
  const args = sep >= 0 ? argv.slice(sep + 1) : argv.slice(2);
  const file = name === 'test' && process.env.JOBBA_BRIDGE_TEST_SCRIPT ? process.env.JOBBA_BRIDGE_TEST_SCRIPT : COMMANDS[name] && join(SCRIPTS_DIR, COMMANDS[name]);
  if (!file) out({ success: false, error: `usage: start <${Object.keys(COMMANDS).join('|')}> [-- <args>]` }, 2);
  let row;
  try { row = claimRun({ command: [name, ...args].join(' '), pid: null, dir }); } catch (err) {
    if (err instanceof BridgeBusyError) out({ success: false, busy: true, error: err.message, holder: err.holder }, 3);
    throw err;
  }
  mkdirSync(join(dir, 'runs'), { recursive: true });
  const log = openSync(join(dir, 'runs', `${row.run_id}.log`), 'a');
  const child = spawn(process.execPath, [file, ...args], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, JOBBA_BRIDGE_RUN: row.run_id, JOBBA_BROWSER_DRIVER: 'chrome' } });
  child.unref();
  const active = { ...row, pid: child.pid };
  writeFileSync(join(dir, 'active.json'), `${JSON.stringify(active, null, 2)}\n`);
  writeFileSync(join(dir, 'runs', `${row.run_id}.json`), `${JSON.stringify(active, null, 2)}\n`);
  process.stderr.write(`[browser] ${name} started as ${row.run_id} (pid ${child.pid}); its output: ${display(join(dir, 'runs', `${row.run_id}.log`))}\n`);
  await wait(timeout);
} else if (cmd === 'next') {
  await wait(timeout);
} else if (cmd === 'done') {
  const id = flag('id');
  if (!id) out({ success: false, error: 'usage: done --id <request> [--url <url>] [--screenshot <png>] [--failed "<why>"] [--next]' }, 2);
  try { acknowledge(id, { failed: flag('failed'), url: flag('url'), screenshot: flag('screenshot'), dir }); } catch (err) { out({ success: false, error: err.message }, 1); }
  if (has('next')) await wait(timeout);
  out({ success: true, acknowledged: id }, 0);
} else if (cmd === 'status') {
  const a = activeRun(dir);
  out({ success: true, active: a, next: a ? nextEvent({ dir }).kind : 'idle' }, 0);
} else {
  out({ success: false, error: 'usage: npm run browser -- start <command> [-- <args>] | next | done --id <request> | status' }, 2);
}
