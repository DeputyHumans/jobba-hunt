#!/usr/bin/env node
// Triage state CLI used by the /hunt-triage skill and /hunt-loop. No browser, no network.
//
//   node scripts/record-triage.mjs pending                 # writes data/triage/pending-<date>.json, prints path + count
//   node scripts/record-triage.mjs record --file <results.json>   # array of scored results (see fit-profile.md)
//   node scripts/record-triage.mjs decide --id <jobId> --decision pursue|watch|skip [--note "..."]
//   node scripts/record-triage.mjs list [--tier A|B|C|reject] [--status triaged|shortlisted|watching|skipped]
//   node scripts/record-triage.mjs approve --id <jobId> --cv <pdf> [--cover <intro note .txt>] [--cover-pdf <cover letter .pdf, build-cover.mjs>] [--note "..."]
//       right after the user's "Apply", never otherwise
//   node scripts/record-triage.mjs approve-docs --id <jobId> --note "<the user's words>"
//       the user approved the tailored CV and letter (review doc comment, or "Apply")
//   node scripts/record-triage.mjs applied --id <jobId> [--note "..."]      # the user submitted by hand
//   node scripts/record-triage.mjs hold --id <jobId> --note "..."   # an approved or pursued role leaves the runner (watch)
//   node scripts/record-triage.mjs confirm --id <jobId> --evidence <png> [--note "..."]
//   node scripts/record-triage.mjs not-sent --id <jobId> --evidence <png> --note "<the user's words>"
//   node scripts/record-triage.mjs auto --id <jobId> [--cover-pdf <pdf>] [--dry-run]
//       the standing auto-apply rule (config/apply.json auto_apply, enabled: true): picks the
//       archetype's CV, measures its coverage, and pursues + approves only when nothing blocks.
//       Exit 2 with the blockers otherwise; the loop then asks the user as usual.
//
// Every state change is also written to the action log (npm run log).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { parseArgs, out, fail } from './cloak-core.mjs';
import { STATE_PATH, loadState, saveStateAtomic } from './lib/state.mjs';
import { CODE_ROOT, CV_OUT, CV_SRC, DATA_DIR, SCRIPTS_DIR, display, resolveArgPath } from './lib/paths.mjs';
import { loadConfig } from './lib/config.mjs';
import { cvFileBase, preferences } from './lib/profile.mjs';
import { logAction } from './lib/actions-log.mjs';
import { readPause } from './lib/pause.mjs';
import { pendingForTriage, applyTriage, applyDecision, approveApplication, approveDocs, recordAttempt, autoApplyBlockers, markNotSent, sameCompanyRoles, holdApplication } from './lib/triage.mjs';
import { loadCompanyOpts } from './lib/company.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const cmd = positional[0];
const state = loadState(STATE_PATH);
const now = new Date().toISOString();
const str = (v) => (typeof v === 'string' ? v : null);
const short = (s, n = 120) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
const log = (action, job_id, detail, actor = 'agent') => logAction({ actor, action, source: 'record-triage', job_id, detail });

// A path the state keeps is its display() spelling (repo-relative, $JOBBA_HOME/... or
// $JOBBA_DATA_DIR/...), the same one every other script prints; resolveArgPath reads it back.
const storedPath = (p) => display(p);
const fileExists = (p) => !!p && existsSync(resolveArgPath(p));
// Live roles at the same company once they reach config/apply.json companies.limit (company.mjs).
const siblingsOf = (id) => (state.jobs[id] ? sameCompanyRoles(state, state.jobs[id], loadCompanyOpts()) : []);

if (cmd === 'pending') {
  const jobs = pendingForTriage(state);
  const dir = join(DATA_DIR, 'triage');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `pending-${now.slice(0, 10)}.json`);
  writeFileSync(path, JSON.stringify(jobs, null, 2));
  out({ success: true, count: jobs.length, file: display(path) });
} else if (cmd === 'record') {
  if (typeof flags.file !== 'string') fail('Pass --file <results.json>');
  const results = JSON.parse(readFileSync(resolveArgPath(flags.file), 'utf8'));
  if (!Array.isArray(results)) fail('results file must hold a JSON array');
  const r = applyTriage(state, results, now);
  saveStateAtomic(STATE_PATH, state);
  for (const id of r.applied) { const t = state.jobs[id].triage; log('triage.recorded', id, `tier ${t.tier}, score ${t.score}`); }
  out({ success: r.errors.length === 0, ...r });
} else if (cmd === 'decide') {
  if (!flags.id || !flags.decision) fail('Pass --id <jobId> --decision pursue|watch|skip');
  try {
    const id = String(flags.id);
    const j = applyDecision(state, id, flags.decision, str(flags.note) || '', now, { sameCompany: siblingsOf(id) });
    saveStateAtomic(STATE_PATH, state);
    log('triage.decided', j.job_id, short(`${flags.decision}${str(flags.note) ? `: ${flags.note}` : ''}`), 'user');
    out({ success: true, job_id: j.job_id, status: j.status, title: j.title, company: j.company, url: j.url, tier: j.triage.tier, score: j.triage.score });
  } catch (err) { fail(err.message); }
} else if (cmd === 'list') {
  const rows = Object.values(state.jobs)
    .filter((j) => j.triage && (!flags.tier || j.triage.tier === flags.tier) && (!flags.status || j.status === flags.status))
    .sort((a, b) => b.triage.score - a.triage.score)
    .map((j) => ({ job_id: j.job_id, tier: j.triage.tier, score: j.triage.score, status: j.status, title: j.title, company: j.company, location: j.location, url: j.url, why_fit: j.triage.why_fit, gaps: j.triage.gaps, red_flags: j.triage.red_flags, comp_seen: j.triage.comp_seen, hours_seen: j.triage.hours_seen }));
  out({ success: true, count: rows.length, rows });
} else if (cmd === 'approve') {
  if (!flags.id || typeof flags.cv !== 'string') fail('Pass --id <jobId> --cv <the CV pdf the user approved>');
  try {
    const id = String(flags.id);
    const j = approveApplication(state, id, { cv: flags.cv, note: str(flags.note) || '', cover: str(flags.cover), coverPdf: str(flags['cover-pdf']), sameCompany: siblingsOf(id) }, now);
    saveStateAtomic(STATE_PATH, state);
    log('triage.approved', j.job_id, `cv ${basename(flags.cv)}${str(flags['cover-pdf']) ? ', letter' : ''}`, 'user');
    out({ success: true, job_id: j.job_id, application: j.application });
  } catch (err) { fail(err.message); }
} else if (cmd === 'approve-docs') {
  if (!flags.id) fail('Pass --id <jobId> --note "<the user\'s words>"');
  try {
    const j = approveDocs(state, String(flags.id), { note: str(flags.note) }, now);
    saveStateAtomic(STATE_PATH, state);
    log('triage.docs_approved', j.job_id, short(j.application.docs_note), 'user');
    out({ success: true, job_id: j.job_id, docs_approved_at: j.application.docs_approved_at, docs_review: j.application.docs_review });
  } catch (err) { fail(err.message); }
} else if (cmd === 'applied') {
  if (!flags.id || !state.jobs[String(flags.id)]) fail('Pass --id <jobId> of a known job');
  // The user's own submit is a fact to record, never refused; live siblings are named so the digest can say so.
  const siblings = siblingsOf(String(flags.id));
  const j = recordAttempt(state, String(flags.id), { mode: 'by-hand', outcome: 'submitted-by-hand', detail: str(flags.note) }, now);
  saveStateAtomic(STATE_PATH, state);
  log('apply.submitted_by_hand', j.job_id, short(str(flags.note)), 'user');
  out({ success: true, job_id: j.job_id, application: j.application, ...(siblings.length ? { warning: `another application at this company: ${siblings.map((r) => `${r.id} ${r.status}`).join(', ')}` } : {}) });
} else if (cmd === 'confirm') {
  // A submit-unverified run whose own after-submit screenshot shows the site's confirmation
  // (a confirmation phrase the runner did not know yet). Never re-runs anything: it only
  // records the evidence. The submit time stays the click time.
  const id = String(flags.id || '');
  const j = state.jobs[id];
  if (!j || j.application?.status !== 'submit-unverified') fail('confirm is only for a job at submit-unverified');
  if (typeof flags.evidence !== 'string' || !fileExists(flags.evidence)) fail('Pass --evidence <after-submit screenshot> that shows the confirmation');
  const clickAt = j.application.submitted_at;
  const channel = j.application.attempts.at(-1)?.channel ?? null;
  recordAttempt(state, id, { mode: 'confirm', outcome: 'submitted', channel, detail: `${str(flags.note) || 'confirmation seen'} (${flags.evidence})` }, now);
  j.application.submitted_at = clickAt;
  saveStateAtomic(STATE_PATH, state);
  log('apply.confirmed', id, `${channel || 'unknown channel'}: confirmation seen on the after-submit screenshot`);
  out({ success: true, job_id: id, application: { status: j.application.status, submitted_at: j.application.submitted_at } });
} else if (cmd === 'hold') {
  // Takes an approved or pursued role out of the runner's reach (a sibling at the same company is
  // kept instead, or the user wants it parked). A sent application is never touched.
  const id = String(flags.id || '');
  try {
    const j = holdApplication(state, id, { note: str(flags.note) || '' }, now);
    saveStateAtomic(STATE_PATH, state);
    log('triage.held', id, short(j.triage?.note || null), 'user');
    out({ success: true, job_id: id, company: j.company, application: { status: j.application.status } });
  } catch (err) { fail(err.message); }
} else if (cmd === 'not-sent') {
  // A submit-unverified run whose screenshot proves nothing was sent, re-opened with the user's
  // OK. Only after this may the runner try once more.
  const id = String(flags.id || '');
  if (typeof flags.evidence !== 'string' || !fileExists(flags.evidence)) fail('Pass --evidence <screenshot that shows nothing was sent>');
  try {
    const j = markNotSent(state, id, { evidence: flags.evidence, note: str(flags.note) || '' }, now);
    saveStateAtomic(STATE_PATH, state);
    log('apply.not_sent', id, short(str(flags.note)), 'user');
    out({ success: true, job_id: id, application: { status: j.application.status } });
  } catch (err) { fail(err.message); }
} else if (cmd === 'auto') {
  const id = String(flags.id || '');
  const j = state.jobs[id];
  if (!j) fail('Pass --id <jobId> of a known job');
  const cfg = loadConfig('apply.json');
  const rule = cfg.auto_apply || null;
  // Per-job tailoring (preferences.tailoring.cv "per-job", the default): the CV is the job's tailored
  // build (scripts/tailor.mjs) and its coverage is the last measured round against the job's frozen
  // terms. With review "bikeshed" the tailored documents must be approved first (approve-docs).
  // Archetype mode: the triage archetype picks the CV (cv-map rule) and the CV matcher measures it.
  const tailoring = preferences().tailoring || {};
  const extra = [];
  let share = null; let cvAbs = null; let coverage = null; let tailoredLetter = null;
  if ((tailoring.cv || 'per-job') === 'per-job') {
    const rec = (() => { try { return JSON.parse(readFileSync(join(DATA_DIR, 'applications', id, 'tailor.json'), 'utf8')); } catch { return null; } })();
    if (!rec?.docs?.cv?.share_pdf) extra.push('no tailored CV for this job yet (/hunt-tailor)');
    else {
      share = rec.docs.cv.share;
      cvAbs = resolveArgPath(rec.docs.cv.share_pdf);
      coverage = rec.docs.fallback ? (rec.baseline?.pct ?? null) : (rec.rounds?.filter((r) => r.slug === rec.docs.slug).at(-1)?.pct ?? null);
      tailoredLetter = rec.docs.letter?.pdf ? resolveArgPath(rec.docs.letter.pdf) : null;
      if ((tailoring.review || 'bikeshed') === 'bikeshed' && !j.application?.docs_approved_at) extra.push('tailored documents are waiting for review approval (approve-docs)');
    }
  } else {
    const variantPath = join(CV_SRC, 'variants', `${j.triage?.archetype}.json`);
    share = existsSync(variantPath) ? JSON.parse(readFileSync(variantPath, 'utf8')).share : null;
    cvAbs = share ? join(CV_OUT, 'share', `${cvFileBase(share)}.pdf`) : null;
    const m = spawnSync(process.execPath, [join(SCRIPTS_DIR, 'build-cv.mjs'), '--match', id], { cwd: CODE_ROOT, encoding: 'utf8' });
    const ranked = (() => { try { return JSON.parse(m.stdout.trim().split('\n').at(-1)).ranked || []; } catch { return []; } })();
    coverage = ranked.find((r) => r.slug === j.triage?.archetype)?.pct ?? null;
  }
  const cv = cvAbs ? storedPath(cvAbs) : null;
  // A company-site role ("external") is resolved to its ATS only at submit time; the runner
  // submits only on a verified ATS (config/apply.json verified) and hands anything else to the user.
  const type = j.detail?.apply?.type;
  const blockers = autoApplyBlockers(j, rule, { coverage, cvExists: !!cvAbs && existsSync(cvAbs), verified: type === 'external' ? true : !!cfg.verified?.[type], pause: readPause(), sameCompany: siblingsOf(id) });
  blockers.push(...extra);
  if (rule && rule.enabled !== true && !blockers.some((b) => b.startsWith('auto-apply is off'))) blockers.unshift('auto-apply is off (config/apply.json auto_apply.enabled)');
  // A channel whose rule says "generated" goes out only with a claims-only cover letter PDF
  // (scripts/build-cover.mjs, approach A).
  const coverPdf = str(flags['cover-pdf']) || (tailoredLetter && existsSync(tailoredLetter) ? storedPath(tailoredLetter) : null);
  if (rule?.cover_letter?.[type] === 'generated') {
    if (!coverPdf && !flags['dry-run']) blockers.push('needs a generated cover letter (--cover-pdf, scripts/build-cover.mjs)');
    else if (coverPdf && !fileExists(coverPdf)) blockers.push(`cover letter not found: ${coverPdf}`);
  }
  const base = { job_id: id, title: j.title, company: j.company, url: j.url, score: j.triage?.score ?? null, archetype: j.triage?.archetype ?? null, cv, coverage };
  if (blockers.length) {
    out({ success: false, eligible: false, ...base, blockers });
    process.exit(2);
  }
  if (!flags['dry-run']) {
    const note = `Auto-applied under the standing auto-apply rule (config/apply.json): score ${j.triage.score} (min ${rule.min_score}), every gate passing, channel ${type}, CV ${share} at ${coverage}% (min ${rule.min_cv_coverage}%)`;
    applyDecision(state, id, 'pursue', note, now);
    // The letter's text twin (build-cover.mjs writes cover-letter.txt) fills cover-letter text boxes.
    const coverTxt = coverPdf ? join(dirname(coverPdf), 'cover-letter.txt') : null;
    const cover = coverTxt && fileExists(coverTxt) ? coverTxt : null;
    approveApplication(state, id, { cv, note: coverPdf ? `${note}; generated cover letter` : note, cover, coverPdf }, now);
    saveStateAtomic(STATE_PATH, state);
    log('triage.auto_approved', id, `score ${j.triage.score}, ${type}, CV ${share} ${coverage}%${coverPdf ? ', letter' : ''}`, 'script');
  }
  out({ success: true, eligible: true, dry_run: !!flags['dry-run'], ...base });
} else {
  fail('usage: record-triage.mjs pending | record --file <f> | decide --id <id> --decision pursue|watch|skip | list [--tier] [--status] | approve --id <id> --cv <pdf> | approve-docs --id <id> --note "..." | applied --id <id> | hold --id <id> --note "..." | confirm --id <id> --evidence <png> | not-sent --id <id> --evidence <png> --note "..." | auto --id <id> [--cover-pdf <pdf>] [--dry-run]');
}
