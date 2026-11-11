// The bikeshed CLI, run from the project's own node_modules with its config under
// <workspace>/.secrets (scripts/lib/env.mjs childEnv). Every caller that publishes, updates,
// reads comments, replies or resolves goes through bikeshedRun / bikeshedRunSync, so tests inject
// a fake runner and no code depends on a global install.
//
// Result: { code, stdout, stderr }. code 127 means the CLI is missing (run `npm ci`).
// isAuthError(r) tells a signed-out CLI from any other failure (callers exit 2 on it).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { childEnv } from '../env.mjs';
import { toolBin } from '../paths.mjs';

export const BIKESHED_BIN = () => toolBin('bikeshed');

export function bikeshedRun(args, { bin = BIKESHED_BIN(), timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    if (!existsSync(bin)) { resolve({ code: 127, stdout: '', stderr: `bikeshed CLI not found at ${bin}: run npm ci` }); return; }
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv('bikeshed') });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (err) => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: String(err.message) }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

export function bikeshedRunSync(args, { bin = BIKESHED_BIN() } = {}) {
  if (!existsSync(bin)) return { code: 127, stdout: '', stderr: `bikeshed CLI not found at ${bin}: run npm ci` };
  const r = spawnSync(bin, args, { encoding: 'utf8', env: childEnv('bikeshed') });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || String(r.error?.message || '') };
}

export const isAuthError = (r) => r.code !== 0 && /log ?in|token|signed[- ]in|unauthori[sz]ed|401/i.test(`${r.stderr}\n${r.stdout}`);

export function parseJsonOut(stdout) {
  const s = String(stdout || '');
  const i = s.indexOf('{');
  try { return JSON.parse(i < 0 ? s : s.slice(i)); } catch { return null; }
}
