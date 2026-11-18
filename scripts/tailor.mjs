#!/usr/bin/env node
// npm run tailor -- <command> --job <id>: the scripted half of per-job tailoring (/hunt-tailor,
// docs/tailoring.md). The agent drafts; these commands freeze the yardstick, measure each draft
// against it, build the documents with every CV check, and route them to review.
//
//   prepare   needs a fetched posting (the tick's detail view, or --jd <file> --company <c> --title <t>
//             for a role that arrived by email or from a recruiter). Refused once terms are frozen. Writes data/applications/<id>/jd.txt and
//             jd.terms.suggested.txt (vocabulary the claim bank and CVs already know that the posting
//             uses, plus the posting's requirement lines as comments) and starts tailor.json.
//   freeze    locks jd.terms.txt (the agent writes it from the suggestions, 5 to 40 terms, one per
//             line, "|" for alternatives) by hash, and measures the baseline: the best archetype CV
//             against those terms. The terms never change after this (a changed file is refused).
//   measure   scores the draft data/applications/<id>/cv/<slug>.json against the frozen terms and
//             records the round. "continue" is true while a round improved and rounds remain
//             (preferences.tailoring.max_rounds, default 3).
//   build     the gates: frozen terms unchanged, last round at or above the baseline, no target
//             company name in the CV. Then builds the CV (all CV checks) and, when
//             cover-letter.json exists, the letter (build-cover checks).
//   fallback  when no draft reaches the baseline: the best archetype CV (already built) plus the
//             job's letter become the set to review and send, and the choice is logged.
//   review    preferences.tailoring.review "bikeshed": publishes the CV and the letter, each as its
//             own private document in the reviews folder (passage comments stay anchored to the real
//             rendering), records them for the comment watch, and marks the role docs_review
//             "pending". A rebuilt set updates the same documents and needs a fresh approval. "auto": marks the documents
//             approved under the standing decision, except a letter of approach B or C, which is always
//             published for review. Publisher "local": review happens in the session.
//   status    the job's tailoring record.
// Exit 0 ok, 1 refused or a check failed, 2 usage, 3 bikeshed refused the update (open in the editor,
// pending suggestion or a newer base), 4 bikeshed signed out.

import './lib/env.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_ROOT, CV_OUT, CV_SRC, DATA_DIR, display, resolveArgPath } from './lib/paths.mjs';
import { loadConfig, readJsonFile, requireWorkspace, writeJsonAtomic } from './lib/config.mjs';
import { cvFileBase, preferences } from './lib/profile.mjs';
import { loadState, saveStateAtomic, STATE_PATH } from './lib/state.mjs';
import { logAction } from './lib/actions-log.mjs';
import { letterNeedsReview } from './lib/cover.mjs';
import { bikeshedRun, isAuthError, parseJsonOut } from './lib/adapters/bikeshed.mjs';

const out = (o) => console.log(JSON.stringify(o));
const stop = (code, o) => { out({ success: code === 0, ...o }); process.exit(code); };
const now = () => new Date().toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export const parseTerms = (text) => String(text).split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Suggested terms: every keyword or skill term the CVs already carry that the posting mentions,
// then the posting's own requirement-looking lines as comments for the agent to mine.
export function suggestTerms(jd, vocabulary) {
  const low = jd.toLowerCase();
  const seen = new Set();
  const hits = [];
  for (const t of vocabulary) {
    const term = String(t).trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    const alts = term.split('|').map((a) => a.trim().toLowerCase()).filter(Boolean);
    if (alts.some((a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(low))) hits.push(term);
  }
  const asks = jd.split('\n').map((l) => l.trim()).filter((l) => /^([-*•·]|\d+[.)])\s+/.test(l) || /\b(required|must|experience (with|in)|proficien|you (have|bring))\b/i.test(l)).slice(0, 40);
  return { hits, asks };
}

// The CV must never name the employer it is sent to in the text the draft writes itself: slug, share,
// title (the page title), description (the page's meta description), target_title, headline, summary,
// highlights, skills, the practice section's heading and title, and the contact location. Experience
// and practice entries point at master.json roles and bullets by key, so an operator who once worked
// for that employer keeps the role in their history.
export function companyLeak(cvJson, company) {
  const own = ['slug', 'share', 'title', 'description', 'target_title', 'headline', 'summary', 'highlights', 'skills'].map((k) => cvJson?.[k])
    .concat(cvJson?.practice?.heading, cvJson?.practice?.title, cvJson?.contact?.location);
  const c = String(company || '').trim();
  if (c.length < 3) return false;
  const core = c.replace(/,?\s+(inc|llc|ltd|corp|corporation|co|gmbh|plc)\.?$/i, '').trim();
  const re = new RegExp(`(^|[^a-z0-9])${core.toLowerCase().replace(/[.*+?^${}()[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  return re.test(JSON.stringify(own).toLowerCase());
}

// A (re)built set: status built, and any earlier approval of a role outside the job state
// (recorded in tailor.json by approve-docs) is dropped, so a rebuilt set needs a fresh approval.
export function builtRecord(rec, docs) {
  const { docs_approved_at, docs_note, ...rest } = rec;
  return { ...rest, docs, status: 'built' };
}

// Approved: the job state's docs_approved_at, or, for a role outside the job state, tailor.json's own.
export const docsApproved = (rec, job) => (job ? !!job.application?.docs_approved_at : rec?.status === 'approved' && !!rec?.docs_approved_at);

export function shouldContinue(rounds, maxRounds) {
  if (rounds.length >= maxRounds) return false;
  if (rounds.length < 2) return true;
  return rounds.at(-1).pct > rounds.at(-2).pct;
}

const runNode = (script, args) => {
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', script), ...args], { cwd: CODE_ROOT, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const last = String(r.stdout || '').trim().split('\n').pop();
  let json = null;
  try { json = JSON.parse(last); } catch { /* not JSON */ }
  return { code: r.status ?? 1, json, stderr: r.stderr || '' };
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (f) => { const i = rest.indexOf(`--${f}`); return i >= 0 ? rest[i + 1] : undefined; };
  const id = String(opt('job') || '');
  if (!cmd || !id) stop(2, { error: 'usage: npm run tailor -- prepare|freeze|measure|build|fallback|review|status --job <id>' });
  try { requireWorkspace(); } catch (err) { stop(1, { error: err.message }); }

  const dir = join(DATA_DIR, 'applications', id);
  const cvDir = join(dir, 'cv');
  const recPath = join(dir, 'tailor.json');
  const jdPath = join(dir, 'jd.txt');
  const termsPath = join(dir, 'jd.terms.txt');
  const state = loadState(STATE_PATH);
  const job = state.jobs?.[id];
  let rec = readJsonFile(recPath, null);
  const save = (r) => writeJsonAtomic(recPath, r);
  const maxRounds = Number(preferences().tailoring?.max_rounds) || 3;

  if (cmd === 'prepare') {
    if (rec?.terms_hash) stop(1, { error: `job ${id} already has frozen terms (${rec.terms_frozen_at}): the yardstick is fixed; continue with measure or build` });
    // The posting: the tick's detail view, or (a role that reached the operator by email or a
    // recruiter) a JD file with --jd, plus --company and --title. Never a posting nobody fetched.
    const jdFile = opt('jd') ? resolveArgPath(opt('jd')) : null;
    let posting = null;
    if (jdFile) {
      if (!existsSync(jdFile)) stop(1, { error: `no JD file at ${opt('jd')}` });
      if (!opt('company') || !opt('title')) stop(2, { error: 'a JD file needs --company and --title' });
      posting = { company: opt('company'), title: opt('title'), text: readFileSync(jdFile, 'utf8'), fetched_at: new Date(statSync(jdFile).mtimeMs).toISOString(), source: `file:${display(jdFile)}` };
    } else if (job?.detail?.description_text && job.detail.fetched_at) {
      posting = { company: job.company || job.detail.company || '', title: job.title || job.detail.title || '', text: job.detail.description_text, fetched_at: job.detail.fetched_at, source: 'tick' };
    } else stop(1, { error: `job ${id} has no fetched posting: run prepare on a role the tick viewed, or pass --jd <file> --company <c> --title <t> (never draft against a posting that was not fetched)` });
    mkdirSync(cvDir, { recursive: true });
    const jd = `${posting.title}\n${posting.text}`;
    writeFileSync(jdPath, `${jd}\n`);
    const vocab = [];
    const vdir = join(CV_SRC, 'variants');
    for (const f of existsSync(vdir) ? readdirSync(vdir).filter((x) => x.endsWith('.json')) : []) {
      const v = readJsonFile(join(vdir, f), {});
      vocab.push(...(v.target_keywords || []), ...(v.skills || []).flatMap((s) => s.terms || []));
    }
    const { hits, asks } = suggestTerms(jd, vocab);
    writeFileSync(join(dir, 'jd.terms.suggested.txt'), [
      `# Suggested must-have terms for job ${id}. Copy the real must-haves into jd.terms.txt (5 to 40 lines,`,
      '# one term per line, "|" for alternatives), then run: npm run tailor -- freeze --job <id>',
      '# Terms the CVs already know that the posting uses:',
      ...hits,
      '# Requirement lines from the posting (mine these for terms; quote them in the letter):',
      ...asks.map((a) => `# ${a}`),
    ].join('\n') + '\n');
    const r = { job_id: id, company: posting.company, title: posting.title, fetched_at: posting.fetched_at, posting_source: posting.source, created_at: rec?.created_at || now(), status: 'drafting', terms_hash: null, terms_frozen_at: null, baseline: null, rounds: [], docs: null };
    save(r);
    logAction({ actor: 'agent', action: 'tailor.prepared', job_id: id, detail: `${hits.length} suggested terms` });
    stop(0, { job_id: id, jd: display(jdPath), suggested: display(join(dir, 'jd.terms.suggested.txt')), terms_file: display(termsPath), cv_dir: display(cvDir), next: 'write jd.terms.txt, then freeze' });
  }

  if (!rec) stop(1, { error: `no tailoring record for ${id}: run prepare first` });
  const termsText = existsSync(termsPath) ? readFileSync(termsPath, 'utf8') : '';
  const terms = parseTerms(termsText);

  if (cmd === 'freeze') {
    if (rec.terms_hash && rec.terms_hash !== sha(termsText)) stop(1, { error: 'jd.terms.txt changed after it was frozen: the yardstick is fixed for this job' });
    if (terms.length < 5 || terms.length > 40) stop(1, { error: `jd.terms.txt holds ${terms.length} terms; it needs 5 to 40` });
    const m = runNode('build-cv.mjs', ['--match', display(jdPath), '--terms', display(termsPath)]);
    if (m.code !== 0 || !m.json?.ranked?.length) stop(1, { error: 'baseline measure failed', detail: m.stderr.slice(-400) });
    const best = m.json.ranked[0];
    Object.assign(rec, { terms_hash: sha(termsText), terms_frozen_at: rec.terms_frozen_at || now(), baseline: { slug: best.slug, pct: best.pct, missing: best.missing } });
    save(rec);
    logAction({ actor: 'agent', action: 'tailor.frozen', job_id: id, detail: `${terms.length} terms, baseline ${best.pct}% (${best.slug})` });
    stop(0, { job_id: id, terms: terms.length, baseline: rec.baseline, next: `draft ${display(cvDir)}/<slug>.json from master.json bullets and confirmed claims, then measure` });
  }

  if (!rec.terms_hash) stop(1, { error: 'terms not frozen yet: run freeze first' });
  if (rec.terms_hash !== sha(termsText)) stop(1, { error: 'jd.terms.txt changed after it was frozen: restore it; the yardstick is fixed for this job' });
  const drafts = existsSync(cvDir) ? readdirSync(cvDir).filter((f) => f.endsWith('.json')) : [];
  const slug = opt('slug') || (drafts.length === 1 ? drafts[0].replace(/\.json$/, '') : null);

  if (cmd === 'measure') {
    if (!slug) stop(1, { error: `expected one draft in ${display(cvDir)} (or pass --slug): found ${drafts.length}` });
    const m = runNode('build-cv.mjs', ['--match', display(jdPath), '--terms', display(termsPath), '--dir', display(cvDir), '--candidate', slug]);
    const mine = m.json?.ranked?.find((x) => x.slug === slug);
    if (m.code !== 0 || !mine) stop(1, { error: 'measure failed', detail: m.stderr.slice(-400) });
    rec.rounds.push({ at: now(), slug, pct: mine.pct, missing: mine.missing });
    rec.status = 'drafting';
    save(rec);
    const cont = shouldContinue(rec.rounds, maxRounds) && mine.missing.length > 0;
    logAction({ actor: 'agent', action: 'tailor.round', job_id: id, detail: `round ${rec.rounds.length}: ${mine.pct}% vs baseline ${rec.baseline.pct}%` });
    stop(0, { job_id: id, slug, round: rec.rounds.length, max_rounds: maxRounds, pct: mine.pct, baseline: rec.baseline.pct, missing: mine.missing, continue: cont, note: 'missing terms that no confirmed claim covers are gaps: list them in honest_gaps, never write them in' });
  }

  if (cmd === 'build') {
    if (!slug) stop(1, { error: `expected one draft in ${display(cvDir)} (or pass --slug)` });
    const last = rec.rounds.filter((r) => r.slug === slug).at(-1);
    if (!last) stop(1, { error: 'no measured round for this draft: run measure first' });
    if (last.pct < rec.baseline.pct) stop(1, { error: `the draft covers ${last.pct}%, below the best archetype CV (${rec.baseline.pct}%, ${rec.baseline.slug}): use that CV or revise the draft` });
    const cvJson = readJsonFile(join(cvDir, `${slug}.json`));
    if (companyLeak(cvJson, rec.company)) stop(1, { error: 'the CV names the target company: remove it (a CV never names the employer it is sent to)' });
    const b = runNode('build-cv.mjs', ['--dir', display(cvDir), '--variant', slug]);
    const cvReport = b.json?.report?.[0] || null;
    if (b.code !== 0) stop(1, { error: 'CV checks failed', report: b.json, detail: b.stderr.slice(-600) });
    const docs = { slug, cv: cvReport, built_at: now() };
    if (existsSync(join(dir, 'cover-letter.json'))) {
      const c = runNode('build-cover.mjs', ['--job', id]);
      if (c.code !== 0) stop(1, { error: 'cover letter checks failed', report: c.json, detail: c.stderr.slice(-600) });
      docs.letter = c.json;
    }
    rec = builtRecord(rec, docs);
    save(rec);
    {
      const s2 = loadState(STATE_PATH);
      const j2 = s2.jobs[id];
      if (j2?.application?.docs_approved_at) {
        j2.application = { ...j2.application, docs_approved_at: null, docs_note: null, docs_review: { status: 'pending', url: null, letter_url: null } };
        saveStateAtomic(STATE_PATH, s2);
      }
    }
    logAction({ actor: 'agent', action: 'tailor.built', job_id: id, detail: `${slug}: ${last.pct}% vs ${rec.baseline.pct}%${docs.letter ? ', letter built' : ''}` });
    stop(0, { job_id: id, slug, pct: last.pct, baseline: rec.baseline.pct, cv: cvReport, letter: docs.letter || null, next: 'review' });
  }

  if (cmd === 'review') {
    if (rec.status !== 'built' && rec.status !== 'review') stop(1, { error: 'build the documents first' });
    const mode = preferences().tailoring?.review || 'bikeshed';
    const tracker = loadConfig('tracker.json');
    // A role known only from a JD file has no job state; its record lives in tailor.json alone.
    const setApp = (fields) => {
      const s = loadState(STATE_PATH);
      const j = s.jobs[id];
      if (!j) return;
      j.application = { ...(j.application || {}), ...fields };
      saveStateAtomic(STATE_PATH, s);
    };
    // A plan (B) or questions (C) always wait for the operator, whatever the standing review mode.
    const letterSpec = readJsonFile(join(dir, 'cover-letter.json'), null);
    const reason = mode === 'auto' && letterNeedsReview(letterSpec) ? `letter approach ${letterSpec.approach} always waits for the operator's review` : null;
    if (mode === 'auto' && !reason) {
      setApp({ docs_review: 'auto', docs_approved_at: now(), docs_note: 'standing decision: tailored documents are sent without review (preferences.tailoring.review auto)' });
      rec.status = 'approved';
      save(rec);
      logAction({ actor: 'script', action: 'docs.auto-approved', job_id: id });
      stop(0, { job_id: id, review: 'auto', approved: true });
    }
    const letterHtml = rec.docs?.letter?.html || rec.docs?.letter?.pdf?.replace(/\.pdf$/, '.html');
    const files = [['cv', rec.docs?.cv?.html], ['letter', letterHtml]].filter(([, f]) => f);
    if ((tracker.publisher || 'bikeshed') === 'local') {
      setApp({ docs_review: { status: 'pending', url: null, letter_url: null }, docs_approved_at: null, docs_note: null });
      rec.status = 'review';
      save(rec);
      stop(0, { job_id: id, review: 'session', files: files.map(([k, f]) => ({ kind: k, html: f })), note: 'publisher local: show these files to the operator and record approve-docs on their word', ...(reason ? { reason } : {}) });
    }
    const folder = tracker.bikeshed?.reviews_folder_id || tracker.bikeshed?.folder_id;
    if (!folder) stop(1, { error: 'no bikeshed folder for reviews (config/tracker.json bikeshed.reviews_folder_id): /hunt-onboard access phase creates it' });
    const regPath = join(DATA_DIR, 'tracker', 'review-docs.json');
    const reg = readJsonFile(regPath, {});
    const entry = reg[id] || {};
    for (const [kind, f] of files) {
      const file = resolveArgPath(f);
      const title = `Review · ${rec.company} · ${rec.title} · ${kind === 'cv' ? 'CV' : 'cover letter'}`;
      const prev = entry[kind];
      const r = prev?.doc_id
        ? await bikeshedRun(['update', prev.doc_id, file, '--base', prev.version_id || '', '--json'])
        : await bikeshedRun(['publish', file, '--title', title, '--folder', folder, '--json']);
      if (r.code !== 0) {
        if (isAuthError(r)) stop(4, { error: 'bikeshed is signed out: npm run bikeshed -- login' });
        stop(3, { error: `bikeshed refused the ${kind} ${prev ? 'update' : 'publish'}`, detail: (r.stderr || r.stdout).slice(-300) });
      }
      const j = parseJsonOut(r.stdout) || {};
      entry[kind] = { doc_id: j.docId || prev?.doc_id, url: j.url || prev?.url, version_id: j.versionId || prev?.version_id };
    }
    entry.updated_at = now();
    reg[id] = entry;
    writeJsonAtomic(regPath, reg);
    // A new or rebuilt set needs a fresh approval: an earlier one covered other text.
    setApp({ docs_review: { status: 'pending', url: entry.cv?.url || null, letter_url: entry.letter?.url || null }, docs_approved_at: null, docs_note: null });
    rec.status = 'review';
    save(rec);
    logAction({ actor: 'agent', action: 'docs.review-published', job_id: id, detail: files.map(([k]) => k).join(' + ') });
    stop(0, { job_id: id, review: 'bikeshed', docs: entry, ...(reason ? { reason } : {}) });
  }

  if (cmd === 'fallback') {
    // No draft reached the baseline: send the best archetype CV (the one freeze measured) with the
    // job's letter. The archetype CV must already be built (npm run cv -- --variant <slug>).
    const base = rec.baseline?.slug;
    if (!base) stop(1, { error: 'no baseline: run freeze first' });
    const v = readJsonFile(join(CV_SRC, 'variants', `${base}.json`), null);
    if (!v?.share) stop(1, { error: `archetype variant ${base} not found` });
    const sharePdf = join(CV_OUT, 'share', `${cvFileBase(v.share)}.pdf`);
    if (!existsSync(sharePdf)) stop(1, { error: `the archetype CV is not built: npm run cv -- --variant ${base}` });
    const dated = existsSync(CV_OUT) ? readdirSync(CV_OUT).filter((d) => /^\d{8}$/.test(d)).sort().reverse() : [];
    const html = dated.map((d) => join(CV_OUT, d, `${cvFileBase(base)}.html`)).find((f) => existsSync(f)) || null;
    const docs = { slug: base, fallback: true, cv: { slug: base, share: v.share, share_pdf: display(sharePdf), html: html ? display(html) : null }, built_at: now() };
    if (existsSync(join(dir, 'cover-letter.json'))) {
      const c = runNode('build-cover.mjs', ['--job', id]);
      if (c.code !== 0) stop(1, { error: 'cover letter checks failed', report: c.json, detail: c.stderr.slice(-600) });
      docs.letter = c.json;
    }
    rec = builtRecord(rec, docs);
    save(rec);
    logAction({ actor: 'agent', action: 'tailor.fallback', job_id: id, detail: `archetype ${base} at ${rec.baseline.pct}%; no draft reached it` });
    stop(0, { job_id: id, fallback: base, pct: rec.baseline.pct, cv: docs.cv, letter: docs.letter || null, next: 'review' });
  }

  if (cmd === 'status') stop(0, { record: rec, approved: docsApproved(rec, state.jobs?.[id]) });
  stop(2, { error: `unknown command ${cmd}` });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => stop(1, { error: e.message }));
