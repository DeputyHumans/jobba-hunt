#!/usr/bin/env node
// npm run check:pii: fails when a file the repo would commit contains the active user's personal
// data. The terms come from the workspace itself (profile/person.json, profile/answers.json, the
// employers in collateral/cv/master.json, and one extra term per line in profile/pii-extra.txt),
// so the check protects whoever is using this install without shipping anyone's data.
// profile/pii-allow.txt (one per line) names terms the operator has made public on purpose, such as
// the organization that publishes the repository: each drops only the term equal to it, ignoring
// case, never a wider term that contains it (an email address at that organization stays a term).
// The synthetic test persona (a JOBBA_HOME inside tests/, or any workspace holding a .synthetic
// marker, such as the test runner's temporary copy) is never a source of terms.
//
// --history scans every blob ever committed on any ref (deleted files included) and every commit
// message instead of today's files: the gate before a repository is made public.
//
//   node scripts/check-pii.mjs [--staged | --history] [--json]
// Exit 0 clean (or no workspace), 1 hits found.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_ROOT, COLLATERAL_DIR, HOME, PROFILE_DIR } from './lib/paths.mjs';

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.zip', '.gz', '.docx']);
const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function termsFrom({ person = {}, answers = {}, master = {}, extra = [], allow = [] }) {
  const t = new Set();
  // A template placeholder ("<employer>") in a workspace not yet onboarded is not a term.
  const add = (v, min = 4) => { const s = String(v ?? '').trim(); if (s.length >= min && !/^<[^<>]*>$/.test(s)) t.add(s); };
  add(person.name); add(person.display_name); add(person.email); add(person.application_email); add(person.phone, 7);
  add(person.links?.linkedin?.replace(/^https?:\/\/(www\.)?/, '')); add(person.links?.website?.replace(/^https?:\/\//, ''));
  const p = answers.profile || {};
  for (const k of ['full_name', 'last_name', 'email', 'phone', 'street_address', 'address_full', 'linkedin', 'website']) add(p[k], k === 'phone' ? 7 : 4);
  add(answers.facts?.contracting_entity);
  for (const r of Object.values(master.roles || {})) { add(r.company); for (const c of r.clients || []) add(c.name); }
  for (const e of Object.values(master.employers || {})) add(e.name);
  for (const name of Object.keys(master.links || {})) add(name);
  for (const e of extra) add(e, 3);
  // A phone number also matches without punctuation.
  for (const v of [person.phone, p.phone]) { const d = String(v || '').replace(/\D/g, ''); if (d.length >= 7) t.add(d.slice(-7)); }
  const allowed = new Set(allow.map((a) => String(a).trim().toLowerCase()).filter(Boolean));
  return [...t].filter((x) => !allowed.has(x.toLowerCase()));
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

// Every blob reachable from any ref, with the first path it was seen at, plus every commit message.
export function historyEntries(repoDir) {
  const git = (args, input) => execFileSync('git', args, { cwd: repoDir, input, maxBuffer: 1 << 30 });
  const paths = new Map();
  for (const line of git(['rev-list', '--all', '--objects']).toString('utf8').split('\n')) {
    const sp = line.indexOf(' ');
    if (sp > 0 && !paths.has(line.slice(0, sp))) paths.set(line.slice(0, sp), line.slice(sp + 1));
  }
  const entries = [];
  const wanted = [...paths].filter(([, path]) => path && !BINARY.has(extname(path).toLowerCase())).map(([sha]) => sha);
  if (wanted.length) {
    const out = git(['cat-file', '--batch'], `${wanted.join('\n')}\n`);
    for (let i = 0; i < out.length;) {
      const nl = out.indexOf(10, i);
      const [sha, type, size] = out.toString('utf8', i, nl).split(' ');
      if (type === 'missing' || size === undefined) { i = nl + 1; continue; }
      const start = nl + 1, end = start + Number(size);
      const body = out.subarray(start, end);
      i = end + 1;
      if (type === 'blob' && !body.includes(0)) entries.push({ kind: 'blob', file: paths.get(sha), text: body.toString('utf8') });
    }
  }
  const log = git(['log', '--all', '--format=%H%x1f%B%x1e']).toString('utf8');
  for (const rec of log.split('\x1e')) {
    const sep = rec.indexOf('\x1f');
    if (sep < 0) continue;
    entries.push({ kind: 'message', file: `commit ${rec.slice(0, sep).trim().slice(0, 7)}`, text: rec.slice(sep + 1) });
  }
  return entries;
}

export function scanHistory(repoDir, terms, entries = historyEntries(repoDir)) {
  const hits = scan(entries.map((_, k) => k), terms, (k) => entries[k].text);
  const seen = new Set();
  return hits.map((h) => ({ kind: entries[h.file].kind, file: entries[h.file].file, line: h.line, term: h.term }))
    .filter((h) => { const key = `${h.kind}|${h.file}|${h.line}|${h.term}`; return !seen.has(key) && seen.add(key); });
}

function main() {
  const json = process.argv.includes('--json');
  const synthetic = !relative(join(CODE_ROOT, 'tests'), HOME).startsWith('..') || existsSync(join(HOME, '.synthetic'));
  if (synthetic || !existsSync(join(PROFILE_DIR, 'person.json'))) {
    const msg = { ok: true, skipped: synthetic ? 'synthetic test workspace' : 'no workspace yet' };
    console.log(json ? JSON.stringify(msg) : `check:pii: nothing to check (${msg.skipped})`);
    return;
  }
  const lines = (name) => { const f = join(PROFILE_DIR, name); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#')) : []; };
  const terms = termsFrom({
    person: read(join(PROFILE_DIR, 'person.json')) || {},
    answers: read(join(PROFILE_DIR, 'answers.json')) || {},
    master: read(join(COLLATERAL_DIR, 'cv', 'master.json')) || {},
    extra: lines('pii-extra.txt'),
    allow: lines('pii-allow.txt'),
  });
  if (process.argv.includes('--history')) {
    const entries = historyEntries(CODE_ROOT);
    const hits = scanHistory(CODE_ROOT, terms, entries);
    const blobs = entries.filter((e) => e.kind === 'blob').length, commits = entries.length - blobs;
    if (json) console.log(JSON.stringify({ ok: hits.length === 0, history: true, terms: terms.length, blobs, commits, hits: hits.map((h) => ({ ...h, term: `${h.term.slice(0, 2)}…` })) }));
    else if (hits.length) {
      for (const h of hits) console.log(`${h.file}:${h.line}  personal value from the workspace in history (${h.term.slice(0, 2)}…)`);
      console.log(`\ncheck:pii --history: ${hits.length} hit(s). Rewrite the history before publishing.`);
    } else console.log(`check:pii --history: ok (${terms.length} terms, ${blobs} blobs, ${commits} commits)`);
    process.exit(hits.length ? 1 : 0);
  }
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
