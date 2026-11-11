#!/usr/bin/env node
// npm run check:pii: fails when a file the repo would commit contains the active user's personal
// data. The terms come from the workspace itself (profile/person.json, profile/answers.json, the
// employers in collateral/cv/master.json, and one extra term per line in profile/pii-extra.txt),
// so the check protects whoever is using this install without shipping anyone's data.
// The synthetic test persona (a JOBBA_HOME inside tests/, or any workspace holding a .synthetic
// marker, such as the test runner's temporary copy) is never a source of terms.
//
//   node scripts/check-pii.mjs [--staged] [--json]
// Exit 0 clean (or no workspace), 1 hits found.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_ROOT, COLLATERAL_DIR, HOME, PROFILE_DIR } from './lib/paths.mjs';

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.zip', '.gz', '.docx']);
const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function termsFrom({ person = {}, answers = {}, master = {}, extra = [] }) {
  const t = new Set();
  const add = (v, min = 4) => { const s = String(v ?? '').trim(); if (s.length >= min) t.add(s); };
  add(person.name); add(person.display_name); add(person.email); add(person.application_email); add(person.phone, 7);
  add(person.links?.linkedin?.replace(/^https?:\/\/(www\.)?/, '')); add(person.links?.website?.replace(/^https?:\/\//, ''));
  const p = answers.profile || {};
  for (const k of ['full_name', 'last_name', 'email', 'phone', 'street_address', 'address_full', 'linkedin', 'website']) add(p[k], k === 'phone' ? 7 : 4);
  add(answers.facts?.contracting_entity);
  for (const r of Object.values(master.roles || {})) add(r.company);
  for (const e of extra) add(e, 3);
  // A phone number also matches without punctuation.
  for (const v of [person.phone, p.phone]) { const d = String(v || '').replace(/\D/g, ''); if (d.length >= 7) t.add(d.slice(-7)); }
  return [...t];
}

export function scan(files, terms, readFile) {
  const hits = [];
  const lower = terms.map((x) => x.toLowerCase());
  for (const file of files) {
    const text = readFile(file);
    if (text == null) continue;
    const digits = text.replace(/\D/g, '');
    text.split('\n').forEach((line, i) => {
      const l = line.toLowerCase();
      lower.forEach((term, k) => { if (!/^\d+$/.test(term) && l.includes(term)) hits.push({ file, line: i + 1, term: terms[k] }); });
    });
    for (const term of lower) if (/^\d{7,}$/.test(term) && digits.includes(term)) hits.push({ file, line: 0, term: `${term.slice(0, 3)}… (digits)` });
  }
  return hits;
}

function main() {
  const json = process.argv.includes('--json');
  const synthetic = !relative(join(CODE_ROOT, 'tests'), HOME).startsWith('..') || existsSync(join(HOME, '.synthetic'));
  if (synthetic || !existsSync(join(PROFILE_DIR, 'person.json'))) {
    const msg = { ok: true, skipped: synthetic ? 'synthetic test workspace' : 'no workspace yet' };
    console.log(json ? JSON.stringify(msg) : `check:pii: nothing to check (${msg.skipped})`);
    return;
  }
  const extraPath = join(PROFILE_DIR, 'pii-extra.txt');
  const terms = termsFrom({
    person: read(join(PROFILE_DIR, 'person.json')) || {},
    answers: read(join(PROFILE_DIR, 'answers.json')) || {},
    master: read(join(COLLATERAL_DIR, 'cv', 'master.json')) || {},
    extra: existsSync(extraPath) ? readFileSync(extraPath, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : [],
  });
  const args = process.argv.includes('--staged') ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files', '-co', '--exclude-standard'];
  const files = execFileSync('git', args, { cwd: CODE_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((f) => !BINARY.has(extname(f).toLowerCase()) && !f.startsWith('workspace/'));
  const hits = scan(files, terms, (f) => {
    try { const b = readFileSync(join(CODE_ROOT, f)); return b.includes(0) ? null : b.toString('utf8'); } catch { return null; }
  });
  if (json) console.log(JSON.stringify({ ok: hits.length === 0, terms: terms.length, files: files.length, hits: hits.map((h) => ({ ...h, term: `${h.term.slice(0, 2)}…` })) }));
  else if (hits.length) {
    for (const h of hits) console.log(`${h.file}:${h.line}  personal value from the workspace (${h.term.slice(0, 2)}…)`);
    console.log(`\ncheck:pii: ${hits.length} hit(s). Personal data belongs in workspace/ only.`);
  } else console.log(`check:pii: ok (${terms.length} terms, ${files.length} files)`);
  process.exit(hits.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
