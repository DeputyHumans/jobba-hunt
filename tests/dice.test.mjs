// Dice source: URL builder, page parsing, the Dice prefilter lane, the per-source loop state,
// and the Dice collectors run in a real Chromium against synthetic pages that copy the three
// card layouts seen live. Browser-backed tests use CHROME_PATH, else the bundled CloakBrowser
// build when `npm run setup` installed it, and skip otherwise.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDiceUrl, postedBucket, unsafeDiceQuery } from '../scripts/lib/dice-url.mjs';
import { normalizeDiceCard, parseDiceBadges, diceStructure, cardTypes, diceApplyTypeOf, diceAlreadyApplied, classifyDicePage, parseDiceResultCount, parseDiceLocationLine, isDiceId, diceJobId, engagementAccept, ENGAGEMENT_TYPES } from '../scripts/lib/dice-extract.mjs';
import { compilePrefilter, prefilterJob } from '../scripts/lib/prefilter.mjs';
import { emptyState, upsertCards, viewCandidates, setPrefilter, sourceState, markQueryRun, recordTick } from '../scripts/lib/state.mjs';
import { isHalted, haltUntil, pickTick } from '../scripts/lib/tick-plan.mjs';
import { evaluateSearch, evaluateView } from '../scripts/lib/guards.mjs';
import { validateTriage, autoApplyBlockers } from '../scripts/lib/triage.mjs';
import { confirmationIn } from '../scripts/lib/apply-forms.mjs';
import { collectDiceCards, collectDiceView, DICE_SEL, DICE_PROFILE } from '../scripts/dice-jobs.mjs';
import { PINNED_BINARY } from '../scripts/cloak-core.mjs';

const tpl = (name) => JSON.parse(readFileSync(new URL(`../templates/workspace/config/${name}`, import.meta.url), 'utf8'));
const cfg = tpl('dice-searches.json');
const PF = tpl('prefilter.json');
// The template ships generic lists; onboarding adds the operator's own. These are injected here.
const pcfg = {
  ...PF,
  ic_title_drop: [...PF.ic_title_drop, '\\bsap\\b', 'salesforce', 'sharepoint'],
  stack_title_drop: ['\\bperl\\b'],
  stack_title_keep: PF.title_ai,
};
const ALL = ['c2c', '1099', 'w2', 'full-time', 'contract', 'part-time'];
const P = compilePrefilter(pcfg, { onsiteMetros: [], accept: ALL, icRateFloor: null, ftSalaryFloor: null });
const G = '11111111-1111-4111-8111-111111111111';

// ---------- URL ----------
test('Dice URL: remote, contract types, posted-date bucket, page', () => {
  const u = new URL(buildDiceUrl(cfg, { keywords: 'python LLM' }, { tprSeconds: 30 * 3600, page: 1 }));
  assert.equal(u.origin + u.pathname, 'https://www.dice.com/jobs');
  assert.equal(u.searchParams.get('q'), 'python LLM');
  assert.equal(u.searchParams.get('countryCode'), 'US');
  assert.equal(u.searchParams.get('filters.workplaceTypes'), 'Remote');
  assert.equal(u.searchParams.get('filters.employmentType'), 'CONTRACTS|PARTTIME|THIRD_PARTY');
  assert.equal(u.searchParams.get('filters.postedDate'), 'THREE');
  assert.equal(u.searchParams.get('page'), '2');
  const any = new URL(buildDiceUrl(cfg, { keywords: 'fractional', employment: 'any' }, { tprSeconds: 3600 }));
  assert.equal(any.searchParams.get('filters.employmentType'), null);
  assert.equal(any.searchParams.get('page'), null);
});

test('posted-date bucket covers the window: 1 day, 3 days, else 7', () => {
  assert.equal(postedBucket(3600), 'ONE');
  assert.equal(postedBucket(86400), 'ONE');
  assert.equal(postedBucket(86401), 'THREE');
  assert.equal(postedBucket(3 * 86400), 'THREE');
  assert.equal(postedBucket(604800), 'SEVEN');
});

test('quoted phrases joined by OR are refused before they reach Dice (the firewall answers 403)', () => {
  assert.equal(unsafeDiceQuery('"VP of Engineering" OR "Head of Engineering"'), true);
  assert.equal(unsafeDiceQuery('"fractional CTO"'), false);
  assert.equal(unsafeDiceQuery('fractional OR interim'), false);
  assert.throws(() => buildDiceUrl(cfg, { keywords: '"head of AI" OR "director of AI"' }, { tprSeconds: 3600 }), /403/);
});

test('the Dice query config never holds a quoted-OR query', () => {
  for (const q of [cfg.canary, ...cfg.queries]) assert.equal(unsafeDiceQuery(q.keywords), false, q.id);
});

// ---------- parsing ----------
test('cards: title from the aria label, company from companyname=, "null" pay dropped', () => {
  const c = normalizeDiceCard({ guid: G, title: '', aria: 'View Details for Lead Engineer (0123456789abcdef0123456789abcdef)', company: '', companyHref: '/company-profile/x?companyname=Example%20Staffing%20LLC', metaTexts: ['Remote or Hybrid in Chicago, Illinois', '•', 'Today'], easy: true, typeText: 'Third Party, Contract', payText: 'null' });
  assert.equal(c.job_id, `dice-${G}`);
  assert.equal(c.source, 'dice');
  assert.equal(c.url, `https://www.dice.com/job-detail/${G}`);
  assert.equal(c.title, 'Lead Engineer');
  assert.equal(c.company, 'Example Staffing LLC');
  assert.equal(c.location, 'Remote or Hybrid in Chicago, Illinois');
  assert.equal(c.posted_text, 'Today');
  assert.equal(c.pay_text, null);
  assert.equal(c.easy_apply, true);
  assert.equal(normalizeDiceCard({ guid: 'not-a-guid' }), null);
});

test('badges: contract types, workplace, duration, travel, pay', () => {
  const b = parseDiceBadges(['Contract Independent', 'Contract W2', 'Contract Corp To Corp', '12 Months', 'Occasional Travel Required', 'On-site', '$70/hr'], { locationType: 'On-site' });
  assert.deepEqual(b.contract_types.sort(), ['1099', 'c2c', 'w2']);
  assert.equal(b.workplace, 'On-site');
  assert.equal(b.duration, '12 Months');
  assert.equal(b.travel, 'Occasional Travel Required');
  assert.equal(b.comp_text, '$70/hr');
});

test('G1 on Dice with every structure accepted: C2C, 1099 or Third Party pass; W2-only and full-time go to triage', () => {
  assert.equal(diceStructure(['w2', 'c2c'], ALL), 'ok');
  assert.equal(diceStructure(['1099'], ALL), 'ok');
  assert.equal(diceStructure(cardTypes('Third Party, Contract'), ALL), 'ok');
  assert.equal(diceStructure(['w2'], ALL), 'w2-only');
  assert.equal(diceStructure(cardTypes('Full-time'), ALL), 'full-time');
  assert.equal(diceStructure(cardTypes('Full-time, Third Party'), ALL), 'ok');
  assert.equal(diceStructure(cardTypes('Contract'), ALL), 'unclear');
});

test('G1 on Dice reads engagement.accept: a structure outside it is excluded', () => {
  const indep = ['c2c', '1099'];
  assert.equal(diceStructure(['w2'], indep), 'excluded');
  assert.equal(diceStructure(cardTypes('Full-time'), indep), 'excluded');
  assert.equal(diceStructure(['w2', 'c2c'], indep), 'ok');
  assert.equal(diceStructure(cardTypes('Contract'), indep), 'unclear', 'a plain Contract badge may still be C2C');
  const ftOnly = ['full-time'];
  assert.equal(diceStructure(['c2c'], ftOnly), 'excluded');
  assert.equal(diceStructure(cardTypes('Contract'), ftOnly), 'excluded');
  assert.equal(diceStructure(cardTypes('Full-time'), ftOnly), 'full-time');
  assert.equal(diceStructure(['w2', '1099'], ['w2']), 'w2-only');
  assert.equal(diceStructure([], indep), 'unclear');
  // Without an explicit list the workspace preferences decide (the shipped template accepts all six).
  assert.deepEqual(engagementAccept({ engagement: { accept: ['C2C', '1099'] } }), ['c2c', '1099']);
  assert.deepEqual(engagementAccept({}), ENGAGEMENT_TYPES);
});

test('apply control: Easy Apply wizard, external link, already applied', () => {
  assert.deepEqual(diceApplyTypeOf({ label: 'Easy Apply', href: `/job-applications/${G}/wizard` }), { type: 'dice-easy', url: `https://www.dice.com/job-applications/${G}/wizard` });
  assert.equal(diceApplyTypeOf({ label: 'Apply Now', href: 'https://example.com/jobs/1' }).type, 'external');
  assert.equal(diceApplyTypeOf({ label: 'Applied', href: null }), null);
  assert.deepEqual(diceApplyTypeOf({ label: 'Continue Application', href: `/job-applications/${G}/wizard` }), { type: 'dice-easy', url: `https://www.dice.com/job-applications/${G}/wizard`, draft: true });
  assert.equal(diceAlreadyApplied({ label: 'Applied', headerText: '' }), true);
  assert.equal(diceAlreadyApplied({ label: 'Easy Apply', headerText: 'Remote • Posted 3 hours ago' }), false);
});

test('page verdicts: 403 blocked, challenge checkpoint, login, empty, suspect, ok', () => {
  assert.equal(classifyDicePage({ title: '403 Forbidden', text: '403 Forbidden' }), 'blocked');
  assert.equal(classifyDicePage({ title: 'Just a moment...', text: '' }), 'checkpoint');
  assert.equal(classifyDicePage({ title: 'Dice', text: '', loggedOut: true }), 'login');
  assert.equal(classifyDicePage({ title: 'Search Jobs | Dice.com', text: '0 results found', emptyMarker: true }), 'empty');
  assert.equal(classifyDicePage({ title: 'Search Jobs | Dice.com', text: '', cardCount: 0 }), 'suspect');
  assert.equal(classifyDicePage({ title: 'Search Jobs | Dice.com', text: '', cardCount: 3 }), 'ok');
  assert.equal(parseDiceResultCount('58 results (20 new)'), 58);
  assert.deepEqual(parseDiceLocationLine('Hybrid in Chicago, IL, US • Posted 7 hours ago • Updated 3 hours ago'), { location: 'Hybrid in Chicago, IL, US', posted_text: '7 hours ago' });
});

test('guards: a Dice 403 aborts searches and views', () => {
  assert.equal(evaluateSearch({ status: 'blocked' }, { canary: false, suspectStreak: 0 }).abort, 'blocked');
  assert.equal(evaluateView({ status: 'blocked' }, { unreadableStreak: 0 }).abort, 'blocked');
});

// ---------- prefilter lane ----------
const card = (title, extra = {}) => ({ job_id: diceJobId(G), source: 'dice', title, company: 'Example Staffing LLC', location: 'Remote', card: { employment_type: 'Third Party, Contract' }, ...extra });

test('Dice titles: senior hands-on passes; mid-level, support desks and unclaimed platforms drop', () => {
  assert.notEqual(prefilterJob(card('Lead Full Stack Engineer'), P).verdict, 'drop');
  assert.notEqual(prefilterJob(card('Principal Engineer, AI'), P).verdict, 'drop');
  assert.notEqual(prefilterJob(card('Fractional CTO'), P).verdict, 'drop');
  assert.deepEqual(prefilterJob(card('Python Developer'), P).reasons, ['not-senior']);
  assert.ok(prefilterJob(card('Senior Desktop Support Engineer'), P).reasons.includes('outside-record'));
  assert.ok(prefilterJob(card('Senior SAP PLM Solution Architect'), P).reasons.includes('outside-record'));
  assert.ok(prefilterJob(card('Junior React Developer'), P).reasons.includes('title-excluded'));
});

test('Dice G1: W2-only titles and full-time cards go to review when accepted; LinkedIn rules unchanged', () => {
  for (const t of ['Senior AI Engineer (Only W2)', 'W2- Lead AI Engineer']) {
    const r = prefilterJob(card(t), P);
    assert.ok(r.reasons.includes('w2-only'));
    assert.notEqual(r.verdict, 'drop');
  }
  assert.ok(prefilterJob(card('Lead Engineer', { card: { employment_type: 'Full-time' } }), P).reasons.includes('full-time-ic-ask'));
  assert.ok(prefilterJob(card('Lead Engineer', { card: { employment_type: 'Contract' } }), P).reasons.includes('contract-type-unconfirmed'));
  // Outside engagement.accept, the same postings drop.
  const indep = compilePrefilter(pcfg, { onsiteMetros: [], accept: ['c2c', '1099'], icRateFloor: null, ftSalaryFloor: null });
  assert.ok(prefilterJob(card('Senior AI Engineer (Only W2)'), indep).reasons.includes('structure-excluded'));
  assert.ok(prefilterJob(card('Lead Engineer', { card: { employment_type: 'Full-time' } }), indep).reasons.includes('structure-excluded'));
  assert.equal(prefilterJob(card('Lead Engineer'), indep).verdict, 'keep');
  // The aggregator flag stays a LinkedIn signal.
  assert.deepEqual(prefilterJob(card('Lead Engineer', { company: 'Dice' }), P).flags, []);
  // LinkedIn hands-on lane: a senior engineering title passes; a senior non-engineering one does not.
  const li = (title) => ({ job_id: '9000000001', title, company: 'Acme Corp', location: 'United States (Remote)' });
  assert.ok(!prefilterJob(li('Senior Software Engineer'), P).reasons.includes('not-senior'));
  assert.ok(prefilterJob(li('Senior Product Manager'), P).reasons.includes('not-senior'));
  assert.ok(prefilterJob(li('Software Engineer'), P).reasons.includes('not-senior'));
  assert.ok(prefilterJob(li('Senior Salesforce Developer'), P).reasons.includes('outside-record'));
  assert.ok(prefilterJob(li('SharePoint SPFx Technical Architect'), P).reasons.includes('outside-record'));
  assert.ok(!prefilterJob(li('Head of Salesforce Engineering'), P).reasons.includes('outside-record')); // exec titles keep the leadership rubric
});

test('Dice G1/G2 after the view: badges decide; an On-site badge drops a "Remote or Hybrid" card', () => {
  const detail = (types, workplace) => ({ contract_types: types, workplace, description_text: 'x'.repeat(200) });
  assert.equal(prefilterJob(card('Lead Engineer', { location: 'Remote or Hybrid in Chicago', detail: detail(['c2c', 'w2'], 'Remote') }), P).verdict, 'keep');
  assert.ok(prefilterJob(card('Lead Engineer', { location: 'Remote or Hybrid in Chicago', detail: detail(['c2c'], 'On-site') }), P).reasons.includes('onsite'));
  const w2 = prefilterJob(card('Lead Engineer', { detail: detail(['w2'], 'Remote') }), P);
  assert.ok(w2.reasons.includes('w2-only'));
  assert.equal(w2.verdict, 'review');
  assert.ok(prefilterJob(card('Lead Engineer', { detail: detail(['c2c'], 'Hybrid') }), P).reasons.includes('hybrid-check-travel'));
});

// ---------- state ----------
test('Dice cards land in the shared state with their source; views stay per source', () => {
  const s = emptyState();
  upsertCards(s, [{ job_id: '9000000001', title: 'Fractional CTO', company: 'Acme Corp', location: 'Remote' }], { queryId: 'q', scope: 'fractional', sweepId: 'r1', now: '2026-10-29T15:00:00Z' });
  upsertCards(s, [{ ...card('Lead Engineer'), url: `https://www.dice.com/job-detail/${G}`, employment_type: 'Third Party, Contract', easy_apply: true }], { queryId: 'dice-canary', scope: 'dice', sweepId: 'r2', now: '2026-10-29T15:01:00Z' });
  assert.equal(s.jobs['9000000001'].source, 'linkedin');
  assert.equal(s.jobs[diceJobId(G)].source, 'dice');
  assert.equal(s.jobs[diceJobId(G)].card.easy_apply, true);
  for (const id of Object.keys(s.jobs)) setPrefilter(s, id, { verdict: 'keep', reasons: [], flags: [] });
  assert.deepEqual(viewCandidates(s, { limit: 10 }), ['9000000001']);
  assert.deepEqual(viewCandidates(s, { limit: 10, source: 'dice' }), [diceJobId(G)]);
});

test('a Dice abort halts Dice only; Dice keeps its own query windows and canary counter', () => {
  const s = emptyState();
  const d = sourceState(s, 'dice');
  const now = Date.parse('2026-10-29T16:00:00Z');
  d.halt_until = haltUntil('blocked', now, 'America/Chicago', 4);
  assert.equal(isHalted(d, now), true);
  assert.equal(isHalted(s, now), false);
  markQueryRun(d, 'dice-canary', '2026-10-29T15:00:00Z');
  recordTick(d, { kind: 'canary', id: 'dice-canary', at: '2026-10-29T15:00:00Z' });
  assert.equal(s.query_runs['dice-canary'], undefined);
  assert.equal(d.ticks_since_canary, 0);
  assert.equal(s.ticks_since_canary, null);
  assert.equal(pickTick(cfg, sourceState(emptyState(), 'dice'), now).id, cfg.canary.id);
});

// ---------- triage ----------
test('triage accepts Dice IDs and the lane field', () => {
  const r = { job_id: diceJobId(G), score: 82, gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, why_fit: [], gaps: [], red_flags: [], lane: 'hands-on' };
  assert.deepEqual(validateTriage(r), []);
  assert.ok(validateTriage({ ...r, lane: 'ic' }).some((e) => /lane/.test(e)));
  assert.ok(validateTriage({ ...r, job_id: 'dice-123' }).some((e) => /job_id/.test(e)));
});

test('auto-apply: Dice Easy Apply is blocked until the channel is verified and listed', () => {
  const j = { job_id: diceJobId(G), source: 'dice', triage: { score: 85, gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass' }, decision: null }, detail: { apply: { type: 'dice-easy' } } };
  const rule = { min_score: 75, channels: ['easy'], min_cv_coverage: 60 };
  assert.ok(autoApplyBlockers(j, rule, { coverage: 80, cvExists: true, verified: false }).some((b) => /dice-easy is not auto-applied/.test(b)));
  assert.ok(autoApplyBlockers(j, { ...rule, channels: ['easy', 'dice-easy'] }, { coverage: 80, cvExists: true, verified: false }).some((b) => /not verified/.test(b)));
  assert.deepEqual(autoApplyBlockers(j, { ...rule, channels: ['easy', 'dice-easy'] }, { coverage: 80, cvExists: true, verified: true }), []);
});

// ---------- collectors in a real Chromium ----------
async function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const { binaryInfo } = await import('cloakbrowser');
    const b = binaryInfo(PINNED_BINARY);
    return b.installed ? b.binaryPath : null;
  } catch { return null; }
}
const CHROME = await chromiumPath();
const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const skip = !(CHROME && existsSync(CHROME)) && 'no Chromium (set CHROME_PATH or run npm run setup)';
let browser;
before(async () => {
  if (skip) return;
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
after(async () => { await browser?.close(); });
// Loaded from file:// with every network request aborted. Not setContent: the bundled
// CloakBrowser build never settles it.
async function load(file) {
  const page = await browser.newPage();
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto(pathToFileURL(join(FIX, file)).href, { waitUntil: 'domcontentloaded' });
  return page;
}

test('search collector reads all three card layouts', { skip }, async () => {
  const page = await load('synthetic-dice-search.html');
  const s = await page.evaluate(collectDiceCards, DICE_SEL);
  const cards = s.cards.map(normalizeDiceCard);
  assert.equal(s.signedIn, true);
  assert.equal(parseDiceResultCount(s.countText), 3);
  assert.deepEqual(cards.map((c) => [c.title, c.company, c.location, c.posted_text, c.employment_type, c.easy_apply]), [
    ['Lead Full Stack Engineer', 'Example Staffing LLC', 'Remote', 'Today', 'Third Party, Contract', true],
    ['AI Architect', 'Sample Tech Inc.', 'Remote or Hybrid in Chicago, Illinois', 'Yesterday', 'Contract', false],
    ['Senior .NET Developer', 'Grouped Partners', 'Remote', '2d ago', 'Full-time', true],
  ]);
  assert.match(cards[1].snippet, /^Job Title: AI Architect/);
  assert.equal(cards[1].pay_text, null);
  await page.close();
});

test('search collector sees the no-results marker', { skip }, async () => {
  const page = await load('synthetic-dice-empty.html');
  const s = await page.evaluate(collectDiceCards, DICE_SEL);
  assert.equal(s.cards.length, 0);
  assert.equal(classifyDicePage({ title: s.title, text: s.text, loggedOut: !s.signedIn, cardCount: 0, emptyMarker: s.emptyMarker }), 'empty');
  await page.close();
});

test('job page collector: header, badges, apply link, description from structured data', { skip }, async () => {
  const page = await load('synthetic-dice-view.html');
  const v = await page.evaluate(collectDiceView, DICE_SEL);
  assert.equal(v.title, 'Lead Full Stack Engineer');
  assert.equal(v.company, 'Example Staffing LLC');
  assert.equal(v.signed_in, true);
  assert.deepEqual(parseDiceLocationLine(v.loc_line), { location: 'Remote', posted_text: '3 hours ago' });
  const b = parseDiceBadges(v.badges, { locationType: v.location_type });
  assert.deepEqual(b.contract_types.sort(), ['1099', 'c2c', 'w2']);
  assert.equal(b.workplace, 'Remote');
  assert.equal(b.duration, '6 Months');
  assert.equal(diceApplyTypeOf({ label: v.apply_label, href: v.apply_href }).type, 'dice-easy');
  assert.match(v.description_text, /hands-on lead who builds with TypeScript/);
  assert.match(v.description_text, /- C2C or 1099 welcome/);
  assert.equal(isDiceId(diceJobId(G)), true);
  await page.close();
});

// Wizard slots: copies of the live step 1 and review markup. The "draft" page is the state that
// was once misread as an empty cover slot: both slots occupied, "Optional" run into the cover
// card's text.
test('wizard slots: profile resume with an empty cover slot and its upload input', { skip }, async () => {
  const { diceSlot } = await import('../scripts/lib/apply-dom.mjs');
  const page = await load('synthetic-dice-wizard-empty-cover.html');
  const r = await page.evaluate(diceSlot, 'resume');
  const c = await page.evaluate(diceSlot, 'cover');
  assert.deepEqual([r.file, r.hasOptions, r.hasInput], ['jordan-example-cv-fractional-cto-ai.pdf', true, false]);
  assert.deepEqual([c.file, c.hasOptions, c.hasInput], [null, false, true]);
  await page.close();
});

test('wizard slots: both occupied, each card read on its own (no "Optional" run-in)', { skip }, async () => {
  const { diceSlot } = await import('../scripts/lib/apply-dom.mjs');
  const page = await load('synthetic-dice-wizard-draft.html');
  const r = await page.evaluate(diceSlot, 'resume');
  const c = await page.evaluate(diceSlot, 'cover');
  assert.equal(r.file, 'jordan-example-cv-lead-engineer-ai.pdf');
  assert.equal(c.file, 'jordan-example-cv-lead-engineer-ai.pdf');
  assert.equal(c.hasOptions, true);
  assert.equal(await page.locator('[data-hunt-cover-opts]').count(), 1);
  await page.close();
});

test('review step: resume and cover letter cards by their test ids', { skip }, async () => {
  const { diceSlot } = await import('../scripts/lib/apply-dom.mjs');
  const page = await load('synthetic-dice-review.html');
  assert.equal((await page.evaluate(diceSlot, 'resume')).file, 'jordan-example-cv-lead-engineer-ai.pdf');
  assert.equal((await page.evaluate(diceSlot, 'cover')).file, 'jordan-example-cover-letter-example-co.pdf');
  await page.close();
});

test("Dice's confirmation page counts as a confirmed submit", () => {
  assert.equal(confirmationIn('Hooray! Your application is on its way! 🥳 You can find the job listing for this role in your Applied Jobs.'), true);
  assert.equal(confirmationIn('Thank you for submitting! Explore more opportunities on our careers site'), true);
  assert.equal(confirmationIn('Review your application. Once you submit, this action cannot be undone.'), false);
});

test('sign-in markers: a narrow header with only "Log Out" is signed in; an explicit Log in link is signed out', { skip }, async () => {
  const narrow = await load('synthetic-dice-search-narrow.html');
  const a = await narrow.evaluate(collectDiceCards, DICE_SEL);
  assert.deepEqual([a.signedIn, a.signedOut, a.cards.length], [true, false, 3]);
  assert.equal(classifyDicePage({ title: a.title, text: a.text, loggedOut: a.signedOut && !a.signedIn, cardCount: a.cards.length }), 'ok');
  await narrow.close();
  const out = await load('synthetic-dice-signed-out.html');
  const b = await out.evaluate(collectDiceCards, DICE_SEL);
  assert.deepEqual([b.signedIn, b.signedOut], [false, true]);
  assert.equal(classifyDicePage({ title: b.title, text: b.text, loggedOut: b.signedOut && !b.signedIn, cardCount: 0 }), 'login');
  await out.close();
});

test('stack_title_drop rules a stack out on both sources before a view; titles matching stack_title_keep and exec titles stay', () => {
  const li = (title) => ({ job_id: '9000000002', title, company: 'Acme Corp', location: 'United States (Remote)' });
  for (const t of ['Sr. Perl Full Stack Developer', 'Lead Perl Architect- Prefer defense experience (100% Remote)']) {
    const r = prefilterJob(card(t), P);
    assert.equal(r.verdict, 'drop', t);
    assert.ok(r.reasons.includes('stack-excluded'), t);
  }
  assert.ok(prefilterJob(li('Senior Perl Engineer'), P).reasons.includes('stack-excluded'));
  for (const t of ['Senior AI Engineer (Python/Perl)', 'Lead Perl Engineer, Agentic AI', 'Principal LLM Engineer - Perl']) assert.ok(!prefilterJob(card(t), P).reasons.includes('stack-excluded'), t);
  assert.ok(!prefilterJob(card('Senior Python Developer'), P).reasons.includes('stack-excluded'));
  assert.ok(!prefilterJob(li('Director of Perl Engineering'), P).reasons.includes('stack-excluded'));
});

test('the shipped search configs are unverified, and the Dice profile lives under the browser profile dir', () => {
  assert.equal(cfg.verified, false);
  assert.equal(tpl('searches.json').verified, false);
  assert.equal(DICE_PROFILE, join(process.env.CLOAK_PROFILE_DIR, 'dice'));
});

test('full-time leadership goes to review as full-time-ask, full-time IC as full-time-ic-ask', () => {
  const li = (title, et) => ({ job_id: '9000000003', title, company: 'Acme Corp', location: 'United States (Remote)', detail: { employment_type: et, workplace: 'Remote', description_text: 'Lead our engineering team.' } });
  for (const t of ['Chief Technology Officer (CTO), Artificial Intelligence (AI) Required, Work From Home', 'VP of Engineering', 'Head of AI']) {
    const r = prefilterJob(li(t, 'Full-time'), P, { scopes: ['semantic'] });
    assert.equal(r.verdict, 'review', t);
    assert.ok(r.reasons.includes('full-time-ask'), t);
  }
  assert.ok(prefilterJob(li('Senior Software Engineer', 'Full-time'), P, { scopes: ['semantic'] }).reasons.includes('full-time-ic-ask'));
  assert.ok(prefilterJob(card('CTO', { card: { employment_type: 'Full-time' } }), P).reasons.includes('full-time-ask'));
  assert.ok(prefilterJob(card('Lead Engineer', { card: { employment_type: 'Full-time' } }), P).reasons.includes('full-time-ic-ask'));
});
