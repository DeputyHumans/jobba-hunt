// Phenom's apply flow (found on a site:<host> channel by phenomPage): six steps on one page, a react-jsonschema-form
// per step, Next saving each step. The fixtures are scrubbed captures of step 1 "My information" and step 2 "My
// experience" for the synthetic employer Globex, with fixtures/phenom-apply.js standing in for Phenom's form script.
// A real Chromium (no profile, network blocked): CHROME_PATH when set, else the bundled CloakBrowser build (npm run
// setup). Skips when neither is there. Pages load from file:// (show), not setContent: the bundled build never
// settles setContent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PINNED_BINARY } from '../scripts/cloak-core.mjs';
import { markRoot, collectForm, phenomPage } from '../scripts/lib/apply-dom.mjs';
import { planFill, normLabel, alertDetail, phenomStage, phenomNav, COOKIE_DECLINE, entriesLost, uploadName } from '../scripts/lib/apply-forms.mjs';
import { watchDialogs, phenomAwaitResume, selectDirect } from '../scripts/lib/apply-click.mjs';

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
const PHENOM = readFileSync(join(FIX, 'phenom-apply.js'), 'utf8');

let browser;
let pages;
before(async () => {
  pages = mkdtempSync(join(process.env.JOBBA_DATA_DIR || tmpdir(), 'apply-phenom-'));
  if (skip) return;
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
after(async () => { await browser?.close(); if (pages) rmSync(pages, { recursive: true, force: true }); });

// Loads html into the page from a file:// URL (the stand-in for setContent).
let pageN = 0;
async function show(page, html, { waitUntil = 'domcontentloaded' } = {}) {
  const file = join(pages, `page-${pageN++}.html`);
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href, { waitUntil });
}

// The step-1 page with Phenom's stand-in script; `opts` sets its timings (window.PHENOM).
async function step1(fn, opts = {}) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const html = readFileSync(join(FIX, 'phenom-step1.html'), 'utf8').replace('<!-- phenom-apply -->', `<script>window.PHENOM = ${JSON.stringify(opts)};</script><script>${PHENOM}</script>`);
    await show(page, html);
    return await fn(page);
  } finally {
    await page.close();
  }
}

// The synthetic persona (tests/fixtures/workspace/profile/answers.json), trimmed to what these steps ask.
const phenomBank = {
  profile: { first_name: 'Jordan', last_name: 'Example', email: 'jordan@example.com', phone: '+1 555 0100', phone_country: 'United States (+1)', city: 'Springfield, Illinois, United States', country: 'United States', state: 'Illinois', street_address: '1 Main St', zip: '62701' },
  facts: { how_heard: 'LinkedIn' },
  eeo: 'decline',
  learned: [{ label: 'phone device type', answer: 'Mobile', source: 'test' }],
};
// The job's answers (a job's answers.json), keys normLabel'd as the runner does.
const PHENOM_ANSWERS = Object.fromEntries(Object.entries({
  '* By checking this box, I consent to receive transactional and marketing email messages regarding current or future employment opportunities.': 'Yes',
  'By checking this box, I consent to receive transactional and marketing text messages regarding current or future employment opportunities. Text Message and data rates may apply.': 'No',
  "* I acknowledge that I have read and agree to Globex's Global Privacy Notice .": 'Yes',
  'Have you ever been employed OR on assignment as a Contract Worker at Globex or one of its subsidiaries?': 'No',
}).map(([k, v]) => [normLabel(k), v]));

// Phenom draws the whole step as one rjsf <fieldset> whose legend is "You are applying for -"; the radio question
// sits in a div[role=radiogroup][aria-labelledby] of its own (runs once labelled it by the legend).
test('Phenom My information: the Contract Worker radio is named by its own radiogroup, not the step\'s "You are applying for -" legend, and is required; the hidden How did you hear / Source rows are not fields; the job\'s answers plan the radio and the three consent boxes', { skip }, async () => {
  const snap = await step1(async (page) => { await page.evaluate(markRoot, 'form'); return page.evaluate(collectForm); });
  const radio = snap.fields.find((f) => f.kind === 'radio');
  assert.equal(normLabel(radio.label), normLabel('Have you ever been employed OR on assignment as a Contract Worker at Globex or one of its subsidiaries?'));
  assert.equal(radio.required, true);
  assert.deepEqual(radio.options, ['Yes', 'No']);
  assert.ok(!snap.fields.some((f) => /you are applying for/i.test(f.label)), 'no field is labelled by the step legend');
  assert.ok(!snap.fields.some((f) => /how did you hear|^source/i.test(f.label)), 'the hidden source rows are not fields');
  const plan = planFill(snap.fields, phenomBank, { cv: '/tmp/cv.pdf', jobAnswers: PHENOM_ANSWERS });
  const by = (re) => plan.actions.find((a) => re.test(snap.fields.find((f) => f.key === a.key)?.label || ''));
  assert.deepEqual([by(/contract worker/i)?.action, by(/contract worker/i)?.value], ['radio', 'No']);
  assert.equal(by(/email messages/i)?.action, 'check');
  assert.equal(by(/text messages/i)?.action, 'uncheck');
  assert.equal(by(/global privacy notice/i)?.action, 'check');
  assert.equal(by(/upload options/i)?.source, 'cv');
  assert.deepEqual(plan.missing, []);
});

// Every required step-1 field answered by plain Playwright calls (test setup, not the runner's fill).
async function answerStep1(page) {
  await page.fill('#cntryFields\\.firstName', 'Jordan');
  await page.fill('#cntryFields\\.lastName', 'Example');
  await page.fill('#cntryFields\\.postalCode', '62701');
  await page.fill('#email', 'jordan@example.com');
  await page.selectOption('#deviceType', { label: 'Mobile' });
  await page.fill('#phoneWidget\\.phoneNumber', '5550100');
  await page.check('#previousWorker\\.No', { force: true });
  await page.check('#emailAgreement', { force: true });
  await page.check('#globalprivacy', { force: true });
}
const stepOf = (page) => page.evaluate(() => (/current-step-(\S+)/.exec(document.querySelector('.external-job').className) || [])[1]);

// Phenom answers a refused Next with window.alert() (schema common.alertType "browser", showErrorAsAlert true).
// Playwright dismisses an alert no one listens for, so dry runs saw a page that did not move and no message
// ("stuck"). The runner listens: it records the message and dismisses the alert.
test('watchDialogs: Phenom\'s Next without a résumé on file answers with an alert; it is recorded with its text and dismissed, the page stays usable on My information', { skip }, async () => {
  const r = await step1(async (page) => {
    const dialogs = watchDialogs(page);
    await answerStep1(page);
    await page.waitForTimeout(400);
    const t0 = Date.now();
    await page.click('#next');
    await page.waitForTimeout(500);
    return { since: dialogs.since(t0), all: dialogs.seen.length, step: await stepOf(page), alive: await page.evaluate(() => 1 + 1) };
  });
  assert.deepEqual(r.since.map((d) => [d.type, d.message]), [['alert', 'Resume Import is mandatory, Please use any one of the resume upload options.']]);
  assert.equal(r.all, 1);
  assert.equal(r.step, 'personalInformation');
  assert.equal(r.alive, 2);
});

test('alertDetail: a page alert after Next becomes a needs_answers entry with its text as the label, so the run says why the page did not move', () => {
  assert.deepEqual(alertDetail([{ type: 'alert', message: 'Resume Import is mandatory, Please use any one of the resume upload options.', at: 1 }]), [
    { key: null, label: 'Resume Import is mandatory, Please use any one of the resume upload options.', kind: 'alert', options: [], reason: 'alert: the page answered Next with this message (dismissed)' },
  ]);
  assert.deepEqual(alertDetail([]), []);
  // The same message twice (a double press) is one entry.
  assert.equal(alertDetail([{ type: 'alert', message: 'X', at: 1 }, { type: 'alert', message: 'X', at: 2 }]).length, 1);
});

test('phenomPage on step 1: six steps in order, My information current, the résumé slot present and nothing on file, no loader, the cookie banner shown; phenomStage says my-information', { skip }, async () => {
  const p = await step1((page) => page.evaluate(phenomPage));
  assert.equal(p.phenom, true);
  assert.deepEqual(p.steps.map((s) => [s.id, s.label]), [
    ['personalInformation', 'My information'], ['workAndEducation', 'My experience'], ['jobSpecificQuestions', 'Application questions'],
    ['applicationQuestionnaire', 'Additional application questions'], ['voluntaryInformation', 'Voluntary Disclosures'], ['applicationReview', 'Review'],
  ]);
  assert.equal(p.step, 'personalInformation');
  assert.equal(p.upload, true);
  assert.deepEqual(p.resume, { path: false, name: '' });
  assert.equal(p.loading, false);
  assert.equal(p.cookie, true);
  assert.equal(phenomStage(p), 'my-information');
});

test('phenomPage: a page that is not Phenom\'s apply flow says phenom false', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, 'synthetic-greenhouse.html'), 'utf8'));
    assert.equal((await page.evaluate(phenomPage)).phenom, false);
  } finally {
    await page.close();
  }
});

test('phenomStage: each Phenom step id maps to a stage; the thank-you page is submitted; an already-applied or expired notice; a loader or no step yet is loading', () => {
  const at = (step, extra = {}) => phenomStage({ phenom: true, step, loading: false, text: '', url: 'https://careers.example.com/us/en/apply?step=1', ...extra });
  assert.equal(at('personalInformation'), 'my-information');
  assert.equal(at('workAndEducation'), 'my-experience');
  assert.equal(at('jobSpecificQuestions'), 'questions');
  assert.equal(at('applicationQuestionnaire'), 'questions');
  assert.equal(at('supplementaryQuestions'), 'questions');
  assert.equal(at('voluntaryInformation'), 'disclosures');
  assert.equal(at('disabilityInformation'), 'self-identify');
  assert.equal(at('applicationReview'), 'review');
  assert.equal(at('someNewStep'), 'step');
  assert.equal(at('workAndEducation', { loading: true }), 'loading');
  assert.equal(at(null), 'loading');
  assert.equal(at(null, { url: 'https://careers.example.com/us/en/applythankyou?jobSeqNo=X' }), 'submitted');
  // A thank-you text (the schema's atsSpecificData.tankyouMessage).
  assert.equal(at(null, { text: 'Your application is processing. Your information will be in our system shortly.' }), 'submitted');
  assert.equal(at(null, { text: 'You have already applied for this job.' }), 'already-applied');
  assert.equal(at(null, { text: 'Sorry, job has expired.' }), 'closed');
  assert.equal(at(null, { text: 'The job that you were looking for either does not exist or is no longer open.' }), 'closed');
});

test('phenomNav: Next on every step before Review, never Submit there (a Submit is held); on Review only Submit; the résumé upload, Apply With LinkedIn, cloud drives, the step tabs and Previous are never taken', () => {
  const first = ['Upload Resume', 'Dropbox', 'Microsoft online', 'My information', 'My experience', 'Application questions', 'Additional application questions', 'Voluntary Disclosures', 'Review', 'Next'];
  assert.deepEqual(phenomNav(first, 'my-information'), { review: false, submit: null, next: 'Next', held: null });
  assert.deepEqual(phenomNav(['Previous', 'Next'], 'questions'), { review: false, submit: null, next: 'Next', held: null });
  assert.deepEqual(phenomNav(['Previous', 'Submit'], 'disclosures'), { review: false, submit: null, next: null, held: 'Submit' });
  assert.deepEqual(phenomNav(['Edit', 'Previous', 'Submit'], 'review'), { review: true, submit: 'Submit', next: null, held: null });
  // The step tab named "Review" is no Next, and Review with no Submit shows none.
  assert.deepEqual(phenomNav(['Review', 'Previous'], 'review'), { review: true, submit: null, next: null, held: null });
  assert.equal(phenomNav(['Apply With LinkedIn', 'Upload Resume', 'Previous'], 'my-information').next, null);
});

test('COOKIE_DECLINE on a Phenom page: "× Reject all cookies" declines and "✓ Accept all cookies" never matches; plain Decline, Reject all, Only necessary still match; on step 1 the locator finds the Reject button only', { skip }, async () => {
  for (const t of ['Reject all cookies', '× Reject all cookies', 'Decline', 'Reject all', 'Decline all', 'Only necessary', 'Use necessary cookies only', 'Reject']) assert.match(t, COOKIE_DECLINE, t);
  for (const t of ['Accept all cookies', '✓ Accept all cookies', 'Accept', 'Accept all', 'Cookie settings', 'You can change the optional cookie settings here if you wish.']) assert.doesNotMatch(t, COOKIE_DECLINE, t);
  const texts = await step1((page) => page.locator('button').filter({ hasText: COOKIE_DECLINE }).allInnerTexts());
  assert.deepEqual(texts.map((t) => t.replace(/\s+/g, ' ').trim()), ['× Reject all cookies']);
});

const cvFile = () => { const f = join(pages, 'jordan-example-cv.pdf'); if (!existsSync(f)) writeFileSync(f, '%PDF-1.4\n%%EOF\n'); return f; };
const resumeSlot = '.resume-upload-wrapper input[type="file"]';

// The runner's fix for the stuck Next: the CV goes up first, alone, and nothing is typed until Phenom has it on
// record (its hidden resumeRelativePath), the loader is gone, and the form has held still past its 200 ms debounce.
test('phenomAwaitResume: after the CV goes into the résumé slot it waits until Phenom has it on record and the loader is gone, then holds still past the form\'s debounce; fields answered after that keep it and Next moves to My experience, with no alert but the upload\'s', { skip }, async () => {
  const r = await step1(async (page) => {
    const dialogs = watchDialogs(page);
    await page.setInputFiles(resumeSlot, cvFile());
    const loadingAtOnce = (await page.evaluate(phenomPage)).loading;
    const onRecord = await phenomAwaitResume(page, { quietMs: 400 });
    const p = await page.evaluate(phenomPage);
    await answerStep1(page);
    await page.waitForTimeout(400);
    const t0 = Date.now();
    await page.click('#next');
    await page.waitForTimeout(400);
    return { loadingAtOnce, onRecord, p, after: dialogs.since(t0), all: dialogs.seen.map((d) => d.message), next: await page.evaluate(phenomPage) };
  }, { uploadMs: 800 });
  assert.equal(r.loadingAtOnce, true);
  assert.equal(r.onRecord, true);
  assert.deepEqual(r.p.resume, { path: true, name: 'jordan-example-cv.pdf' });
  assert.equal(r.p.loading, false);
  assert.deepEqual(r.all, ['Your resume has been uploaded successfully.']);
  assert.deepEqual(r.after, []);
  assert.equal(r.next.step, 'workAndEducation');
  assert.equal(phenomStage(r.next), 'my-experience');
});

test('phenomAwaitResume: nothing uploaded means nothing on record: false once the wait runs out', { skip }, async () => {
  const t0 = Date.now();
  assert.equal(await step1((page) => phenomAwaitResume(page, { timeoutMs: 1500, stepMs: 200 })), false);
  assert.ok(Date.now() - t0 < 6000);
});

// What a dry run did: a field change landed just before the upload, and its debounced form update wrote the form data
// back without the résumé. The file name still shows (Phenom keeps it apart from the form data), but phenomPage reads
// nothing on record, which is what the runner checks before Next; Next itself answers with the alert.
test('Phenom résumé dropped by a field change made while the upload was in flight: phenomPage shows nothing on record, and Next answers "Resume Import is mandatory"', { skip }, async () => {
  const r = await step1(async (page) => {
    const dialogs = watchDialogs(page);
    await answerStep1(page);
    await page.waitForTimeout(400);
    await page.setInputFiles(resumeSlot, cvFile());
    await page.waitForTimeout(250);
    // A change 50 ms before the upload lands, then quiet: its debounce fires after the upload with the old form data.
    await page.selectOption('#cntryFields\\.region', { label: 'Illinois' });
    await page.waitForTimeout(700);
    const p = await page.evaluate(phenomPage);
    const t0 = Date.now();
    await page.click('#next');
    await page.waitForTimeout(400);
    return { p, after: dialogs.since(t0).map((d) => d.message), step: await stepOf(page) };
  }, { uploadMs: 300 });
  assert.equal(r.p.resume.path, false);
  assert.deepEqual(r.after, ['Resume Import is mandatory, Please use any one of the resume upload options.']);
  assert.equal(r.step, 'personalInformation');
});

// Step 2 "My experience" as the CV parse leaves it: five work entries and a school.
async function step2(fn) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, 'phenom-step2.html'), 'utf8'));
    return await fn(page);
  } finally {
    await page.close();
  }
}
const step2Bank = { ...phenomBank, learned: [...phenomBank.learned, { label: 'school', answer: 'Example State University', source: 'test' }, { label: 'degree', answer: "Master's Degree", source: 'test' }] };

// A run typed the applicant's own city into every employer's Location: the entry ids (experienceData[n].location)
// slipped past the section guard, which knew work-history and education only.
test('Phenom My experience, after the CV parse: the parsed work entries are left as parsed, an employer\'s Location never takes the applicant\'s own city; the Additional attachments slot is named by its section heading and takes the cover letter PDF', { skip }, async () => {
  const snap = await step2(async (page) => { await page.evaluate(markRoot, 'form'); return page.evaluate(collectForm); });
  const exp = snap.fields.filter((f) => /^experienceData\[/.test(f.id || ''));
  assert.equal(exp.filter((f) => /\.title$/.test(f.id)).length, 5);
  const plan = planFill(snap.fields, step2Bank, { cv: '/tmp/cv.pdf', coverPdf: '/tmp/letter.pdf', jobAnswers: PHENOM_ANSWERS });
  const keys = new Set(exp.map((f) => f.key));
  assert.deepEqual(plan.actions.filter((a) => keys.has(a.key)), [], 'no action on a parsed work entry');
  assert.ok(!plan.missing.some((m) => keys.has(m.key)), 'no question about a parsed work entry');
  const slot = snap.fields.find((f) => f.kind === 'file');
  assert.match(slot.label, /^Additional attachments \(Cover Letter, References, etc\.\)/);
  assert.deepEqual(plan.actions.filter((a) => a.action === 'file').map((a) => [a.key, a.source, a.value]), [[slot.key, 'cover', '/tmp/letter.pdf']]);
});

test('entriesLost: a work entry gone after the fill is named, by title and company (a run once lost the second parsed entry while filling); entries renumbered or untouched are not lost', () => {
  const entries = (list) => list.flatMap(([t, c], i) => [{ id: `experienceData[${i}].title`, value: t }, { id: `experienceData[${i}].companyName`, value: c }, { id: `experienceData[${i}].location`, value: '' }]);
  const before = entries([['Role 1', 'Company 1'], ['Role 2', 'Company 2'], ['Role 3', 'Company 3']]);
  assert.deepEqual(entriesLost(before, entries([['Role 1', 'Company 1'], ['Role 3', 'Company 3']])), ['Role 2 @ Company 2']);
  assert.deepEqual(entriesLost(before, before), []);
  assert.deepEqual(entriesLost(before, [...before, ...entries([['Role 1', 'Company 1'], ['Role 2', 'Company 2'], ['Role 3', 'Company 3'], ['Role 4', 'Company 4']]).slice(9)]), []);
  // Education entries count too, by school: a degree the fill picked is no new entry.
  const school = (degree) => [{ id: 'educationData[0].schoolName', value: 'Example State University' }, { id: 'educationData[0].degree', value: degree }];
  assert.deepEqual(entriesLost(school(''), []), ['Example State University']);
  assert.deepEqual(entriesLost(school(''), school("Master's Degree")), []);
});

// Runs lost the second parsed work entry on My experience. Phenom's "Remove experience" buttons are untyped <button>s
// inside the step's form (entry 0 has none), so the first one is the form's default button: an Enter in any field is
// an implicit submission that clicks it. The humanized selectOption ends every dropdown pick with Enter.
const recordClicks = (page) => page.evaluate(() => {
  window.__clicks = [];
  window.__changes = 0;
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { window.__clicks.push(b.id || b.textContent.trim()); e.preventDefault(); } }, true);
  document.addEventListener('change', () => { window.__changes++; }, true);
});
test('selectDirect: a native select on Phenom\'s My experience is set in the page with no key, so nothing clicks the form\'s first button ("Remove experience" of the second entry); an Enter in that field does click it', { skip }, async () => {
  const r = await step2(async (page) => {
    await recordClicks(page);
    const loc = page.locator('[id="educationData[0].degree"]');
    const index = await loc.evaluate((el) => [...el.options].findIndex((o) => o.textContent.trim() === "Master's Degree"));
    const chose = await selectDirect(loc, index);
    const after = await page.evaluate(() => ({ clicks: [...window.__clicks], changes: window.__changes }));
    await loc.focus();
    await page.keyboard.press('Enter');
    return { chose, after, enter: await page.evaluate(() => window.__clicks) };
  });
  assert.equal(r.chose, "Master's Degree");
  assert.deepEqual(r.after, { clicks: [], changes: 1 });
  assert.deepEqual(r.enter, ['work-experience-array-button-remove-1']);
});

// Phenom refused a cover letter with an alert, "The length of file name should be less than or equal to 50
// characters" (its schema's file-name size limit). The runner uploads a copy under a name that fits.
test('uploadName: a file name over the limit loses whole words from the end (and a dangling "and", "of", "the") until it fits, the extension kept; a name that fits is kept', () => {
  assert.equal(uploadName('jordan-example-cover-letter-globex-holdings-and-company.pdf', 50), 'jordan-example-cover-letter-globex-holdings.pdf');
  assert.equal(uploadName('jordan-example-cv-lead-engineer-ai.pdf', 50), 'jordan-example-cv-lead-engineer-ai.pdf');
  assert.ok(uploadName('a'.repeat(80) + '.pdf', 50).length <= 50);
  assert.match(uploadName('a'.repeat(80) + '.pdf', 50), /\.pdf$/);
  assert.equal(uploadName('jordan-example-cover-letter-the-company-of-the-year-2030.pdf', 40), 'jordan-example-cover-letter.pdf');
});
