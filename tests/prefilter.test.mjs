import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePrefilter, prefilterJob } from '../scripts/lib/prefilter.mjs';

const TPL = JSON.parse(readFileSync(new URL('../templates/workspace/config/prefilter.json', import.meta.url), 'utf8'));
// The template ships generic lists; onboarding adds the operator's own. These are injected here.
const cfg = {
  ...TPL,
  title_drop: [...TPL.title_drop, '\\bco-?founder\\b', '\\bfounder\\s*(&|and)\\s*(cto|ceo)\\b', '\\bbenefits?\\b'],
  ic_title_drop: [...TPL.ic_title_drop, '\\bsap\\b', 'salesforce', 'sharepoint', 'network architect', 'tableau', 'business intelligence', 'databricks'],
  stack_title_drop: ['\\bperl\\b'],
  stack_title_keep: TPL.title_ai,
  company_drop: ['^umbrella labs\\b', '^soylent systems\\b'],
};
const OPTS = { onsiteMetros: ['\\bspringfield,?\\s*il\\b', '\\bshelbyville\\b'], accept: ['c2c', '1099', 'w2', 'full-time', 'contract', 'part-time'], icRateFloor: 100, ftSalaryFloor: 200000 };
const P = compilePrefilter(cfg, OPTS);
const run = (job, scopes = ['fractional'], p = P) => prefilterJob(job, p, { scopes });

test('keeps a remote fractional CTO role', () => {
  const r = run({ title: 'Fractional CTO', company: 'Acme Corp', location: 'United States (Remote)' });
  assert.equal(r.verdict, 'keep');
  assert.deepEqual(r.reasons, []);
});

test('drops junior and IC-excluded titles', () => {
  assert.equal(run({ title: 'Junior Software Engineer', company: 'Globex', location: 'Remote' }).verdict, 'drop');
  assert.equal(run({ title: 'Technical Recruiter', company: 'Globex', location: 'Remote' }).verdict, 'drop');
});

test('drops titles with neither a leadership nor a senior engineering signal (G3)', () => {
  const r = run({ title: 'Senior Marketing Manager', company: 'Globex', location: 'Remote' }, ['generic']);
  assert.equal(r.verdict, 'drop');
  assert.ok(r.reasons.includes('not-senior'));
  assert.equal(run({ title: 'Senior Software Engineer', company: 'Globex', location: 'Remote' }, ['generic']).verdict, 'keep');
});

// G2 is remote: occasional travel is fine, an office is not, except in the operator's on-site metros.
test('drops on-site roles outside the on-site metros (G2)', () => {
  for (const location of ['Austin, TX (On-site)', 'Dallas, GA (On-site)', 'Springfield, MO (On-site)']) {
    const r = run({ title: 'Interim CTO', company: 'Globex', location });
    assert.equal(r.verdict, 'drop', location);
    assert.ok(r.reasons.includes('onsite'));
  }
});

test('on-site or hybrid inside an on-site metro goes to review as onsite-metro-ask, never a drop (G2)', () => {
  for (const location of ['Springfield, IL (On-site)', 'Shelbyville Area (Hybrid)', 'Springfield IL-Hybrid']) {
    const r = run({ title: 'Interim CTO', company: 'Globex', location });
    assert.equal(r.verdict, 'review', location);
    assert.ok(r.reasons.includes('onsite-metro-ask'), location);
    assert.ok(!r.reasons.includes('onsite'), location);
  }
});

test('on-site metros come from preferences.location.onsite_metros and prefilter.json onsite_metro_markers, merged', () => {
  const both = compilePrefilter({ ...cfg, onsite_metro_markers: ['\\bcapital city\\b'] }, OPTS);
  assert.ok(run({ title: 'Interim CTO', company: 'Globex', location: 'Capital City (On-site)' }, ['fractional'], both).reasons.includes('onsite-metro-ask'));
  assert.ok(run({ title: 'Interim CTO', company: 'Globex', location: 'Springfield, IL (On-site)' }, ['fractional'], both).reasons.includes('onsite-metro-ask'));
  const none = compilePrefilter(cfg, { ...OPTS, onsiteMetros: [] });
  assert.ok(run({ title: 'Interim CTO', company: 'Globex', location: 'Springfield, IL (On-site)' }, ['fractional'], none).reasons.includes('onsite'));
  // Without opts, the metros come from the workspace preferences (the synthetic fixture lists Springfield).
  const ws = compilePrefilter(cfg);
  assert.ok(run({ title: 'Interim CTO', company: 'Globex', location: 'Springfield, IL (On-site)' }, ['fractional'], ws).reasons.includes('onsite-metro-ask'));
});

test('hybrid outside the on-site metros goes to review: only the description can say "occasional travel" (G2)', () => {
  const r = run({ title: 'Interim CTO', company: 'Globex', location: 'Chicago, IL (Hybrid)' });
  assert.equal(r.verdict, 'review');
  assert.ok(r.reasons.includes('hybrid-check-travel'));
});

test('location with no workplace marker goes to review', () => {
  const r = run({ title: 'Fractional CTO', company: 'Globex', location: 'United States' });
  assert.equal(r.verdict, 'review');
  assert.ok(r.reasons.includes('location-unclear'));
});

test('detail workplace Remote resolves an unclear card location', () => {
  const r = run({ title: 'Fractional CTO', company: 'Globex', location: 'United States', detail: { workplace: 'Remote', employment_type: 'Part-time', description_text: '' } });
  assert.equal(r.verdict, 'keep');
});

test('fractional-scope hit with no scope signal in the title stays in review until the detail view', () => {
  const r = run({ title: 'Chief Technology Officer', company: 'Globex', location: 'Remote' }, ['fractional']);
  assert.equal(r.verdict, 'review');
  assert.ok(r.reasons.includes('scope-unconfirmed'));
});

test('generic hit came through the contract/part-time filter, so scope counts as confirmed', () => {
  const r = run({ title: 'Chief Technology Officer', company: 'Globex', location: 'Remote' }, ['generic']);
  assert.equal(r.verdict, 'keep');
});

test('full-time detail with no scope signal, full-time accepted: leadership and IC both go to review (full-time-ask, full-time-ic-ask)', () => {
  const detail = { workplace: 'Remote', employment_type: 'Full-time', description_text: 'Join our team and lead 40 engineers. Benefits, 401k.' };
  const lead = run({ title: 'VP Engineering', company: 'Globex', location: 'Remote', detail }, ['generic']);
  assert.equal(lead.verdict, 'review');
  assert.ok(lead.reasons.includes('full-time-ask'));
  const ic = run({ title: 'Senior Software Engineer', company: 'Globex', location: 'Remote', detail }, ['generic']);
  assert.equal(ic.verdict, 'review');
  assert.ok(ic.reasons.includes('full-time-ic-ask'));
});

test('full-time outside engagement.accept drops (full-time-excluded); contract roles are untouched', () => {
  const noFt = compilePrefilter(cfg, { ...OPTS, accept: ['c2c', '1099', 'contract', 'part-time'] });
  const detail = (et) => ({ workplace: 'Remote', employment_type: et, description_text: 'Lead our engineering team.' });
  const ft = run({ title: 'VP Engineering', company: 'Globex', location: 'Remote', detail: detail('Full-time') }, ['generic'], noFt);
  assert.equal(ft.verdict, 'drop');
  assert.ok(ft.reasons.includes('full-time-excluded'));
  assert.equal(run({ title: 'VP Engineering', company: 'Globex', location: 'Remote', detail: detail('Contract') }, ['generic'], noFt).verdict, 'keep');
});

test('full-time-tagged posting whose description says fractional is kept (mis-tagged roles)', () => {
  const r = run({ title: 'CTO', company: 'Globex', location: 'Remote',
    detail: { workplace: 'Remote', employment_type: 'Full-time', description_text: 'We need a fractional CTO, 10-15 hours per week.' } }, ['fractional']);
  assert.equal(r.verdict, 'keep');
});

test('contract employment type confirms scope', () => {
  const r = run({ title: 'Head of AI', company: 'Globex', location: 'Remote',
    detail: { workplace: 'Remote', employment_type: 'Contract', description_text: 'Lead our AI roadmap.' } }, ['fractional']);
  assert.equal(r.verdict, 'keep');
});

test('aggregator companies are flagged, not dropped', () => {
  const r = run({ title: 'Fractional CTO', company: 'Toptal', location: 'United States (Remote)' });
  assert.equal(r.verdict, 'keep');
  assert.ok(r.flags.includes('aggregator'));
});

test('aggregator match is whole-word: "Dicey Labs" is not Dice', () => {
  const r = run({ title: 'Fractional CTO', company: 'Dicey Labs', location: 'Remote' });
  assert.ok(!r.flags.includes('aggregator'));
});

test('missing title is review, never keep', () => {
  const r = run({ title: null, company: null, location: null });
  assert.equal(r.verdict, 'review');
  assert.ok(r.reasons.includes('card-unparsed'));
});

test('canary-only hits without a scope signal in the title are dropped, so they never burn view budget', () => {
  const r = run({ title: 'Chief Technology Officer', company: 'Globex', location: 'United States (Remote)' }, ['canary']);
  assert.equal(r.verdict, 'drop');
  assert.ok(r.reasons.includes('canary-only'));
});

test('canary hit with a scope signal in the title is kept', () => {
  const r = run({ title: 'Fractional CTO', company: 'Globex', location: 'United States (Remote)' }, ['canary']);
  assert.equal(r.verdict, 'keep');
});

test('AI-search (semantic) hits are not canary-only: no title scope means review, not drop', () => {
  const r = run({ title: 'Chief Technology Officer', company: 'Hooli', location: 'Greater Chicago Area (Remote)' }, ['semantic']);
  assert.equal(r.verdict, 'review');
  assert.ok(r.reasons.includes('scope-unconfirmed'));
});

test('company_drop drops by company, anchored and whole-word', () => {
  for (const company of ['Umbrella Labs', 'UMBRELLA LABS - Talent & Advisory']) {
    const r = run({ title: 'CTO / Head of AI at Financial Services Companies', company, location: 'Boston, MA (Remote)' }, ['generic']);
    assert.equal(r.verdict, 'drop', company);
    assert.ok(r.reasons.includes('company-excluded'));
  }
  assert.notEqual(run({ title: 'Fractional CTO', company: 'Umbrella Labsworth', location: 'Remote' }).verdict, 'drop');
  assert.ok(run({ title: 'Senior Python Engineer', company: 'Soylent Systems', location: 'United States (Remote)' }, ['generic']).reasons.includes('company-excluded'));
  assert.ok(!run({ title: 'Senior Python Engineer', company: 'Soylent Systemic Labs', location: 'Remote' }, ['generic']).reasons.includes('company-excluded'));
});

test('co-founder titles drop when the workspace title_drop excludes them (equity-only, G1)', () => {
  for (const title of ['AI Co-Founder / CTO (100 % remote)', 'Technical Co-Founder - New MedTech Venture', 'Late founder & CTO']) {
    const r = run({ title, company: 'Globex', location: 'United States (Remote)' }, ['semantic']);
    assert.equal(r.verdict, 'drop', title);
  }
  assert.notEqual(run({ title: 'Founding CTO (AI/ML)', company: 'Globex', location: 'Remote' }, ['semantic']).verdict, 'drop');
});

test('IC rate floor: IC titles under the floor drop; exec titles and unstated rates do not', async () => {
  const { hourlyMax, belowIcFloor } = await import('../scripts/lib/rate.mjs');
  const F = { floor: 100 };
  assert.equal(hourlyMax('$90 - $100/hr'), 100);
  assert.equal(hourlyMax('$40-$45/hr C2C; $45-$50/hr W2'), 50);
  assert.equal(hourlyMax('Up to $90+/hr'), 90);
  assert.equal(hourlyMax('$150K/yr'), 72);
  assert.equal(hourlyMax('Depends on Experience'), null);
  assert.deepEqual(belowIcFloor(null, '$60 - $65/hr', F), { hourly: 65, floor: 100 });
  assert.equal(belowIcFloor('$90 - $110/hr', F), null);
  assert.equal(belowIcFloor('$75 - $100/hr', F), null); // the floor itself meets the floor
  assert.equal(belowIcFloor('Up to $90+/hr', F), null); // open-ended: no ceiling stated
  assert.equal(belowIcFloor('$90+ per hour', F), null);
  assert.deepEqual(belowIcFloor('$85 - $90/hr', F), { hourly: 90, floor: 100 });
  assert.deepEqual(belowIcFloor('$75 - $99/hr', F), { hourly: 99, floor: 100 });
  const job = (title, comp, p = P) => run({ job_id: '9000000002', title, company: 'Globex', location: 'Remote', detail: { comp_text: comp, employment_type: 'Contract', description_text: 'Contract role' } }, ['fractional'], p);
  assert.ok(job('Senior AI Engineer', '$70/hr').reasons.includes('rate-below-floor'));
  assert.ok(job('AI Architect', '$60 - $65/hr').reasons.includes('rate-below-floor'));
  assert.ok(!job('Fractional CTO', '$90/hr').reasons.includes('rate-below-floor'));
  assert.ok(!job('Senior AI Engineer', 'Depends on Experience').reasons.includes('rate-below-floor'));
  assert.ok(!job('Senior AI Engineer', '$100 - $120/hr').reasons.includes('rate-below-floor'));
  // A null floor turns the check off.
  assert.equal(belowIcFloor('$10/hr', { floor: null }), null);
  assert.ok(!job('Senior AI Engineer', '$70/hr', compilePrefilter(cfg, { ...OPTS, icRateFloor: null })).reasons.includes('rate-below-floor'));
});

test('the floors default to preferences.money of the workspace', async () => {
  const { belowIcFloor, belowFullTimeFloor, icRateFloor, ftSalaryFloor, ftSalaryTarget } = await import('../scripts/lib/rate.mjs');
  const prefs = JSON.parse(readFileSync(new URL('./fixtures/workspace/profile/preferences.json', import.meta.url), 'utf8'));
  assert.deepEqual([icRateFloor(), ftSalaryFloor(), ftSalaryTarget()], [prefs.money.ic_rate_floor, prefs.money.ft_salary_floor, prefs.money.ft_salary_target]);
  const under = prefs.money.ic_rate_floor - 1;
  assert.deepEqual(belowIcFloor(`$${under}/hr`), { hourly: under, floor: prefs.money.ic_rate_floor });
  assert.equal(belowFullTimeFloor(`$${prefs.money.ft_salary_floor}`)?.floor ?? null, null, 'the floor itself passes');
  assert.equal(compilePrefilter(cfg).icRateFloor, prefs.money.ic_rate_floor);
});

test('non-exec architect titles on platforms outside the record drop', () => {
  for (const title of ['Tableau Technical Architect', 'Business Intelligence Solutions Architect', 'Databricks Solution Architect']) {
    assert.ok(run({ title, company: 'Globex', location: 'United States (Remote)' }, ['generic']).reasons.includes('outside-record'), title);
  }
  assert.ok(!run({ title: 'AI Principal Architect', company: 'Globex', location: 'United States (Remote)' }, ['generic']).reasons.includes('outside-record'));
});

test('network architect and benefits titles drop', () => {
  assert.ok(run({ title: 'Network Architect', company: 'Globex', location: 'United States (Remote)' }, ['generic']).reasons.includes('outside-record'));
  assert.ok(run({ title: 'Benefit Assessment Consultant', company: 'Globex', location: 'United States (Remote)' }, ['generic']).reasons.includes('title-excluded'));
});

test('stack_title_drop drops a non-exec title naming the stack; stack_title_keep and exec titles stay', () => {
  for (const t of ['Sr. Perl Full Stack Developer', 'Lead Perl Architect (100% Remote)']) {
    const r = run({ title: t, company: 'Globex', location: 'United States (Remote)' }, ['generic']);
    assert.equal(r.verdict, 'drop', t);
    assert.ok(r.reasons.includes('stack-excluded'), t);
  }
  for (const t of ['Senior AI Engineer (Python/Perl)', 'Principal LLM Engineer - Perl']) assert.ok(!run({ title: t, company: 'Globex', location: 'Remote' }, ['generic']).reasons.includes('stack-excluded'), t);
  assert.ok(!run({ title: 'Director of Perl Engineering', company: 'Globex', location: 'Remote' }, ['generic']).reasons.includes('stack-excluded'));
  // The shipped template excludes no stack.
  assert.ok(!run({ title: 'Sr. Perl Full Stack Developer', company: 'Globex', location: 'Remote' }, ['generic'], compilePrefilter(TPL, OPTS)).reasons.includes('stack-excluded'));
});

test('full-time IC floor: a full-time IC role posted under the floor drops; leadership and contracts are untouched', async () => {
  const { belowFullTimeFloor } = await import('../scripts/lib/rate.mjs');
  const F = { floor: 200000 };
  assert.deepEqual(belowFullTimeFloor('$160K/yr - $190K/yr', F), { annual: 190000, floor: 200000 });
  assert.deepEqual(belowFullTimeFloor('$90/hr', F), { annual: 187200, floor: 200000 });
  assert.equal(belowFullTimeFloor('$100/hr', F), null); // $208,000 a year
  assert.equal(belowFullTimeFloor('$186.5K/yr - $252.3K/yr', F), null);
  assert.equal(belowFullTimeFloor('$300K/yr - $400K/yr', F), null);
  assert.equal(belowFullTimeFloor('$150K+', F), null); // open-ended top: no ceiling stated
  assert.equal(belowFullTimeFloor('Depends on Experience', F), null);
  assert.equal(belowFullTimeFloor('$10K', { floor: null }), null);
  const ft = (title, comp) => run({ title, company: 'Globex', location: 'Remote', detail: { workplace: 'Remote', employment_type: 'Full-time', comp_text: comp, description_text: 'Build agents.' } }, ['semantic']);
  const low = ft('Solution Architect, Agentic AI', '$160K/yr - $190K/yr');
  assert.equal(low.verdict, 'drop');
  assert.ok(low.reasons.includes('salary-below-ft-floor'));
  assert.equal(ft('Solution Architect, Agentic AI', '$360K/yr - $420K/yr').verdict, 'review');
  assert.equal(ft('Solution Architect, Agentic AI', '$200K/yr - $280K/yr').verdict, 'review'); // the below-target band reaches triage
  assert.ok(!ft('VP of Engineering', '$160K/yr - $190K/yr').reasons.includes('salary-below-ft-floor'));
  const contract = run({ title: 'Solution Architect, Agentic AI', company: 'Globex', location: 'Remote', detail: { workplace: 'Remote', employment_type: 'Contract', comp_text: '$160K/yr - $190K/yr', description_text: 'Build agents.' } }, ['semantic']);
  assert.ok(!contract.reasons.includes('salary-below-ft-floor'));
});

test('full-time IC target: a top from the floor up to the target is below target; under the floor, at the target or open-ended is not', async () => {
  const { belowFullTimeTarget } = await import('../scripts/lib/rate.mjs');
  const F = { floor: 200000, target: 300000 };
  assert.deepEqual(belowFullTimeTarget('$200K/yr - $280K/yr', F), { annual: 280000, target: 300000 });
  assert.deepEqual(belowFullTimeTarget('$200,000', F), { annual: 200000, target: 300000 });
  assert.equal(belowFullTimeTarget('$160K/yr - $190K/yr', F), null); // under the floor: a reject, not a flag
  assert.equal(belowFullTimeTarget('$250K/yr - $300K/yr', F), null);
  assert.equal(belowFullTimeTarget('$300K+', F), null);
  assert.equal(belowFullTimeTarget('Depends on Experience', F), null);
  assert.equal(belowFullTimeTarget('$250K', { floor: 200000, target: null }), null);
});

test('pay figures tagged equity or bonus are not salary', async () => {
  const { parseComp, belowFullTimeTarget } = await import('../scripts/lib/rate.mjs');
  assert.equal(parseComp('Base Salary: $287,500; Equity: $396,000; Bonus: $135,000').max, 287500);
  assert.deepEqual(belowFullTimeTarget('Base Salary: $287,500; Equity: $396,000; Bonus: $135,000', { floor: 200000, target: 300000 }), { annual: 287500, target: 300000 });
  assert.equal(parseComp('$150K/yr - $200K/yr + equity').max, 200000);
  assert.equal(parseComp('$250,000-$300,000 Base + Equity').max, 300000);
  assert.equal(parseComp('$180K base, $40K signing bonus').max, 180000);
});
