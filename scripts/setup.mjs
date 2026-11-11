#!/usr/bin/env node
// npm run setup: one idempotent pass that makes a fresh clone runnable. Safe to re-run.
//   1. checks Node and the installed npm dependencies
//   2. downloads the CloakBrowser Chromium into <repo>/.cache/cloakbrowser (never the home folder)
//   3. links the skills: .claude/skills/<name> -> ../../.agents/skills/<name>
//   4. points git at the repo's hooks (.githooks/pre-commit runs check:portable and check:pii)
//   5. on Linux, probes the shared libraries Chromium needs, notify-send and a display, and prints
//      one copy-paste install line for anything missing (it never installs system packages)
// It never touches the workspace: /hunt-onboard (or `npm run onboard -- init`) creates that.
//
//   node scripts/setup.mjs [--skip-browser]

import './lib/env.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { BIN_DIR, CODE_ROOT } from './lib/paths.mjs';

const ok = (m) => console.log(`  ok    ${m}`);
const warn = (m) => console.log(`  warn  ${m}`);
const bad = (m) => console.log(`  FAIL  ${m}`);
let failed = false;

console.log('jobba-hunt setup\n');

// 1. Node and dependencies
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) { bad(`Node ${process.versions.node}: version 20 or newer is required (see .nvmrc)`); process.exit(1); }
ok(`Node ${process.versions.node}`);
const deps = ['cloakbrowser', 'playwright-core', 'bikeshed-now', '@googleworkspace/cli', 'pdf-lib', 'pdfjs-dist', 'docx'];
const missing = deps.filter((d) => !existsSync(join(CODE_ROOT, 'node_modules', d, 'package.json')));
if (missing.length) { bad(`npm dependencies missing: ${missing.join(', ')}. Run: npm ci`); process.exit(1); }
ok('npm dependencies installed');
for (const bin of ['bikeshed', 'gws']) {
  if (existsSync(join(BIN_DIR, bin))) ok(`${bin} CLI available (node_modules/.bin/${bin})`);
  else { warn(`${bin} CLI missing from node_modules/.bin: run npm ci`); }
}

// 2. Browser binary, in-folder
if (process.argv.includes('--skip-browser')) warn('browser download skipped (--skip-browser)');
else {
  try {
    const { ensureBinary } = await import('cloakbrowser');
    const bin = await ensureBinary(undefined, process.env.CLOAKBROWSER_VERSION || undefined);
    ok(`Chromium ready in .cache/cloakbrowser (${bin.split('/').slice(-4).join('/')})`);
  } catch (err) {
    bad(`Chromium download failed: ${String(err.message || err).split('\n')[0]}`);
    failed = true;
  }
}

// 3. Skills
const link = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', 'skills-link.mjs')], { encoding: 'utf8' });
if (link.status === 0) ok(`skills linked into .claude/skills (${JSON.parse(link.stdout.trim().split('\n').pop()).skills} skills)`);
else { bad(`skills link failed: ${link.stderr || link.stdout}`); failed = true; }

// 4. Git hooks
try {
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: CODE_ROOT, stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: CODE_ROOT });
  ok('git hooks: core.hooksPath = .githooks (pre-commit runs check:portable and check:pii)');
} catch {
  warn('not a git checkout: hooks not installed (fine for a plain copy)');
}

// 5. Linux host probes
if (platform() === 'linux') {
  const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
  const needLibs = ['libnss3.so', 'libatk-1.0.so.0', 'libatk-bridge-2.0.so.0', 'libcups.so.2', 'libdrm.so.2', 'libxkbcommon.so.0', 'libxcomposite.so.1', 'libxdamage.so.1', 'libxrandr.so.2', 'libgbm.so.1', 'libpango-1.0.so.0', 'libasound.so.2'];
  const ldconfig = spawnSync('sh', ['-c', 'ldconfig -p 2>/dev/null'], { encoding: 'utf8' }).stdout || '';
  const libsMissing = ldconfig ? needLibs.filter((l) => !ldconfig.includes(l)) : [];
  if (libsMissing.length) {
    warn(`Chromium libraries missing: ${libsMissing.join(', ')}`);
    console.log('        Debian/Ubuntu: sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libasound2');
    console.log('        Fedora:        sudo dnf install -y nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXrandr mesa-libgbm pango alsa-lib');
  } else if (ldconfig) ok('Chromium shared libraries present');
  if (has('notify-send')) ok('notify-send available (desktop notifications)');
  else warn('notify-send missing: notifications fall back to the terminal. Debian/Ubuntu: sudo apt-get install -y libnotify-bin');
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) ok('display available (headed logins and dry runs)');
  else warn('no DISPLAY or WAYLAND_DISPLAY: headed logins, dry runs and bot checks need a desktop session');
}

console.log(failed ? '\nSetup finished with errors (above).' : '\nSetup done. Next: npm run doctor -- --preflight, then /hunt-onboard in your agent.');
process.exit(failed ? 1 : 0);
