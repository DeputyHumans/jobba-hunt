import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractJobIdsFromHtml, parseCardText, parseTopCard, classifySearch, isEmptyMarkerText, parseResultCount, applyTypeOf, alreadyAppliedIn,
} from '../scripts/lib/extract.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('extracts job IDs from occludable list items, data-job-id, view hrefs and currentJobId, deduped in order', () => {
  assert.deepEqual(extractJobIdsFromHtml(fx('synthetic-search.html')),
    ['9000000001', '9000000002', '9000000003', '9000000004']);
});

test('extracts nothing from an empty-result page', () => {
  assert.deepEqual(extractJobIdsFromHtml(fx('synthetic-empty.html')), []);
});

test('recognises the no-results marker text', () => {
  assert.equal(isEmptyMarkerText('No matching jobs found.\nTry a different search'), true);
  assert.equal(isEmptyMarkerText('We couldn’t find a match for fractional CTO'), true);
  assert.equal(isEmptyMarkerText('Fractional CTO\nAcme\nRemote'), false);
});

test('parses the result count header', () => {
  assert.equal(parseResultCount('37 results'), 37);
  assert.equal(parseResultCount('1,204 results'), 1204);
  assert.equal(parseResultCount('1 result'), 1);
  assert.equal(parseResultCount('Jobs you may be interested in'), null);
});

test('parses a job card: dedupes the visually-hidden title copy, reads company, location and badges', () => {
  const text = [
    'Fractional CTO', 'Fractional CTO with verification', 'Acme Health',
    'United States (Remote)', 'Promoted', '3 days ago', 'Easy Apply', 'Over 100 applicants',
  ].join('\n');
  const c = parseCardText(text);
  assert.equal(c.title, 'Fractional CTO');
  assert.equal(c.company, 'Acme Health');
  assert.equal(c.location, 'United States (Remote)');
  assert.equal(c.posted_text, '3 days ago');
  assert.equal(c.promoted, true);
  assert.equal(c.easy_apply, true);
  assert.equal(c.applicants_text, 'Over 100 applicants');
});

test('card parse tolerates an empty (virtualized) card', () => {
  const c = parseCardText('');
  assert.equal(c.title, null);
  assert.equal(c.company, null);
});

test('parses the job view top card insights', () => {
  const t = 'Fractional CTO\nAcme Health · Greater Chicago Area · Reposted 2 days ago · 23 applicants\n'
    + 'Remote\nContract\n$150/hr - $200/hr\nPromoted by hirer';
  const p = parseTopCard(t);
  assert.equal(p.workplace, 'Remote');
  assert.equal(p.employment_type, 'Contract');
  assert.equal(p.applicants, 23);
  assert.equal(p.posted_text, 'Reposted 2 days ago');
  assert.equal(p.comp_text, '$150/hr - $200/hr');
});

test('top card with "Over 100 applicants" and yearly comp', () => {
  const p = parseTopCard('Head of Engineering\nHooli · United States · 1 week ago · Over 100 applicants\nHybrid\nFull-time\n$180K/yr - $220K/yr');
  assert.equal(p.applicants, 100);
  assert.equal(p.workplace, 'Hybrid');
  assert.equal(p.employment_type, 'Full-time');
  assert.equal(p.comp_text, '$180K/yr - $220K/yr');
});

test('classifies search outcomes: checkpoint and login beat everything', () => {
  assert.equal(classifySearch({ url: 'https://www.linkedin.com/checkpoint/challenge/x', loggedOut: true, idCount: 0, emptyMarker: false }), 'checkpoint');
  assert.equal(classifySearch({ url: 'https://www.linkedin.com/authwall?trk=x', loggedOut: true, idCount: 0, emptyMarker: false }), 'checkpoint');
  assert.equal(classifySearch({ url: 'https://www.linkedin.com/login', loggedOut: true, idCount: 0, emptyMarker: false }), 'login');
  assert.equal(classifySearch({ url: 'https://www.linkedin.com/jobs/search/?k=x', loggedOut: true, idCount: 5, emptyMarker: false }), 'login');
});

test('classifies search outcomes: results, legit empty, and suspect empty', () => {
  const url = 'https://www.linkedin.com/jobs/search/?keywords=x';
  assert.equal(classifySearch({ url, loggedOut: false, idCount: 12, emptyMarker: false }), 'ok');
  assert.equal(classifySearch({ url, loggedOut: false, idCount: 0, emptyMarker: true }), 'empty');
  assert.equal(classifySearch({ url, loggedOut: false, idCount: 0, emptyMarker: false }), 'suspect');
});

test('the no-results marker wins over filler cards ("Jobs you may be interested in" ads)', () => {
  const url = 'https://www.linkedin.com/jobs/search/?keywords=%22part-time+CTO%22';
  assert.equal(classifySearch({ url, loggedOut: false, idCount: 8, emptyMarker: true }), 'empty');
});

test('recognises the live no-results sentence with the quoted query', () => {
  assert.equal(isEmptyMarkerText('We’re gradually retiring classic job search ... No matching jobs found for ""part-time CTO"" Jobs you may be interested in'), true);
});

test('AI job search cards carry the job ID in componentkey="job-card-component-ref-<id>"', () => {
  const html = '<div componentkey="job-card-component-ref-9000000011"><a>Fractional Head of AI</a></div><div componentkey="job-card-component-ref-9000000012"></div>';
  assert.deepEqual(extractJobIdsFromHtml(html), ['9000000011', '9000000012']);
});

test('card parse collapses a title glued to its visually-hidden copy (AI search UI)', () => {
  const c = parseCardText('Fractional Head of AIFractional Head of AI\nInitech\nUnited States (Remote)');
  assert.equal(c.title, 'Fractional Head of AI');
  assert.equal(c.company, 'Initech');
  assert.equal(parseCardText('CTO / Head of AI (Verified job)CTO / Head of AI\nUmbrella Labs\nAustin, TX (Remote)').title, 'CTO / Head of AI');
});

test('card parse: "(Verified job)" on its own title line, plain copy on the next (AI search, sweep 2026-10-27)', () => {
  const c = parseCardText('Insurance - Interim Information Technology Director  (Verified job)\nInsurance - Interim Information Technology Director\nGlobex\nUnited States (Remote)');
  assert.equal(c.title, 'Insurance - Interim Information Technology Director');
  assert.equal(c.company, 'Globex');
  assert.equal(c.location, 'United States (Remote)');
});

test('apply type: the Easy Apply button (aria-label "Easy Apply to this job", capture 2026-10-26) is easy', () => {
  assert.deepEqual(applyTypeOf({ label: 'Easy Apply to this job', href: null }), { type: 'easy', url: null });
});

test('apply type: a plain Apply control is external, with its link when it has one', () => {
  assert.deepEqual(applyTypeOf({ label: 'Apply to Fractional Head of AI on company website', href: 'https://www.linkedin.com/jobs/view/externalApply/9000000011' }),
    { type: 'external', url: 'https://www.linkedin.com/jobs/view/externalApply/9000000011' });
  assert.deepEqual(applyTypeOf({ label: 'Apply', href: null }), { type: 'external', url: null });
});

test('apply type: no apply control is null (closed or already applied)', () => {
  assert.equal(applyTypeOf({ label: null, href: null }), null);
  assert.equal(applyTypeOf({ label: 'Save', href: null }), null);
});

test('already-applied marker in the view text', () => {
  assert.equal(alreadyAppliedIn('Fractional CTO\nApplied 3 days ago\nSee application'), true);
  assert.equal(alreadyAppliedIn('Application submitted'), true);
  assert.equal(alreadyAppliedIn('Fractional CTO\nEasy Apply\nSave'), false);
});
