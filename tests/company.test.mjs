// The per-company application limit (config/apply.json companies). Agencies count as their named
// end client only; an agency role with no named client has no company limit, but the same agency
// role reposted under a new id is still a duplicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companyKey, applicationKey, opportunityCompanies, loadCompanyOpts } from '../scripts/lib/company.mjs';
import { sameCompanyRoles, applyGate, approveApplication, applyDecision, autoApplyBlockers, holdApplication, validateTriage } from '../scripts/lib/triage.mjs';

const CFG = { agencies: ['Staffco', 'Recruitly Partners'], aliases: { initrode: 'initech' } };
const co = (id, company, status, triage = {}) => ({ job_id: id, company, title: `Role ${id}`, triage: { decision: 'pursue', ...triage }, application: status ? { status, attempts: [], approved_at: status === 'approved' ? 't' : undefined } : undefined });

test('companyKey: a leading "the", corporate suffixes and aliases fold into one company; the first word stays', () => {
  assert.equal(companyKey('Hooli AI'), companyKey('Hooli'));
  assert.equal(companyKey('The Globex Company'), companyKey('Globex'));
  assert.equal(companyKey('Umbrella Systems Inc.'), 'umbrella');
  assert.equal(companyKey('Acme Labs'), 'acme');
  assert.equal(companyKey('Globex Global Talent  & Technology Solutions'), companyKey('GLOBEX Inc'));
  assert.equal(companyKey('AI'), 'ai');
  assert.equal(companyKey('Étoile Example'), 'etoile example');
  assert.equal(companyKey('Initrode', CFG.aliases), 'initech');
});

test('applicationKey: a direct posting is its company; an agency posting is its named client, or no company when none is named', () => {
  assert.equal(applicationKey(co('a', 'Globex', null), CFG).key, 'globex');
  assert.equal(applicationKey(co('b', 'Staffco', null, { end_client: 'Globex' }), CFG).key, 'globex');
  const anon = applicationKey(co('c', 'Staffco', null), CFG);
  assert.equal(anon.key, null);
  assert.equal(anon.agency, 'staffco');
  // A poster with a named client counts as that client even when it is not on the agencies list.
  assert.equal(applicationKey(co('d', 'Findco Recruiting', null, { end_client: 'Acme Inc' }), CFG).key, 'acme');
  // A poster the model flagged as a recruiter or staffing firm (via_agency) with no client named has no company limit.
  assert.equal(applicationKey(co('e', 'Hireco', null, { via_agency: true }), CFG).key, null);
  assert.equal(applicationKey(co('f', 'Hireco', null, { via_agency: false }), CFG).key, 'hireco');
});

test('sameCompanyRoles finds other live roles at the same company, case and spacing ignored', () => {
  const state = { jobs: { a: co('a', 'Globex', 'submitted'), b: co('b', ' globex ', 'approved'), c: co('c', 'Globex', null), d: co('d', 'Initech', 'approved'), e: co('e', 'Globex', 'closed') } };
  assert.deepEqual(sameCompanyRoles(state, state.jobs.b).map((r) => r.id), ['a']);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.c).map((r) => r.id).sort(), ['a', 'b']);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.d), []);
});

test('company names match across punctuation and corporate suffixes', () => {
  const state = { jobs: {
    a: co('a', 'Globex Global Tech', 'approved'), b: co('b', 'Globex', null),
    c: co('c', 'Initech Group', 'submitted'), d: co('d', 'Initech', null),
    g: co('g', 'Pixel Groups', 'submitted'), h: co('h', 'Pixel Stack', null),
  } };
  assert.deepEqual(sameCompanyRoles(state, state.jobs.b).map((r) => r.id), ['a']);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.d).map((r) => r.id), ['c']);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.h), []);
});

test('a held sibling never blocks the role kept over it', () => {
  const state = { jobs: { kept: co('kept', 'Hooli', null), held: co('held', 'Hooli', 'held'), sent: co('sent', 'Initech', 'submitted'), other: co('other', 'Initech', 'held') } };
  assert.deepEqual(sameCompanyRoles(state, state.jobs.kept), []);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.other).map((r) => r.id), ['sent']);
});

test('the limit: siblings come back only once they reach it; null turns the rule off', () => {
  const state = { jobs: { a: co('a', 'Globex', 'submitted'), b: co('b', 'Globex', 'approved'), c: co('c', 'Globex', null) } };
  assert.deepEqual(sameCompanyRoles(state, state.jobs.c, { limit: 2 }).map((r) => r.id).sort(), ['a', 'b']);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.c, { limit: 3 }), []);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.c, { limit: null }), []);
  assert.deepEqual(sameCompanyRoles({ jobs: { a: state.jobs.a, c: state.jobs.c } }, state.jobs.c, { limit: 2 }), []);
});

test('agency postings: a named client blocks against a direct application there, and the reverse', () => {
  const state = { jobs: { direct: co('direct', 'Globex', 'submitted'), viaAgency: co('viaAgency', 'Staffco', null, { end_client: 'Globex' }) } };
  assert.deepEqual(sameCompanyRoles(state, state.jobs.viaAgency, CFG).map((r) => r.id), ['direct']);
  const rev = { jobs: { viaAgency: co('viaAgency', 'Staffco', 'submitted', { end_client: 'Globex' }), direct: co('direct', 'Globex', null) } };
  assert.deepEqual(sameCompanyRoles(rev, rev.jobs.direct, CFG).map((r) => r.id), ['viaAgency']);
});

test('agency postings with no named client are not limited, except the same role posted again', () => {
  const a = co('a', 'Recruitly Partners', 'submitted'); a.title = 'VP Engineering';
  const b = co('b', 'Recruitly Partners Group', null); b.title = 'Staff Software Engineer';
  const c = co('c', 'Recruitly Partners', null); c.title = 'VP, Engineering';
  const state = { jobs: { a, b, c } };
  assert.deepEqual(sameCompanyRoles(state, b, CFG), []);
  assert.deepEqual(sameCompanyRoles(state, c, CFG).map((r) => r.id), ['a']);
});

test('applications outside the job state count: an opportunity file at applied, screening or lost blocks; shortlisted and its own file do not', () => {
  const files = [
    { file: '20260110-globex-staff-platform-engineer.md', md: '---\ncompany: "Globex"\nstage: applied\njob_id: "9100000001"\n---\n' },
    { file: '20260111-initech-staff-backend.md', md: '---\ncompany: Initech\nstage: lost\njob_id: "9100000002"\n---\n' },
    { file: '20260112-hooli-x.md', md: '---\ncompany: Hooli\nstage: shortlisted\njob_id: "1"\n---\n' },
    { file: '20260108-staffco-acme.md', md: '---\ncompany: "Acme Robotics"\nstage: screening  # a comment\njob_id: "email-abc"\n---\n' },
    { file: '20260109-umbrella-body-only.md', md: '---\nstage: applied\n---\n\ncompany: Umbrella\n' },
  ];
  const external = opportunityCompanies(files);
  assert.deepEqual(external.map((e) => e.key), ['globex', 'initech', 'acme robotics']);
  const state = { jobs: { g: co('g', 'Globex', null), 9100000001: co('9100000001', 'Globex', 'submitted'), h: co('h', 'Hooli', null), acme: co('acme', 'Acme Robotics Inc', null) } };
  assert.deepEqual(sameCompanyRoles(state, state.jobs.g, { ...CFG, external }).map((r) => r.id), ['9100000001']);
  assert.deepEqual(sameCompanyRoles({ jobs: { x: co('x', 'Initech', null) } }, { job_id: 'x', company: 'Initech' }, { ...CFG, external }).map((r) => r.status), ['opportunity:lost']);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.h, { ...CFG, external }), []);
  assert.deepEqual(sameCompanyRoles(state, state.jobs.acme, { ...CFG, external }).map((r) => r.id), ['20260108-staffco-acme.md']);
});

test('loadCompanyOpts reads companies from apply.json and the opportunity folder; a missing limit means 1', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'opps-')), 'opportunities');
  mkdirSync(dir);
  writeFileSync(join(dir, '20260110-globex-x.md'), '---\ncompany: Globex\nstage: applied\n---\n');
  writeFileSync(join(dir, 'notes.txt'), 'company: Initech');
  const o = loadCompanyOpts({ cfg: { agencies: ['Staffco'] }, dir });
  assert.equal(o.limit, 1);
  assert.deepEqual(o.agencies, ['Staffco']);
  assert.deepEqual(o.external.map((e) => e.key), ['globex']);
  assert.equal(loadCompanyOpts({ cfg: { limit: null }, dir }).limit, null);
  assert.equal(loadCompanyOpts().limit, 1);
});

test('apply gate: a sent, already-applied or opportunity-file sibling blocks a real submit; an approved one and a dry run do not', () => {
  const j = co('b', 'Globex', 'approved');
  assert.equal(applyGate(j, { dryRun: false, sameCompany: [{ id: 'a', status: 'submitted' }] }), 'same-company: a submitted');
  assert.equal(applyGate(j, { dryRun: false, sameCompany: [{ id: 'a', status: 'already-applied' }] }), 'same-company: a already-applied');
  assert.equal(applyGate(j, { dryRun: false, sameCompany: [{ id: 'f.md', status: 'opportunity:applied' }] }), 'same-company: f.md opportunity:applied');
  assert.equal(applyGate(j, { dryRun: false, sameCompany: [{ id: 'x', status: 'approved' }] }), null);
  assert.equal(applyGate(j, { dryRun: true, sameCompany: [{ id: 'a', status: 'submitted' }] }), null);
});

test('approve and pursue refuse when another role at the company is live, and name it; watch does not', () => {
  const state = { jobs: { a: co('a', 'Globex', 'submitted'), b: { ...co('b', 'Globex', null), triage: { decision: null } } } };
  const sib = sameCompanyRoles(state, state.jobs.b, CFG);
  assert.throws(() => applyDecision(state, 'b', 'pursue', 'Apply', 't', { sameCompany: sib }), /company limit: a submitted/);
  assert.doesNotThrow(() => applyDecision(state, 'b', 'watch', '', 't', { sameCompany: sib }));
  state.jobs.b.triage.decision = 'pursue';
  assert.throws(() => approveApplication(state, 'b', { cv: 'x.pdf', note: 'Apply', sameCompany: sib }, 't'), /company limit: a submitted/);
});

test('auto-apply is blocked when another role at the company is live', () => {
  const rule = { min_score: 75, channels: ['easy'], min_cv_coverage: 60 };
  const j = { triage: { score: 90, tier: 'A', gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' } }, detail: { apply: { type: 'easy' } } };
  const ok = { coverage: 80, cvExists: true, verified: true };
  assert.deepEqual(autoApplyBlockers(j, rule, ok), []);
  assert.match(autoApplyBlockers(j, rule, { ...ok, sameCompany: [{ id: '111', status: 'submitted' }] }).join(), /company limit: 111 submitted/);
});

test('hold takes an approved role out of the runner, keeps its attempts, and records the note', () => {
  const state = { jobs: { b: co('b', 'Globex', 'approved') } };
  state.jobs.b.status = 'shortlisted';
  state.jobs.b.application.attempts = [{ mode: 'dry-run', outcome: 'filled' }];
  holdApplication(state, 'b', { note: 'held: Globex already has an application' }, '2026-01-12T19:00:00Z');
  const j = state.jobs.b;
  assert.equal(j.application.status, 'held');
  assert.equal(j.application.approved_at, undefined);
  assert.equal(j.application.attempts.length, 2);
  assert.equal(j.triage.decision, 'watch');
  assert.equal(j.status, 'watching');
  assert.equal(applyGate(j, { dryRun: false }), 'not-pursued');
  assert.match(j.application.attempts.at(-1).detail, /held: Globex/);
  assert.throws(() => holdApplication({ jobs: { s: co('s', 'X', 'submitted') } }, 's', { note: 'n' }, 't'), /already submitted/);
  assert.throws(() => holdApplication(state, 'b', { note: ' ' }, 't'), /--note/);
});

test('triage schema: end_client is an optional string or null, via_agency an optional boolean', () => {
  const r = { job_id: '9100000001', score: 80, gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, why_fit: [], gaps: [], red_flags: [] };
  assert.deepEqual(validateTriage({ ...r, end_client: 'Globex' }), []);
  assert.deepEqual(validateTriage({ ...r, end_client: null }), []);
  assert.ok(validateTriage({ ...r, end_client: 5 }).some((e) => /end_client/.test(e)));
  assert.deepEqual(validateTriage({ ...r, via_agency: true }), []);
  assert.ok(validateTriage({ ...r, via_agency: 'yes' }).some((e) => /via_agency/.test(e)));
});
