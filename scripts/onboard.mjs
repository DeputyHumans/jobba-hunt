#!/usr/bin/env node
// npm run onboard -- <command>: the scripted half of /hunt-onboard. The skill runs the interview and
// writes the content; these commands create, check and track the workspace.
//
//   init                       create the workspace from templates/workspace (never overwrites a file)
//   status                     onboarding phases done and the next one
//   mark --phase <name>        record a finished phase (preflight init ingest claims interview answers
//                              calibration access cvs searches ready)
//   ingest --file <path> ...   copy source documents (PDF, DOCX, TXT, MD) into sources/ and extract
//                              their text next to them (<name>.txt), page-tagged for claim sources
//   validate                   check every workspace file for shape and consistency
//   git-init                   make the workspace its own private git repository
//   mail-guard --connector gmail [--tools <a,b>]
//                              deny every tool of the harness's Gmail connector except its reads
//                              (search_threads, get_message, get_thread) in .claude/settings.local.json
//                              (bridge adapter). --tools: the live tool names the harness lists; any
//                              that is not a read is denied too. Exit 1 when none of the reads is listed
//   mail-guard --deny <a,b>    the same file, for any other connector: the tools named
// Exit 0 ok, 1 refused or invalid, 2 usage.

import './lib/env.mjs';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODE_ROOT, HOME, PROFILE_DIR, SOURCES_DIR, TEMPLATES_DIR, display, resolveArgPath, CLAUDE_LOCAL_SETTINGS,
} from './lib/paths.mjs';
import { deepMerge, readJsonFile, writeJsonAtomic } from './lib/config.mjs';
import { logAction } from './lib/actions-log.mjs';
import { claimStatuses, explainClaims } from './lib/cv.mjs';
import { LETTER_APPROACHES } from './lib/cover.mjs';
import { CONNECTORS, guardRules, mergeDeny } from './lib/mail-guard.mjs';

export const PHASES = ['preflight', 'init', 'ingest', 'claims', 'interview', 'answers', 'calibration', 'access', 'cvs', 'searches', 'ready'];
const ONB = join(PROFILE_DIR, 'onboarding.json');
const out = (o) => console.log(JSON.stringify(o));
const now = () => new Date().toISOString();

function walk(dir) {
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

export function initWorkspace({ templates = TEMPLATES_DIR, home = HOME } = {}) {
  const created = [];
  const kept = [];
  for (const src of walk(templates)) {
    const rel = relative(templates, src);
    const dst = join(home, rel);
    if (existsSync(dst)) { kept.push(rel); continue; }
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    created.push(rel);
  }
  for (const d of ['data', join('data', 'log'), '.secrets']) mkdirSync(join(home, d), { recursive: true });
  return { created, kept };
}

function loadOnb() { return readJsonFile(ONB, { phases: Object.fromEntries(PHASES.map((p) => [p, null])) }); }
function saveOnb(o) { writeJsonAtomic(ONB, o); }

export function nextPhase(phases) { return PHASES.find((p) => !phases?.[p]) || null; }

// ---------- validate ----------
const compiles = (re) => { try { new RegExp(re, 'i'); return true; } catch { return false; } };
export function validateWorkspace(home = HOME) {
  const problems = [];
  const p = (file, msg) => problems.push({ file, msg });
  const j = (rel) => { try { return JSON.parse(readFileSync(join(home, rel), 'utf8')); } catch (e) { p(rel, existsSync(join(home, rel)) ? `invalid JSON: ${e.message}` : 'missing'); return null; } };

  const person = j('profile/person.json');
  if (person) {
    if (!person.name) p('profile/person.json', 'name is empty');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(person.application_email || person.email || '')) p('profile/person.json', 'application_email (or email) is not an email address');
  }
  const ownPrefs = j('profile/preferences.json');
  const prefs = ownPrefs ? deepMerge(readJsonFile(join(TEMPLATES_DIR, 'profile', 'preferences.json'), {}), ownPrefs) : null;
  if (prefs) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: prefs.schedule?.tz }); } catch { p('profile/preferences.json', `schedule.tz "${prefs.schedule?.tz}" is not an IANA time zone`); }
    for (const k of ['tick_start', 'tick_end', 'ask_start', 'ask_end']) if (!/^\d{2}:\d{2}$/.test(prefs.schedule?.[k] || '')) p('profile/preferences.json', `schedule.${k} must be HH:MM`);
    if (!['bikeshed', 'auto'].includes(prefs.tailoring?.review)) p('profile/preferences.json', 'tailoring.review must be bikeshed or auto');
    if (!['per-job', 'archetype'].includes(prefs.tailoring?.cv)) p('profile/preferences.json', 'tailoring.cv must be per-job or archetype');
    if (!['per-job', ...LETTER_APPROACHES].includes(prefs.tailoring?.letter || 'per-job')) p('profile/preferences.json', 'tailoring.letter must be per-job, A, B, C or D');
    if (!['letter', 'a4'].includes(prefs.cv?.paper || 'letter')) p('profile/preferences.json', 'cv.paper must be letter or a4');
    for (const re of prefs.location?.onsite_metros || []) if (!compiles(re)) p('profile/preferences.json', `location.onsite_metros: bad regex ${re}`);
  }
  const ans = j('profile/answers.json');
  if (ans && !ans.profile?.email) p('profile/answers.json', 'profile.email is empty');

  const bankPath = join(home, 'collateral', 'claim-bank.md');
  const bank = existsSync(bankPath) ? readFileSync(bankPath, 'utf8') : '';
  if (!bank) p('collateral/claim-bank.md', 'missing');
  // Only usable claims count (cv.mjs claimStatuses): a pending or retired row is named as such.
  const statuses = claimStatuses(bank);
  const claimIds = new Set([...statuses].filter(([, v]) => v.usable).map(([id]) => id));
  const master = j('collateral/cv/master.json');
  if (master) {
    if (!Object.keys(master.roles || {}).length) p('collateral/cv/master.json', 'no roles');
    const cite = (where, claims) => { for (const c of claims || []) if (!claimIds.has(c)) p('collateral/cv/master.json', explainClaims([`${where} cites unknown claim ${c}`], statuses)[0]); };
    for (const [id, b] of Object.entries(master.bullets || {})) cite(`bullet ${id}`, b.claims);
    for (const [id, r] of Object.entries(master.roles || {})) cite(`role ${id}`, r.claims);
  }
  const vdir = join(home, 'collateral', 'cv', 'variants');
  if (existsSync(vdir) && master) {
    for (const f of readdirSync(vdir).filter((x) => x.endsWith('.json'))) {
      const v = j(join('collateral', 'cv', 'variants', f));
      for (const e of v?.experience || []) {
        if (!master.roles?.[e.role]) p(`collateral/cv/variants/${f}`, `unknown role ${e.role}`);
        for (const it of e.items || []) if (typeof it === 'string' && !master.bullets?.[it]) p(`collateral/cv/variants/${f}`, `unknown bullet ${it}`);
      }
    }
  }
  const nc = j('collateral/cv/never-claim.json');
  for (const pat of nc?.patterns || []) if (!compiles(pat.re)) p('collateral/cv/never-claim.json', `bad regex ${pat.id}`);
  const pre = j('config/prefilter.json');
  for (const [k, v] of Object.entries(pre || {})) if (Array.isArray(v)) for (const re of v) if (typeof re === 'string' && !compiles(re)) p('config/prefilter.json', `${k}: bad regex ${re}`);
  for (const f of ['searches.json', 'dice-searches.json']) {
    const s = j(join('config', f));
    if (s && !Array.isArray(s.queries)) p(`config/${f}`, 'queries must be a list');
  }
  const apply = j('config/apply.json');
  for (const [k, v] of Object.entries(apply?.verified || {})) if (typeof v !== 'boolean') p('config/apply.json', `verified.${k} must be true or false`);
  if (apply?.accounts?.create === true) p('config/apply.json', 'accounts.create: automated ATS account creation is retired (the runner never creates an account or types a password); remove the accounts block');
  const limits = j('config/limits.json');
  for (const [plat, acts] of Object.entries(limits || {})) {
    if (plat.startsWith('_')) continue;
    for (const [a, v] of Object.entries(acts || {})) if (!(Number.isInteger(v?.max) && v.max >= 0)) p('config/limits.json', `${plat}.${a}.max must be a whole number`);
  }
  const fit = existsSync(join(home, 'fit-profile.md')) ? readFileSync(join(home, 'fit-profile.md'), 'utf8') : '';
  if (!fit) p('fit-profile.md', 'missing');
  return problems;
}

// ---------- ingest ----------
async function extractText(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.txt' || ext === '.md') return readFileSync(file, 'utf8');
  if (ext === '.docx') { const { docxToText } = await import('./lib/docx-text.mjs'); return docxToText(file); }
  if (ext === '.pdf') {
    const pdf = await import('./lib/pdf.mjs');
    const pages = await pdf.pageTexts(file);
    return pages.map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n\n');
  }
  throw new Error(`unsupported file type ${ext}: use PDF, DOCX, TXT or MD`);
}

// ---------- CLI ----------
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : null; };
  const flags = (name) => rest.flatMap((a, i) => (rest[i - 1] === `--${name}` ? [a] : []));

  if (cmd === 'init') {
    const r = initWorkspace();
    const o = loadOnb();
    o.phases.init = o.phases.init || now();
    saveOnb(o);
    logAction({ actor: 'agent', action: 'onboard.init', detail: `${r.created.length} files created, ${r.kept.length} kept` });
    out({ success: true, workspace: display(HOME), created: r.created.length, kept: r.kept.length, next: nextPhase(o.phases) });
  } else if (cmd === 'status') {
    const o = loadOnb();
    out({ success: true, workspace: display(HOME), exists: existsSync(PROFILE_DIR), phases: o.phases, next: nextPhase(o.phases) });
  } else if (cmd === 'mark') {
    const phase = flag('phase');
    if (!PHASES.includes(phase)) { out({ success: false, error: `unknown phase; one of ${PHASES.join(', ')}` }); process.exit(2); }
    const o = loadOnb();
    o.phases[phase] = now();
    saveOnb(o);
    logAction({ actor: 'agent', action: 'onboard.phase', detail: phase });
    out({ success: true, phase, next: nextPhase(o.phases) });
  } else if (cmd === 'ingest') {
    const files = flags('file').map(resolveArgPath);
    if (!files.length) { out({ success: false, error: 'usage: ingest --file <path> [--file <path> ...]' }); process.exit(2); }
    mkdirSync(SOURCES_DIR, { recursive: true });
    const done = [];
    for (const f of files) {
      if (!existsSync(f) || !statSync(f).isFile()) { out({ success: false, error: `not a file: ${f}` }); process.exit(1); }
      const name = basename(f);
      const dst = join(SOURCES_DIR, name);
      if (resolve(f) !== resolve(dst)) copyFileSync(f, dst);
      const text = await extractText(dst);
      writeFileSync(join(SOURCES_DIR, `${name}.txt`), `${text}\n`);
      done.push({ source: `sources/${name}`, text: `sources/${name}.txt`, chars: text.length });
    }
    logAction({ actor: 'agent', action: 'onboard.ingest', detail: `${done.length} source document(s)` });
    out({ success: true, ingested: done });
  } else if (cmd === 'validate') {
    const problems = validateWorkspace();
    out({ success: problems.length === 0, problems });
    process.exit(problems.length ? 1 : 0);
  } else if (cmd === 'git-init') {
    if (existsSync(join(HOME, '.git'))) { out({ success: true, note: 'the workspace is already a git repository' }); return; }
    execFileSync('git', ['init', '-q'], { cwd: HOME });
    out({ success: true, note: 'workspace is now a private git repository; add a private remote yourself if you want an off-machine backup' });
  } else if (cmd === 'mail-guard') {
    const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
    const usage = 'usage: mail-guard --connector gmail [--tools <tool,...>] | mail-guard --deny <tool,...>';
    let rules;
    let report = {};
    if (flag('connector')) {
      if (!CONNECTORS[flag('connector')]) { out({ success: false, error: `unknown connector "${flag('connector')}"; ${usage}` }); process.exit(2); }
      try { report = guardRules({ connector: flag('connector'), server: flag('server') || undefined, tools: list(flag('tools')) }); } catch (e) { out({ success: false, error: e.message }); process.exit(1); }
      rules = report.deny;
      report = { connector: flag('connector'), kept: report.kept, unknown: report.unknown };
    } else rules = list(flag('deny'));
    if (!rules.length) { out({ success: false, error: usage }); process.exit(2); }
    const cfg = mergeDeny(existsSync(CLAUDE_LOCAL_SETTINGS) ? JSON.parse(readFileSync(CLAUDE_LOCAL_SETTINGS, 'utf8')) : {}, rules);
    mkdirSync(dirname(CLAUDE_LOCAL_SETTINGS), { recursive: true });
    writeFileSync(CLAUDE_LOCAL_SETTINGS, `${JSON.stringify(cfg, null, 2)}\n`);
    out({ success: true, ...report, denied: cfg.permissions.deny.length, file: relative(CODE_ROOT, CLAUDE_LOCAL_SETTINGS) || CLAUDE_LOCAL_SETTINGS });
  } else {
    console.log('usage: npm run onboard -- init | status | mark --phase <p> | ingest --file <f> | validate | git-init | mail-guard --connector gmail | mail-guard --deny <tools>');
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => { out({ success: false, error: e.message }); process.exit(1); });

