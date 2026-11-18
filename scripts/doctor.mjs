#!/usr/bin/env node
// npm run doctor: a checklist of everything the hunt needs, with the fix for each red item.
//   --preflight   host and install only (before onboarding): Node, deps, Chromium, fonts, skills,
//                 hooks, display, optional tools, path portability
//   (default)     preflight plus the workspace: profile, claims, CVs, searches, sessions, mail,
//                 dashboard, vault, channels, onboarding progress
//   --offline     never touches the network (skips the bikeshed sign-in probe)
//   --json        one JSON object instead of the table
// It never opens a job board, never sends anything and never unlocks a vault.
// Exit 0 when nothing is FAIL (warnings allowed), 1 otherwise.

import './lib/env.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { MIN_NODE, nodeOk } from './lib/node-version.mjs';
import { claimIdsFromBank } from './lib/cv.mjs';
import {
  BIN_DIR, BRAND_DIR, CODE_ROOT, COLLATERAL_DIR, CONFIG_DIR, DATA_DIR, HOME, PROFILE_DIR, SECRETS_DIR, display, workspaceExists,
} from './lib/paths.mjs';

const args = new Set(process.argv.slice(2));
const preflight = args.has('--preflight');
const offline = args.has('--offline');
const rows = [];
const add = (group, status, item, fix = '') => rows.push({ group, status, item, fix });
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
const run = (bin, a, opts = {}) => spawnSync(bin, a, { encoding: 'utf8', timeout: 30000, ...opts });

// ---------- host and install ----------
add('host', nodeOk() ? 'ok' : 'FAIL', `Node ${process.versions.node}`, nodeOk() ? '' : `install Node ${MIN_NODE} or newer (package.json engines), e.g. nvm install && nvm use`);
add('host', has('git') ? 'ok' : 'FAIL', 'git', 'install git');

const deps = ['cloakbrowser', 'playwright-core', 'bikeshed-now', '@googleworkspace/cli', 'pdf-lib', 'pdfjs-dist', 'docx', 'marked'];
const missingDeps = deps.filter((d) => !existsSync(join(CODE_ROOT, 'node_modules', d, 'package.json')));
add('install', missingDeps.length ? 'FAIL' : 'ok', missingDeps.length ? `npm dependencies missing: ${missingDeps.join(', ')}` : 'npm dependencies', 'npm ci');

let chromium = null;
try {
  const { binaryInfo } = await import('cloakbrowser');
  const info = binaryInfo(process.env.CLOAKBROWSER_VERSION || undefined);
  chromium = info?.installed ? info : null;
  add('install', chromium ? 'ok' : 'FAIL', chromium ? `Chromium ${info.version} in .cache/cloakbrowser` : 'Chromium not downloaded', 'npm run setup');
} catch (err) {
  add('install', 'FAIL', `Chromium check failed: ${String(err.message).split('\n')[0]}`, 'npm ci && npm run setup');
}

const fontDir = join(BRAND_DIR, 'fonts');
const fonts = existsSync(fontDir) ? readdirSync(fontDir).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)) : [];
add('install', fonts.length >= 4 ? 'ok' : 'FAIL', `${fonts.length} bundled font files in brand/fonts`, 'restore brand/fonts from git');

const link = run(process.execPath, [join(CODE_ROOT, 'scripts', 'skills-link.mjs'), '--check']);
add('install', link.status === 0 ? 'ok' : 'warn', link.status === 0 ? 'skills linked into .claude/skills' : 'skill links out of date', 'npm run skills:link');

const hooks = run('git', ['config', '--get', 'core.hooksPath'], { cwd: CODE_ROOT }).stdout?.trim();
add('install', hooks === '.githooks' ? 'ok' : 'warn', hooks === '.githooks' ? 'git pre-commit guard installed' : 'git pre-commit guard not installed', 'npm run setup');

for (const bin of ['bikeshed', 'gws']) {
  add('install', existsSync(join(BIN_DIR, bin)) ? 'ok' : 'warn', `${bin} CLI (node_modules/.bin)`, 'npm ci');
}

if (platform() === 'linux') {
  const disp = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
  add('host', disp ? 'ok' : 'warn', disp ? 'desktop display' : 'no display: headed logins, dry runs and bot checks need one', 'run from a desktop session');
  add('host', has('notify-send') ? 'ok' : 'warn', 'notify-send', 'sudo apt-get install -y libnotify-bin');
}
add('optional', has('op') ? 'ok' : 'info', has('op') ? '1Password CLI (op) found' : '1Password CLI not installed (only needed for vault adapter op)', '');
add('optional', has('python3') ? 'ok' : 'info', has('python3') ? 'python3 found (authentic-prose metrics.py)' : 'python3 not found (optional: authentic-prose metrics.py)', '');

const portable = run(process.execPath, [join(CODE_ROOT, 'scripts', 'check-portable.mjs'), '--json'], { cwd: CODE_ROOT });
const pj = (() => { try { return JSON.parse(portable.stdout); } catch { return null; } })();
add('install', pj?.ok ? 'ok' : 'warn', pj?.ok ? 'paths portable' : `${pj?.hits?.length ?? '?'} host-specific path(s) in the repo`, 'npm run check:portable');

// ---------- workspace ----------
if (!preflight) {
  const ws = workspaceExists();
  add('workspace', ws ? 'ok' : 'FAIL', ws ? `workspace at ${display(HOME)}` : 'no workspace yet', 'run /hunt-onboard (or npm run onboard -- init)');
  if (ws) {
    const person = readJson(join(PROFILE_DIR, 'person.json')) || {};
    add('profile', person.name && (person.application_email || person.email) ? 'ok' : 'FAIL', 'person.json name and email', '/hunt-onboard (interview phase)');
    const prefs = readJson(join(PROFILE_DIR, 'preferences.json')) || {};
    let tzOk = false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: prefs.schedule?.tz || 'invalid/zone' }); tzOk = true; } catch { /* invalid */ }
    add('profile', tzOk ? 'ok' : 'FAIL', `preferences.json time zone ${prefs.schedule?.tz || '(unset)'}`, 'set schedule.tz to an IANA zone, e.g. America/New_York');
    const ans = readJson(join(PROFILE_DIR, 'answers.json')) || {};
    const empty = ['email', 'phone', 'city', 'country'].filter((k) => !ans.profile?.[k]);
    add('profile', empty.length ? 'warn' : 'ok', empty.length ? `answer bank empty: ${empty.join(', ')}` : 'answer bank basics', '/hunt-onboard (answers phase)');

    const bank = existsSync(join(COLLATERAL_DIR, 'claim-bank.md')) ? readFileSync(join(COLLATERAL_DIR, 'claim-bank.md'), 'utf8') : '';
    const claims = claimIdsFromBank(bank).size;
    const pending = [...bank.matchAll(/^\|\s*(P\d+)\s*\|/gm)].length;
    add('collateral', claims ? (pending ? 'warn' : 'ok') : 'FAIL', `${claims} usable claims${pending ? `, ${pending} pending confirmation` : ''}`, '/hunt-onboard (claims phase)');
    const master = readJson(join(COLLATERAL_DIR, 'cv', 'master.json')) || {};
    const roles = Object.keys(master.roles || {}).length;
    add('collateral', roles ? 'ok' : 'FAIL', `${roles} roles in cv/master.json`, '/hunt-onboard (ingest phase)');
    const vdir = join(COLLATERAL_DIR, 'cv', 'variants');
    const variants = existsSync(vdir) ? readdirSync(vdir).filter((f) => f.endsWith('.json')).length : 0;
    add('collateral', variants ? 'ok' : 'warn', `${variants} archetype CV variants`, '/hunt-onboard (CV phase)');
    const fit = existsSync(join(HOME, 'fit-profile.md')) ? readFileSync(join(HOME, 'fit-profile.md'), 'utf8') : '';
    const fills = (fit.match(/<fill>/g) || []).length;
    add('collateral', fit && !fills ? 'ok' : 'warn', fit ? (fills ? `fit-profile.md has ${fills} unfilled anchors` : 'fit-profile.md complete') : 'fit-profile.md missing', '/hunt-onboard (interview phase)');

    for (const [name, label] of [['searches.json', 'LinkedIn'], ['dice-searches.json', 'Dice']]) {
      const c = readJson(join(CONFIG_DIR, name));
      add('searches', c?.verified ? 'ok' : 'warn', `${label} query set ${c?.verified ? 'verified by a probe' : 'not verified (ticks refuse)'}`, '/hunt-probe');
    }
    for (const [dir, label, cmd] of [['linkedin', 'LinkedIn', 'npm run jobs -- login'], ['dice', 'Dice', 'npm run dice -- login']]) {
      const p = join(DATA_DIR, 'browser', dir);
      const seeded = existsSync(p) && readdirSync(p).length > 0;
      add('sessions', seeded ? 'ok' : 'warn', `${label} browser profile ${seeded ? 'present (session checked on the next tick)' : 'not signed in yet'}`, seeded ? '' : `${cmd} (by hand, in a real terminal)`);
    }

    const mail = readJson(join(CONFIG_DIR, 'mail.json')) || { adapter: 'none' };
    if (mail.adapter === 'gws') {
      const dir = join(SECRETS_DIR, 'gws');
      const signed = existsSync(dir) && readdirSync(dir).length > 0;
      add('mail', signed ? 'ok' : 'FAIL', `gws adapter ${signed ? 'credentials present' : 'not signed in'}`, 'npm run gws -- auth login (with the read-only Gmail scope); see docs/setup.md');
    } else add('mail', 'ok', `mail adapter: ${mail.adapter || 'none'}${mail.adapter === 'bridge' ? ' (the agent fetches with its mail connector)' : ''}`);

    const tracker = readJson(join(CONFIG_DIR, 'tracker.json')) || { publisher: 'bikeshed' };
    if ((tracker.publisher || 'bikeshed') === 'bikeshed') {
      add('dashboard', tracker.bikeshed?.doc_id ? 'ok' : 'warn', tracker.bikeshed?.doc_id ? `tracker doc ${tracker.bikeshed.doc_id}` : 'tracker doc not created yet', 'npm run tracker -- --publish');
      if (!offline && existsSync(join(BIN_DIR, 'bikeshed'))) {
        const { childEnv } = await import('./lib/env.mjs');
        const r = run(join(BIN_DIR, 'bikeshed'), ['folders', '--json'], { env: childEnv('bikeshed') });
        add('dashboard', r.status === 0 ? 'ok' : 'FAIL', r.status === 0 ? 'bikeshed signed in' : 'bikeshed not signed in', 'npm run bikeshed -- login');
      }
    } else add('dashboard', 'ok', `publisher: ${tracker.publisher} (no comment watch)`);

    const vault = readJson(join(CONFIG_DIR, 'vault.json')) || { adapter: 'none' };
    // The op binary the vault adapter runs: JOBBA_OP_BIN, else vault.json op.bin, else op on PATH.
    const opBin = process.env.JOBBA_OP_BIN || vault.op?.bin || 'op';
    const opFound = opBin.includes('/') ? existsSync(opBin) : has(opBin);
    add('vault', vault.adapter === 'op' && !opFound ? 'FAIL' : 'ok', `vault adapter: ${vault.adapter}${vault.adapter === 'op' ? ` (${opBin})` : ''}`, vault.adapter === 'op' ? 'install the 1Password CLI, set JOBBA_OP_BIN or vault.json op.bin, or set adapter none' : '');

    const apply = readJson(join(CONFIG_DIR, 'apply.json')) || {};
    const verified = Object.entries(apply.verified || {}).filter(([, v]) => v).map(([k]) => k);
    add('apply', 'info', verified.length ? `verified channels: ${verified.join(', ')}` : 'no channel verified yet (each first apply is a headed dry run you check)');
    add('apply', 'info', `auto-apply ${apply.auto_apply?.enabled ? `on (score >= ${apply.auto_apply.min_score})` : 'off'}; tailored-document review: ${prefs.tailoring?.review || 'bikeshed'}`);

    const ob = readJson(join(PROFILE_DIR, 'onboarding.json'));
    const left = ob ? Object.entries(ob.phases || {}).filter(([, v]) => !v).map(([k]) => k) : ['all'];
    add('onboarding', left.length ? 'warn' : 'ok', left.length ? `onboarding phases left: ${left.join(', ')}` : 'onboarding complete', '/hunt-onboard');
    if (existsSync(join(DATA_DIR, 'state', 'jobs.json'))) {
      const age = Math.round((Date.now() - statSync(join(DATA_DIR, 'state', 'jobs.json')).mtimeMs) / 3600000);
      add('loop', 'info', `job state updated ${age} h ago`);
    }
  }
}

// ---------- output ----------
const failCount = rows.filter((r) => r.status === 'FAIL').length;
if (args.has('--json')) {
  console.log(JSON.stringify({ ok: failCount === 0, mode: preflight ? 'preflight' : 'full', rows }));
} else {
  console.log(`jobba-hunt doctor (${preflight ? 'preflight' : 'full'})\n`);
  const order = [...new Set(rows.map((r) => r.group))];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  let group = '';
  for (const r of sorted) {
    if (r.group !== group) { group = r.group; console.log(`${group}`); }
    const tag = { ok: '  ok  ', warn: '  warn', FAIL: '  FAIL', info: '  info' }[r.status];
    console.log(`${tag}  ${r.item}${r.fix && r.status !== 'ok' ? `\n          fix: ${r.fix}` : ''}`);
  }
  console.log(failCount ? `\n${failCount} item(s) need fixing.` : '\nNothing blocking.');
}
process.exit(failCount ? 1 : 0);
