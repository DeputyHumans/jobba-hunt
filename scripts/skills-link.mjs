#!/usr/bin/env node
// npm run skills:link: makes every skill in .agents/skills/ (the canonical location) visible to Claude
// Code as .claude/skills/<name> -> ../../.agents/skills/<name>. Relative links only, so the repo works
// at any path on any host. Idempotent: correct links are kept, wrong ones replaced, links to skills
// that no longer exist removed. A real directory in .claude/skills is never touched.
//
//   node scripts/skills-link.mjs [--check]   (--check: report only, exit 1 when anything is off)

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_ROOT } from './lib/paths.mjs';

const SRC = join(CODE_ROOT, '.agents', 'skills');
const DST = join(CODE_ROOT, '.claude', 'skills');
const check = process.argv.includes('--check');

export function planLinks(skills, existing) {
  const want = new Map(skills.map((s) => [s, join('..', '..', '.agents', 'skills', s)]));
  const actions = [];
  for (const [name, target] of want) {
    const cur = existing.get(name);
    if (!cur) actions.push({ op: 'create', name, target });
    else if (cur.kind === 'link' && cur.target !== target) actions.push({ op: 'replace', name, target });
    else if (cur.kind !== 'link') actions.push({ op: 'skip-real-dir', name });
  }
  for (const [name, cur] of existing) if (!want.has(name) && cur.kind === 'link') actions.push({ op: 'remove', name });
  return actions;
}

function main() {
  const skills = existsSync(SRC) ? readdirSync(SRC).filter((d) => existsSync(join(SRC, d, 'SKILL.md'))).sort() : [];
  mkdirSync(DST, { recursive: true });
  const existing = new Map();
  for (const name of readdirSync(DST)) {
    const p = join(DST, name);
    const st = lstatSync(p);
    existing.set(name, st.isSymbolicLink() ? { kind: 'link', target: readlinkSync(p) } : { kind: 'dir' });
  }
  const actions = planLinks(skills, existing).filter((a) => a.op !== 'skip-real-dir');
  if (check) {
    console.log(JSON.stringify({ ok: actions.length === 0, skills: skills.length, pending: actions }));
    process.exit(actions.length ? 1 : 0);
  }
  for (const a of actions) {
    const p = join(DST, a.name);
    if (a.op === 'remove' || a.op === 'replace') rmSync(p, { force: true });
    if (a.op === 'create' || a.op === 'replace') symlinkSync(a.target, p, 'dir');
  }
  console.log(JSON.stringify({ ok: true, skills: skills.length, changed: actions.length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
