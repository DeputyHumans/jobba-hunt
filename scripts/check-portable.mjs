#!/usr/bin/env node
// npm run check:portable: fails when any file in the repo holds a path that only resolves on one
// host, or reaches outside the repo. The project must run unchanged from any folder on any machine.
//
// Rules (per text file tracked or not ignored by git; binaries skipped):
//   home-path      /Users/<name>, /home/<name>, C:\Users\<name>
//   tilde-path     ~/... (allowed only in vendored skill install notes, see ALLOW)
//   homedir        homedir() / os.homedir outside scripts/lib/env.mjs and scripts/lib/paths.mjs
//   dotdot-escape  a "../" path (import specifier, string literal or markdown link) that resolves
//                  outside the repo from its own file
//   bare-dotdot    a '..' segment joined onto a root (join(ROOT, '..'), resolve(__dirname, '..')) in a
//                  script outside the path layer: the path layer is the only place that finds roots
//   symlink        a symlink whose target leaves the repo or does not exist
//
//   node scripts/check-portable.mjs [--staged] [--json]

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_ROOT } from './lib/paths.mjs';

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.zip', '.gz', '.docx']);
const PATH_LAYER = new Set(['scripts/lib/env.mjs', 'scripts/lib/paths.mjs']);
// Generic, host-independent mentions inside vendored skill docs (alternative user-scope installs).
const ALLOW = [
  { file: /^\.agents\/skills\/[^/]+\/(INSTALL|SKILL)\.md$/, rule: 'tilde-path', text: /~\/\.(claude|codex|agents|cursor|config|gemini)\b/ },
  { file: /^scripts\/check-portable\.mjs$/, rule: '*' },
  { file: /^tests\/check-portable\.test\.mjs$/, rule: '*' },
];

const inside = (p) => { const r = relative(CODE_ROOT, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

export function scanText(file, text) {
  const hits = [];
  const lines = text.split('\n');
  const isScript = /\.(mjs|cjs|js)$/.test(file) && (file.startsWith('scripts/') || file.startsWith('tests/'));
  lines.forEach((line, i) => {
    const add = (rule, t) => hits.push({ file, line: i + 1, rule, text: t.trim().slice(0, 160) });
    for (const m of line.matchAll(/(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[a-z_][a-z0-9._-]*\/|[A-Za-z]:\\Users\\[^\\\s]+)/g)) add('home-path', m[0]);
    for (const m of line.matchAll(/(?<![\w.$])~\/[\w.-]*/g)) add('tilde-path', m[0]);
    if (!PATH_LAYER.has(file) && /\bhomedir\s*\(|os\.homedir\b/.test(line)) add('homedir', line);
    for (const m of line.matchAll(/(?:['"`(]|\]\()((?:\.\.\/)+[^'"`)\s]*)/g)) {
      const target = resolve(dirname(join(CODE_ROOT, file)), m[1]);
      if (!inside(target)) add('dotdot-escape', m[1]);
    }
    if (isScript && !PATH_LAYER.has(file) && !/^\s*\/\//.test(line) && /\b(join|resolve)\(\s*(ROOT|REPO|CODE_ROOT|PROJECT_ROOT|HOME|DATA_DIR|__dirname|dirname\(fileURLToPath\(import\.meta\.url\)\))\s*,(?:[^)]*,)?\s*(['"])\.\.\3/.test(line)) add('bare-dotdot', line);
  });
  return hits.filter((h) => !ALLOW.some((a) => a.file.test(h.file) && (a.rule === '*' || (a.rule === h.rule && (!a.text || a.text.test(h.text))))));
}

function listFiles(staged) {
  const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files', '-co', '--exclude-standard'];
  return execFileSync('git', args, { cwd: CODE_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

export function checkFiles(files) {
  const hits = [];
  for (const file of files) {
    const abs = join(CODE_ROOT, file);
    if (!existsSync(abs) && !lstatSafe(abs)) continue;
    const st = lstatSafe(abs);
    if (st?.isSymbolicLink()) {
      const target = resolve(dirname(abs), readlinkSync(abs));
      let real = null;
      try { real = realpathSync(abs); } catch { /* dangling */ }
      if (!inside(target) || !real || !inside(real)) hits.push({ file, line: 0, rule: 'symlink', text: readlinkSync(abs) });
      continue;
    }
    if (!st?.isFile() || BINARY.has(extname(file).toLowerCase())) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue;
    hits.push(...scanText(file, buf.toString('utf8')));
  }
  return hits;
}

function lstatSafe(p) { try { return lstatSync(p); } catch { return null; } }

function main() {
  const staged = process.argv.includes('--staged');
  const files = listFiles(staged);
  const hits = checkFiles(files);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: hits.length === 0, files: files.length, hits }));
  else if (hits.length) {
    for (const h of hits) console.log(`${h.file}:${h.line}  ${h.rule}  ${h.text}`);
    console.log(`\ncheck:portable: ${hits.length} host-specific or escaping path(s) in ${files.length} files. Make them repo- or workspace-relative.`);
  } else console.log(`check:portable: ok (${files.length} files)`);
  process.exit(hits.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
