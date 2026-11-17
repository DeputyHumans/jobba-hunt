// Runs the browser-side apply collectors in a real Chromium (no profile, network blocked) against
// synthetic forms: CHROME_PATH when set, else the bundled CloakBrowser build (npm run setup). Skips
// when neither is there. Pages load from file:// (show), not setContent: the bundled build never
// settles setContent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PINNED_BINARY } from '../scripts/cloak-core.mjs';
import { markRoot, collectForm, passInterstitial, stuckReport, invalidReport, workdayPage, safeHtml, workdayFields, walmartPage, WALMART_SEL, icimsPage, ICIMS_SEL } from '../scripts/lib/apply-dom.mjs';
import { planFill, resumeChoice, followBoxesChecked, normLabel, eeoPick, submitLabel, workdayStage, workdayStartChoice, workdayPlan, workdayAdds, walmartStage, walmartNav, icimsStage, icimsNav, blockerIn, challengeIn, icimsPlan } from '../scripts/lib/apply-forms.mjs';
import { checkLabelRadio, pickWidget, setBox, pressToggle, tickGroupOption, tickGroupOptions, menuOptions, wdListOptions, wdPickList, wdPickPrompt, wdTypeDate, wdAddEntry, wdCheckOption, framed, icimsPick, icimsPickOther, rsPick, rsPickOther, rsShown, rsRow } from '../scripts/lib/apply-click.mjs';

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
// The synthetic persona (tests/fixtures/workspace/profile/answers.json), trimmed to what these forms ask.
const bank = {
  profile: { first_name: 'Jordan', last_name: 'Example', email: 'jordan@example.com', phone: '', linkedin: 'https://www.linkedin.com/in/jordan-example', country: 'United States' },
  facts: { work_authorization: 'Yes' },
  eeo: 'decline',
  learned: [],
};
// Explicit EEO answers (injected; the workspace default is decline for every category).
const EEO = { gender: 'Female', race: 'Asian', hispanic: 'No', veteran: 'No', disability: 'No' };

let browser;
let pages;
before(async () => {
  if (skip) return;
  pages = mkdtempSync(join(process.env.JOBBA_DATA_DIR || tmpdir(), 'apply-dom-'));
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
after(async () => { await browser?.close(); if (pages) rmSync(pages, { recursive: true, force: true }); });

// Loads html into the page from a file:// URL (the stand-in for setContent).
let pageN = 0;
async function show(page, html, { waitUntil = 'load' } = {}) {
  const file = join(pages, `page-${pageN++}.html`);
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href, { waitUntil });
}

async function snapshot(file, kind) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, file), 'utf8'), { waitUntil: 'domcontentloaded' });
    const marked = await page.evaluate(markRoot, kind);
    const snap = await page.evaluate(collectForm);
    const keyed = await page.locator('[data-hunt-key]').count();
    return { marked, snap, keyed };
  } finally {
    await page.close();
  }
}

test('Easy Apply step: dialog root, deduped legend, hidden radios, errors, follow box, buttons', { skip }, async () => {
  const { marked, snap, keyed } = await snapshot('synthetic-easy-apply.html', 'dialog');
  assert.equal(marked, true);
  const byLabel = Object.fromEntries(snap.fields.map((f) => [f.label, f]));
  assert.deepEqual(Object.keys(byLabel), [
    'Email address', 'Mobile phone number', 'Are you legally authorized to work in the United States?',
    'How many years of work experience do you have with Supabase?', 'Upload resume', 'Follow Acme to stay up to date with their page.',
  ]);
  const wa = byLabel['Are you legally authorized to work in the United States?'];
  assert.equal(wa.kind, 'radio');
  assert.deepEqual(wa.options, ['Yes', 'No']);
  assert.equal(wa.required, true);
  assert.equal(byLabel['Email address'].value, 'jordan@example.com');
  assert.match(byLabel['How many years of work experience do you have with Supabase?'].error, /whole number/);
  assert.equal(byLabel['Follow Acme to stay up to date with their page.'].value, 'on');
  assert.ok(snap.buttons.includes('Continue to next step'));
  assert.equal(keyed, 7); // 5 single controls + 2 radio options

  const plan = planFill(snap.fields, bank, { cv: '/tmp/cv.pdf' });
  assert.deepEqual(plan.missing.map((m) => m.label).sort(), ['How many years of work experience do you have with Supabase?', 'Mobile phone number']);
  assert.ok(plan.actions.some((a) => a.action === 'uncheck' && a.source === 'never-follow'));
  assert.ok(plan.actions.some((a) => a.action === 'radio' && a.value === 'Yes'));
});

test('Greenhouse-style form: form root, required markers, hidden resume input, EEO decline, invisible reCAPTCHA', { skip }, async () => {
  const { marked, snap } = await snapshot('synthetic-greenhouse.html', 'form');
  assert.equal(marked, true);
  const labels = snap.fields.map((f) => f.label);
  assert.deepEqual(labels, ['First Name*', 'Last Name*', 'Email*', 'Resume/CV*', 'LinkedIn Profile', 'Cover Letter', 'Gender', 'Veteran Status']);
  assert.equal(snap.fields.find((f) => f.label === 'Resume/CV*').kind, 'file');
  assert.equal(snap.fields.find((f) => f.label === 'First Name*').required, true);
  const plan = planFill(snap.fields, bank, { cv: '/tmp/cv.pdf', coverNote: 'Hi team' });
  assert.deepEqual(plan.missing, []);
  const v = Object.fromEntries(plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).label, a.value]));
  assert.equal(v['Gender'], 'Decline To Self Identify');
  assert.equal(v['Veteran Status'], "I don't wish to answer");
  assert.equal(v['Cover Letter'], 'Hi team');
  assert.equal(v['Resume/CV*'], '/tmp/cv.pdf');
});

test('account portal: a password field is flagged', { skip }, async () => {
  const { snap } = await snapshot('synthetic-lever-account.html', 'form');
  assert.equal(snap.hasPassword, true);
});

test('LinkedIn resume picker (live markup): role=radio cards labelled by aria-label, hidden inputs with empty labels', { skip }, async () => {
  const { snap } = await snapshot('synthetic-easy-apply-resume.html', 'dialog');
  const picker = snap.fields.find((f) => f.kind === 'radio');
  assert.deepEqual(picker.options, ['Jordan Example – VP of Engineering.pdf', 'Jordan Example – CTO.pdf']);
  assert.equal(picker.value, 'Jordan Example – VP of Engineering.pdf');
  assert.ok(snap.buttons.includes('Upload resume'));
  assert.ok(snap.buttons.includes('Submit application'));
  assert.equal(resumeChoice(snap.fields, 'jordan-example-cv-fractional-cto.pdf').status, 'missing');
  const follow = snap.fields.find((f) => /follow/i.test(f.label));
  assert.equal(follow.label, 'Follow Acme to stay up to date with their page'); // input 5 levels inside the role=checkbox card
  assert.equal(follow.value, 'on'); // from aria-checked
  assert.deepEqual(followBoxesChecked(snap.fields).map((f) => f.label), ['Follow Acme to stay up to date with their page']);
  const plan = planFill(snap.fields, bank, { cv: '/tmp/cv.pdf' });
  assert.deepEqual(plan.missing, []); // "Mark job as a top choice" is optional and stays unticked
  assert.deepEqual(plan.actions.map((a) => a.source), ['never-follow']);
});

test('safety reminder interstitial: "Continue applying" is found by visible text despite a longer aria-label', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, 'synthetic-safety-reminder.html'), 'utf8'), { waitUntil: 'domcontentloaded' });
    assert.equal(await page.evaluate(passInterstitial), true);
    assert.equal(await page.evaluate(() => document.body.getAttribute('data-continued')), '1');
    assert.equal(await page.evaluate(markRoot, 'dialog'), false); // the reminder is not an application dialog
  } finally {
    await page.close();
  }
});

test('Easy Apply question (live markup): card aria-label is the question, visible text is the option; label from the preceding <p>', { skip }, async () => {
  const { snap } = await snapshot('synthetic-easy-apply-question.html', 'dialog');
  const q = snap.fields.find((f) => f.kind === 'radio');
  assert.equal(q.label, 'Have you worked in financial services previously?*');
  assert.deepEqual(q.options, ['Yes', 'No']);
  assert.equal(q.required, true);
  assert.equal(q.value, '');
  const plan = planFill(snap.fields, bank, { cv: '/tmp/cv.pdf' });
  assert.deepEqual(plan.missing.map((m) => [m.label, m.reason]), [['Have you worked in financial services previously?*', 'no-answer']]);
  const learned = { ...bank, learned: [{ label: 'have you worked in financial services previously', answer: 'Yes', source: 't' }] };
  assert.deepEqual(planFill(snap.fields, learned, { cv: '/tmp/cv.pdf' }).actions.map((a) => [a.action, a.value]), [['radio', 'Yes']]);
});

test('appcast applyboard: labels come from the text block above each field', { skip }, async () => {
  const page = await browser.newPage();
  await show(page, readFileSync(join(FIX, 'synthetic-appcast-step1.html'), 'utf8'));
  await page.evaluate(markRoot, 'form');
  const snap = await page.evaluate(collectForm);
  const labels = snap.fields.filter((f) => f.kind !== 'select' || /residence/i.test(f.label)).map((f) => f.label);
  assert.deepEqual(labels, ['Legal First Name *', 'Legal Last Name *', 'Email *', 'Phone *', 'Zip code *', 'Place of Residence *', 'City *', 'Address *']);
  assert.ok(snap.fields.filter((f) => labels.includes(f.label)).every((f) => f.required));
  await page.close();
});

test('Easy Apply 2026 radios: option text from the sibling <p>, not the repeated question', { skip }, async () => {
  const { snap } = await snapshot('synthetic-easy-apply-2026-radios.html', 'dialog');
  const opts = (q) => snap.fields.find((f) => f.label.startsWith(q)).options;
  assert.deepEqual(opts('Do you possess 5 years or more of Python experience?'), ['Yes', 'No']);
  assert.deepEqual(opts('Will You Now or in the Future Require Sponsorship to Work in the U.S.?'), ['Yes', 'No']);
});

test('Easy Apply 2026 EEO: the shared aria-label or aria-labelledby is the question, not the boilerplate above it; decline is planned', { skip }, async () => {
  const { snap } = await snapshot('synthetic-easy-apply-2026-eeo.html', 'dialog');
  const race = snap.fields.find((f) => f.label === 'Race/Ethnicity');
  const dis = snap.fields.find((f) => f.label === 'Disability');
  assert.ok(race && dis, JSON.stringify(snap.fields.map((f) => f.label)));
  assert.equal(race.value, 'Asian (Not Hispanic or Latino)');
  const plan = planFill(snap.fields, { ...bank, eeo: 'decline' }, { cv: '/tmp/cv.pdf' });
  const by = Object.fromEntries(plan.actions.map((a) => [a.key, a.value]));
  assert.equal(by[race.key], 'I prefer not to specify');
  assert.match(by[dis.key], /I do not want to answer$/);
});

test('LinkedIn 2026 checkbox group: each box takes the option text after it; learned options get checked', { skip }, async () => {
  const { snap } = await snapshot('synthetic-checkbox-group.html', 'dialog');
  const boxes = snap.fields.filter((f) => f.kind === 'checkbox');
  assert.deepEqual(boxes.map((f) => f.label), ['Consultancy, agency, or professional services firm', 'Startup where you were a founder or one of the first 20 employees', 'In-house engineering team at a large enterprise', 'None of the above']);
  const learned = [{ label: 'Consultancy, agency, or professional services firm', answer: 'Yes' }, { label: 'Startup where you were a founder or one of the first 20 employees', answer: 'Yes' }];
  // The bank stores learned labels normalized (learnAnswer), so lowercase here as it does.
  const { actions } = planFill(snap.fields, { ...bank, learned: learned.map((l) => ({ ...l, label: l.label.toLowerCase() })) }, {});
  assert.deepEqual(actions.filter((a) => a.action === 'check').map((a) => boxes.find((b) => b.key === a.key).label), learned.map((l) => l.label));
  assert.ok(!actions.some((a) => a.action === 'check' && /None of the above|In-house/.test(boxes.find((b) => b.key === a.key)?.label || '')));
});

test('LinkedIn 2026 Yes/No asked as a checkbox pair: one question labelled by the <p> above, answered from the bank', { skip }, async () => {
  const { snap } = await snapshot('synthetic-yesno-checkboxes.html', 'dialog');
  const qs = snap.fields.filter((f) => f.kind === 'radio');
  assert.deepEqual(qs.map((f) => [f.label, f.options, f.required]), [
    ['Are you legally authorized to work in the United States on a full-time basis?*', ['Yes', 'No'], true],
    ['Will you now or in the future require sponsorship for employment visa status (e.g., H-1B, Skilled Worker visa)?*', ['Yes', 'No'], true],
  ]);
  assert.ok(!snap.fields.some((f) => f.kind === 'checkbox'));
  const { actions, missing } = planFill(snap.fields, { ...bank, facts: { work_authorization: 'Yes', sponsorship: 'No' } }, {});
  assert.deepEqual(actions.map((a) => [a.action, a.value]), [['radio', 'Yes'], ['radio', 'No']]);
  assert.deepEqual(missing, []);
});

test('Greenhouse 2026 checkbox group: boxes sharing a name carry the group and its legend; one ticked box answers the required group, none ticked asks it once', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, 'greenhouse-2026-checkbox-group.html'), 'utf8'), { waitUntil: 'domcontentloaded' });
    await page.evaluate(markRoot, 'form');
    let snap = await page.evaluate(collectForm);
    const loc = ['Springfield, IL', 'Denver, CO', 'Portland, OR', 'Boston, MA', 'Remote'];
    const boxes = snap.fields.filter((f) => f.kind === 'checkbox');
    assert.deepEqual(boxes.map((f) => [f.label, f.required, f.group, f.group_label]), loc.map((l) => [l, true, 'question_9000000101[]', 'Location Preference *']));
    assert.deepEqual(planFill(snap.fields, bank, {}).missing.map((m) => [m.label, m.kind, m.options, m.reason]), [['Location Preference *', 'checkbox', loc, 'no-answer']]);
    await page.check('[id="question_9000000101[]_9000000205"]');
    await page.evaluate(markRoot, 'form');
    snap = await page.evaluate(collectForm);
    assert.equal(snap.fields.find((f) => f.label === 'Remote').value, 'on');
    assert.deepEqual(planFill(snap.fields, bank, {}).missing, []);
  } finally {
    await page.close();
  }
});

test('Greenhouse 2026 board: uploads take the group heading, not "Attach"; react-select shadow inputs are skipped; the comboboxes plan from the bank', { skip }, async () => {
  const { marked, snap } = await snapshot('synthetic-greenhouse-2026.html', 'form');
  assert.equal(marked, true);
  const q1 = 'Are you legally eligible for employment in the United States?*';
  const q2 = 'Will you now or in the future require Acme, Inc. to file a petition or application for employment - based status on your behalf?*';
  const labels = snap.fields.map((f) => f.label);
  assert.deepEqual(labels, ['First Name*', 'Email*', 'Country*', 'Phone*', 'Location (City)*', 'Resume/CV*', 'Cover Letter', q1, q2, 'LinkedIn Profile']);
  assert.deepEqual(snap.fields.filter((f) => f.combobox).map((f) => f.label), ['Country*', 'Location (City)*', q1, q2]);
  assert.equal(snap.fields.find((f) => f.label === 'Cover Letter').accept, '.pdf,.doc,.docx,.txt,.rtf');
  const gh = {
    ...bank,
    profile: { ...bank.profile, phone: '555 555 0100', country: 'United States', city: 'Springfield, Illinois, United States' },
    learned: [{ label: normLabel(q1), answer: 'Yes' }, { label: normLabel(q2), answer: 'No' }],
  };
  const plan = planFill(snap.fields, gh, { cv: '/tmp/cv.pdf', coverNoteFile: '/tmp/cover-note.txt' });
  assert.deepEqual(plan.missing, []);
  const v = Object.fromEntries(plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).label, a.value]));
  assert.equal(v['Resume/CV*'], '/tmp/cv.pdf');
  assert.equal(v['Cover Letter'], '/tmp/cover-note.txt');
  assert.equal(v['Country*'], 'United States');
  assert.equal(v[q1], 'Yes');
  assert.equal(v[q2], 'No');
});

test('company-site form: the application form is the root, not the footer newsletter; the privacy box takes its text label; consent is asked, never ticked on its own', { skip }, async () => {
  const { marked, snap } = await snapshot('synthetic-site-form.html', 'form');
  assert.equal(marked, true);
  const labels = snap.fields.map((f) => f.label);
  assert.deepEqual(labels, ['Name', 'Email', 'Phone (+44 20 7946 0958)', 'UPLOAD CV', 'Write your message here', 'I accept the Privacy Policy']);
  const site = { ...bank, profile: { ...bank.profile, full_name: 'Jordan Example', phone: '555 555 0100' } };
  const plan = planFill(snap.fields, site, { cv: '/tmp/cv.pdf', coverNote: 'Hi team' });
  assert.deepEqual(plan.missing.map((m) => [m.label, m.reason]), [['I accept the Privacy Policy', 'consent']]);
  const v = Object.fromEntries(plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).label, a.value]));
  assert.equal(v['Write your message here'], 'Hi team');
  assert.equal(v['UPLOAD CV'], '/tmp/cv.pdf');
  const agreed = planFill(snap.fields, { ...site, learned: [{ label: normLabel('I accept the Privacy Policy'), answer: 'Yes' }] }, { cv: '/tmp/cv.pdf', coverNote: 'Hi team' });
  assert.deepEqual(agreed.missing, []);
  assert.equal(agreed.actions.find((a) => snap.fields.find((f) => f.key === a.key).label === 'I accept the Privacy Policy').action, 'check');
});

test('Paylocity: a hidden resume input is named by the button after it; fields take the visual label before them', { skip }, async () => {
  const { snap } = await snapshot('synthetic-paylocity.html', 'form');
  assert.deepEqual(snap.fields.slice(0, 3).map((f) => [f.label, f.kind]), [['Select Resume to Upload', 'file'], ['First Name (required)', 'text'], ['Email Address (required)', 'text']]);
  assert.deepEqual(snap.fields.map((f) => f.id), ['btn-resume', 'info.firstName', 'info.email', 'wh-0-country', 'wh-0-state']); // ids let job answers target one field
  // A Paylocity select keeps its choice in a single-value element, not the input; a placeholder is no value.
  assert.deepEqual(snap.fields.slice(3).map((f) => f.value), ['United States', '']);
  const plan = planFill(snap.fields.slice(0, 3), bank, { cv: '/tmp/cv.pdf' });
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.actions.find((a) => a.action === 'file').value, '/tmp/cv.pdf');
});

test('Ashby: the autofill upload is named by its heading and skipped beside the real Resume; aria-pressed Yes/No buttons are one question', { skip }, async () => {
  const { snap } = await snapshot('synthetic-ashby.html', 'form');
  const q = 'Will you now or in the future require visa sponsorship to work in the US?';
  assert.deepEqual(snap.fields.map((f) => [f.label, f.kind]), [['Autofill from resume', 'file'], ['Name', 'text'], ['Resume', 'file'], [q, 'radio']]);
  const yn = snap.fields.find((f) => f.label === q);
  assert.deepEqual(yn.options, ['Yes', 'No']);
  assert.equal(yn.required, true);
  const plan = planFill(snap.fields, { ...bank, profile: { ...bank.profile, full_name: 'Jordan Example' }, facts: { ...bank.facts, sponsorship: 'No' } }, { cv: '/tmp/cv.pdf' });
  assert.deepEqual(plan.missing, []);
  const v = plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).label, a.value]);
  assert.deepEqual(v, [['Name', 'Jordan Example'], ['Resume', '/tmp/cv.pdf'], [q, 'No']]);
});

test('Ashby radio groups: a title label with a _required_ class makes the question required (Submit was rejected with two required radios left blank)', { skip }, async () => {
  const { snap } = await snapshot('synthetic-ashby-radio.html', 'form');
  const metro = snap.fields.find((f) => /metro areas/.test(f.label));
  const editor = snap.fields.find((f) => /editor/.test(f.label));
  assert.equal(metro.kind, 'radio');
  assert.deepEqual(metro.options, ['Greater Springfield Area', 'None']);
  assert.equal(metro.required, true);
  assert.equal(editor.required, false);
});

test('Ashby: an id-less location typeahead takes its field entry title and required class, not the description (Submit was rejected with Location missing)', { skip }, async () => {
  const { snap } = await snapshot('synthetic-ashby-location.html', 'form');
  const loc = snap.fields.find((f) => f.combobox);
  assert.equal(loc.label, 'Location');
  assert.equal(loc.required, true);
});

test('Ashby: a radio question longer than 160 characters keeps its fieldset title label (the sponsorship radio once came back unlabeled)', { skip }, async () => {
  const { snap } = await snapshot('synthetic-ashby-radio.html', 'form');
  const radios = snap.fields.filter((f) => f.kind === 'radio');
  const spons = radios[radios.length - 1];
  assert.match(spons.label, /^Do you now, or will you in the future, need sponsorship from an employer/);
  assert.deepEqual(spons.options, ['Yes', 'No']);
  assert.equal(spons.required, true);
});

test('Paycor: a resume upload in its own <form> is part of the application root (the CV once never went in)', { skip }, async () => {
  const { snap } = await snapshot('synthetic-paycor.html', 'form');
  assert.deepEqual(snap.fields.slice(0, 5).map((f) => [f.label, f.kind]), [['Apply with a Resume', 'file'], ['First Name', 'text'], ['Last Name', 'text'], ['Email', 'text'], ['Comments', 'textarea']]);
  // The SMS opt-in radios: each option is the text beside its own radio, not the question again.
  const sms = snap.fields.find((f) => f.kind === 'radio');
  assert.deepEqual(sms.options, ['Yes', 'No']);
});

test('stuckReport: a select\'s "Please Select" placeholder option is not a validation message (Paycor)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, '<form><label for="st">State</label><select id="st"><option>Please Select</option><option>CA</option></select><input type="submit" value="Submit"></form>', { waitUntil: 'domcontentloaded' });
    await page.selectOption('#st', 'CA');
    await page.evaluate(markRoot, 'form');
    assert.deepEqual(await page.evaluate(stuckReport), []);
  } finally { await page.close(); }
});

test('checkLabelRadio: when the option label swallows the click, the radio is still checked through the input (Paylocity)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const opt = (v) => `<label onclick="if (event.target.tagName !== 'INPUT') event.preventDefault()"><div><div><input type="radio" name="q" value="${v}" aria-checked="false" style="opacity:0;position:absolute"></div><div>${v}</div></div></label>`;
    await show(page, `<label>How did you hear about us?<div role="radiogroup" aria-required="true">${opt('Online Job Board')}${opt('Other')}</div></label>`);
    const loc = page.locator('input[value="Online Job Board"]');
    await loc.locator('xpath=ancestor::label[1]').click();
    assert.equal(await loc.isChecked(), false); // the fixture reproduces the failure: a label click alone does not take
    assert.equal(await checkLabelRadio(loc), true);
    assert.equal(await loc.isChecked(), true);
    assert.equal(await page.locator('input[value="Other"]').isChecked(), false);
  } finally {
    await page.close();
  }
});

test('checkLabelRadio: a radio re-mounted on select (tracking attributes gone) still counts as checked, by its group name and value (Paylocity)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const opt = (v) => `<label><div><input type="radio" name="info.how" value="${v}" data-hunt-key="f13" data-hunt-opt="${v}"></div><div>${v}</div></label>`;
    await show(page, `<div role="radiogroup">${opt('Online Job Board')}${opt('Other')}</div>
      <script>document.addEventListener('change', (e) => { const v = e.target.value; const fresh = document.createElement('input'); fresh.type = 'radio'; fresh.name = 'info.how'; fresh.value = v; e.target.replaceWith(fresh); fresh.checked = true; });</script>`);
    const loc = page.locator('[data-hunt-key="f13"][data-hunt-opt="Online Job Board"]');
    assert.equal(await checkLabelRadio(loc), true);
    assert.equal(await page.evaluate(() => document.querySelector('input[name="info.how"]:checked')?.value), 'Online Job Board');
  } finally {
    await page.close();
  }
});

// Gem's radios carry no name: two Yes/No questions, each input beside its label (for=). With the
// first Yes already checked, picking the second Yes must click it, not take the first as done.
test('checkLabelRadio: an unnamed radio is confirmed on itself, not by any other unnamed radio that is checked', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<form>
      <div><input type="radio" id="a1" checked><label for="a1">Yes</label><input type="radio" id="a2"><label for="a2">No</label></div>
      <div><input type="radio" id="b1"><label for="b1">Yes</label><input type="radio" id="b2"><label for="b2">No</label></div>
    </form>`);
    const ok = await checkLabelRadio(page.locator('#b1'), { waitMs: 50 });
    const state = await page.evaluate(() => ['a1', 'b1'].map((id) => document.getElementById(id).checked));
    assert.equal(ok, true);
    assert.deepEqual(state, [true, true]);
  } finally { await page.close(); }
});


test('stuckReport: a question\'s description ("Please select the option that best describes ...") is help text, not a validation message (Greenhouse)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<form data-hunt-root="1">
      <div class="field-wrapper"><label for="q1">How did you hear about us?*</label>
        <div class="select__single-value">Job Boards (e.g., LinkedIn, Indeed, Monster, Glassdoor)</div><input id="q1" role="combobox" value="">
        <div class="body body__secondary"><div id="q1-description" class="question-description"><p>Please select the option that best describes how you found out about us.</p></div></div></div>
      <div class="field-wrapper"><label for="q2">Discipline*</label><input id="q2" role="combobox" value="">
        <div class="helper-text helper-text--error" id="q2-error"><span>This field is required.</span></div></div>
    </form>`);
    const open = await page.evaluate(stuckReport);
    assert.deepEqual(open.map((o) => o.error), ['This field is required.']);
  } finally {
    await page.close();
  }
});

test('stuckReport: an Ashby application-limits callout ("Please choose the roles ...") is a notice, not a validation message (two filled forms once stopped before Submit)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<div data-hunt-root="1">
      <div class="_applicationLimitCallout_5yu8i_447 ashby-application-blocking-disclosure _container_f7cvd_28"><div><div><span>This job has application limits</span></div></div>
        <div><div><p><strong>A quick note before you apply:</strong> We want to give every application real attention.</p>
        <ul><li><p>You can submit up to 4 applications to Acme Corp in any 30-day period. Please choose the roles where your experience is the strongest match.</p></li></ul></div></div></div>
      <div class="ashby-application-form-field-entry"><label for="n">Legal First and Last Name</label><input id="n" value="Jordan Example"></div>
      <div class="ashby-application-form-field-entry"><label for="d">Discipline</label><input id="d" value="">
        <p class="_error_x">This field is required.</p></div>
    </div>`);
    const open = await page.evaluate(stuckReport);
    assert.deepEqual(open.map((o) => o.error), ['This field is required.']);
  } finally {
    await page.close();
  }
});

// A list's help tooltip ("If none of the options apply to you, please select "Other" ...") behind its
// "?" stopped a filled form before its last button: it is help text. An error tooltip is still a message.
test('stuckReport: a help tooltip is not a validation message; an error tooltip still is', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const help = 'If none of the options apply to you, please select "Other" and fill in the blank that appears.';
    await show(page, `<div data-hunt-root="1">
      <div class="form-field"><label for="d">Degree</label><span class="help">?<div role="tooltip" class="tooltip">${help}</div></span>
        <select id="d"><option>Select</option><option>Bachelor's Degree</option></select></div>
      <div class="form-field"><label for="m">Major</label><span class="help">?<div class="tooltip">${help}</div></span><input id="m" value=""></div>
      <div class="form-field"><label for="g">GPA</label><input id="g" value=""><div role="tooltip" class="tooltip tooltip-error">Please enter a valid GPA</div></div>
    </div>`);
    const open = await page.evaluate(stuckReport);
    assert.deepEqual(open.map((o) => o.error), ['Please enter a valid GPA']);
  } finally {
    await page.close();
  }
});

// Greenhouse: the optional Race react-select is labelled "Race: Please select the racial category ...".
// An option was picked each time, but stuckReport read the question's own <label> as a validation
// message, and runs stopped before Submit.
test('stuckReport: a question whose own label says "Please select ..." is not a validation message; Greenhouse\'s error under it still is', { skip }, async () => {
  const RACE = 'Race: Please select the racial category with which you most closely identify with.';
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, 'greenhouse-2026-eeo-race.html'), 'utf8'), { waitUntil: 'domcontentloaded' });
    assert.equal(await page.evaluate(markRoot, 'form'), true);
    // The collector reads Race like the Gender select beside it, which filled fine: a react-select
    // combobox the runner types into and picks from. The job answer plans as that typed pick.
    const snap = await page.evaluate(collectForm);
    const byId = Object.fromEntries(snap.fields.map((f) => [f.id, f]));
    assert.equal(byId['9000000302'].label, RACE);
    for (const id of ['9000000301', '9000000302', '9000000303']) assert.deepEqual([byId[id].kind, byId[id].combobox, byId[id].required], ['text', true, false]);
    const plan = planFill([byId['9000000302']], bank, { jobAnswers: { '#9000000302': 'Asian' } });
    assert.deepEqual(plan.actions.map((a) => [a.action, a.value, a.source]), [['fill', 'Asian', 'job']]);
    // Answered, as the run left it: nothing is open.
    assert.deepEqual(await page.evaluate(stuckReport), []);
    // Left blank with no message: an optional question is still not open.
    await page.evaluate(() => { document.getElementById('9000000302').closest('.select__value-container').querySelector('.select__single-value').outerHTML = '<div class="select__placeholder" id="react-select-9000000302-placeholder">Select...</div>'; });
    assert.deepEqual(await page.evaluate(stuckReport), []);
    // Greenhouse's own message under it is reported, and only that.
    await page.evaluate(() => document.getElementById('9000000302').closest('.select__container').insertAdjacentHTML('beforeend', '<div class="helper-text helper-text--error" id="9000000302-error"><span>This field is required.</span></div>'));
    assert.deepEqual(await page.evaluate(stuckReport), [{ label: RACE, error: 'This field is required.' }]);
  } finally {
    await page.close();
  }
});

test('invalidReport: names the fields the browser or the page marks invalid when Next does not advance and no message shows (Phenom)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<form data-hunt-root="1">
      <label for="zip">Postal Code</label><input id="zip" required value="">
      <label for="tel">Phone number</label><input id="tel" aria-invalid="true" value="12">
      <label for="ok">City</label><input id="ok" required value="Springfield">
    </form>`);
    const bad = await page.evaluate(invalidReport);
    assert.deepEqual(bad.map((b) => b.label), ['Postal Code', 'Phone number']);
    assert.ok(bad.every((b) => b.error));
  } finally {
    await page.close();
  }
});

test('react-widgets dropdowns (div role=combobox, Paylocity): collected as selects, and "SMS permission required" is a validation message', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<form data-hunt-root="1">
      <div class="form-group"><label>First Name<span><em> (required)</em></span></label><input id="info.firstName" value="Jordan"></div>
      <div class="form-group form-required form-error"><label>We may use SMS during the hiring process. Do you give us permission to text you?<span><em> (required)</em></span></label>
        <div><div id="info.smsOptedIn" role="combobox" aria-owns="info.smsOptedIn__listbox" tabindex="0" class="form-error rw-dropdownlist rw-widget"><span class="rw-select"></span><div class="rw-input">--</div></div></div>
        <div class="type-footnote show">SMS permission required</div></div>
      <div class="form-group"><label>Have you applied for a job with us before?</label>
        <div id="info.haveYouAppliedWithUsBefore" role="combobox" tabindex="0" class="rw-dropdownlist rw-widget"><div class="rw-input">No</div></div></div>
    </form>`);
    await page.evaluate(markRoot, 'form');
    const snap = await page.evaluate(collectForm);
    const sms = snap.fields.find((f) => f.id === 'info.smsOptedIn');
    assert.ok(sms, 'the SMS dropdown is collected');
    assert.equal(sms.kind, 'select');
    assert.equal(sms.widget, 'rw');
    assert.equal(sms.label, 'We may use SMS during the hiring process. Do you give us permission to text you? (required)');
    assert.equal(sms.required, true);
    assert.equal(sms.value, '');
    assert.equal(snap.fields.find((f) => f.id === 'info.haveYouAppliedWithUsBefore').value, 'No');
    assert.deepEqual((await page.evaluate(stuckReport)).map((o) => o.error), ['SMS permission required']);
    // A second look (the runner collects again after every fill) still finds it.
    await page.evaluate(markRoot, 'form');
    assert.ok((await page.evaluate(collectForm)).fields.find((f) => f.id === 'info.smsOptedIn'), 'collected again on a later look');
  } finally {
    await page.close();
  }
});

test('pickWidget: opens a react-widgets dropdown, clicks the answer among options that render on open, and confirms the shown value (Paylocity SMS consent)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<div class="form-group"><label>SMS permission?</label>
      <div id="info.smsOptedIn" role="combobox" aria-owns="info.smsOptedIn__listbox" tabindex="0" class="rw-dropdownlist rw-widget" data-hunt-key="f9"><div class="rw-input">--</div></div></div>
      <script>
        const box = document.getElementById('info.smsOptedIn');
        box.addEventListener('click', () => {
          if (document.getElementById('info.smsOptedIn__listbox')) return;
          const ul = document.createElement('ul'); ul.id = 'info.smsOptedIn__listbox'; ul.setAttribute('role', 'listbox');
          for (const v of ['--', 'Yes*', 'No']) { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = v;
            li.addEventListener('click', (e) => { e.stopPropagation(); box.querySelector('.rw-input').textContent = v; ul.remove(); }); ul.appendChild(li); }
          document.body.appendChild(ul);
        });
      </script>`);
    const loc = page.locator('[data-hunt-key="f9"]');
    assert.equal(await pickWidget(loc, 'Yes'), true);
    // Paylocity marks an option with a trailing asterisk ("Yes*"): it is still "Yes".
    assert.equal((await page.locator('#info\\.smsOptedIn .rw-input').innerText()).trim(), 'Yes*');
  } finally {
    await page.close();
  }
});

// Something covering a box and its label took both clicks ("checkbox did not tick" twice in a headed
// run, while a clean copy of the page ticked): the box is then clicked from the page.
test('setBox: a box and label covered by an overlay are still ticked from the page', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<fieldset class="checkbox" id="question_9000000401[]"><legend>Have you worked at a startup company before? *</legend><div class="checkbox__wrapper"><div class="checkbox__input"><input type="checkbox" id="question_9000000401[]_7" name="question_9000000401[]" value="7" data-hunt-key="f13"></div><label for="question_9000000401[]_7">Yes</label></div></fieldset><div style="position:fixed;inset:0;background:rgba(0,0,0,.01);z-index:9"></div>`);
    const loc = page.locator('[data-hunt-key="f13"]');
    assert.equal(await setBox(loc, true, { waitMs: 50 }), true);
    assert.equal(await loc.isChecked(), true);
  } finally {
    await page.close();
  }
});

test('setBox: a checkbox labelled by a sibling <label for> is ticked through that label and confirmed (Greenhouse race boxes)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<div class="checkbox__wrapper"><div class="checkbox__input"><input type="checkbox" id="q[]_9" name="q[]" value="9" data-hunt-key="f30" style="opacity:0;position:absolute"><svg width="16" height="16"></svg></div><label for="q[]_9">White</label></div>`);
    const loc = page.locator('[data-hunt-key="f30"]');
    assert.equal(await setBox(loc, true), true);
    assert.equal(await loc.isChecked(), true);
    assert.equal(await setBox(loc, false), true);
    assert.equal(await loc.isChecked(), false);
  } finally {
    await page.close();
  }
});

test('pressToggle: a Yes/No toggle Playwright cannot click ("element is outside of the viewport") is pressed from the page and confirmed (Ashby)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<div style="position:fixed;top:-500px"><button aria-pressed="false" data-hunt-key="f19" data-hunt-opt="Yes">Yes</button><button aria-pressed="false" data-hunt-key="f19" data-hunt-opt="No">No</button></div>
      <script>for (const b of document.querySelectorAll('button')) b.addEventListener('click', () => { for (const o of document.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b)); });</script>`);
    const loc = page.locator('[data-hunt-key="f19"][data-hunt-opt="No"]');
    const plain = await loc.click({ timeout: 800 }).then(() => 'ok', () => 'failed');
    assert.equal(plain, 'failed'); // the fixture reproduces the failure
    assert.equal(await pressToggle(loc, { timeout: 800 }), true);
    assert.equal(await loc.getAttribute('aria-pressed'), 'true');
  } finally {
    await page.close();
  }
});

test('Ashby checkbox group and date picker: the group is one required question answered from the job answers; "Immediately" fills the date picker as today', { skip }, async () => {
  const { snap } = await snapshot('synthetic-ashby-group-date.html', 'form');
  const q = 'Where did you hear about this position?';
  const grp = snap.fields.find((f) => f.label === q);
  assert.ok(grp, 'the group is collected as one question');
  assert.equal(grp.kind, 'radio');
  assert.equal(grp.checkboxes, true);
  assert.equal(grp.required, true);
  assert.deepEqual(grp.options, ['Friend', 'Community Post', 'LinkedIn', 'Other']);
  assert.ok(!snap.fields.some((f) => f.kind === 'checkbox'));
  const date = snap.fields.find((f) => f.label === 'When are you available to start?');
  assert.equal(date.kind, 'date');
  assert.equal(date.required, true);
  const b = { ...bank, facts: { ...bank.facts, start_date: 'Immediately' } };
  const asked = planFill(snap.fields, b, { today: '2026-11-05' });
  assert.deepEqual(asked.missing.map((m) => [m.label, m.reason]), [[q, 'no-answer']]);
  const plan = planFill(snap.fields, b, { today: '2026-11-05', jobAnswers: { [normLabel(q)]: 'LinkedIn' } });
  assert.deepEqual(plan.missing, []);
  const v = plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).label, a.action, a.value]);
  assert.deepEqual(v, [['When are you available to start?', 'fill', '11/05/2026'], [q, 'radio', 'LinkedIn']]);
});

test('Ashby checkbox group: tickGroupOption ticks exactly the chosen option, found by the collector key', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await show(page, readFileSync(join(FIX, 'synthetic-ashby-group-date.html'), 'utf8'), { waitUntil: 'domcontentloaded' });
    await page.evaluate(markRoot, 'form');
    const snap = await page.evaluate(collectForm);
    const grp = snap.fields.find((f) => f.label === 'Where did you hear about this position?');
    assert.equal(await tickGroupOption(page, grp.key, 'LinkedIn'), true);
    const ticked = await page.evaluate(() => [...document.querySelectorAll('fieldset input[type="checkbox"]')].filter((b) => b.checked).map((b) => b.name));
    assert.deepEqual(ticked, ['LinkedIn']);
  } finally { await page.close(); }
});

// "Select all of the tools you have used": a checkbox group answered with several values.
test('Ashby checkbox group: tickGroupOptions ticks exactly several options and unticks the rest; the collector then reads the group as "a | b" and the plan takes no action', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await show(page, readFileSync(join(FIX, 'synthetic-ashby-group-date.html'), 'utf8'), { waitUntil: 'domcontentloaded' });
    await page.evaluate(markRoot, 'form');
    const snap = await page.evaluate(collectForm);
    const q = 'Where did you hear about this position?';
    const grp = snap.fields.find((f) => f.label === q);
    assert.equal(await tickGroupOption(page, grp.key, 'Other'), true);
    assert.equal(await tickGroupOptions(page, grp.key, ['LinkedIn', 'Friend']), true);
    const ticked = await page.evaluate(() => [...document.querySelectorAll('fieldset input[type="checkbox"]')].filter((b) => b.checked).map((b) => b.name));
    assert.deepEqual(ticked.sort(), ['Friend', 'LinkedIn']);
    await page.evaluate(markRoot, 'form');
    const after = await page.evaluate(collectForm);
    const now = after.fields.find((f) => f.label === q);
    assert.equal(now.value, 'Friend | LinkedIn');
    const plan = planFill(after.fields, bank, { jobAnswers: { [normLabel(q)]: 'LinkedIn | Friend' } });
    assert.ok(!plan.actions.some((a) => a.key === now.key));
    assert.ok(!plan.missing.some((m) => m.key === now.key));
  } finally { await page.close(); }
});

// Greenhouse: a box dropped a keystroke, the boxes read one character off the mailed code, and the
// site answered "Incorrect security code". enterCode types each box and reads them back.
// Walmart: Backspace in an empty box cleared the previous digit, so the code never read back.
test('enterCode: types a security code box by box and confirms the boxes read it back; retries once; reports a widget that keeps it wrong', { skip }, async () => {
  const { enterCode } = await import('../scripts/lib/apply-click.mjs');
  const html = readFileSync(join(FIX, 'synthetic-otp-boxes.html'), 'utf8');
  for (const [mode, want] of [['', true], ['flaky=1', true], ['broken=1', false], ['backjump=1', true]]) {
    const page = await browser.newPage();
    try {
      await page.route('http://otp.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
      await page.goto(`http://otp.test/?${mode}`);
      const boxes = page.locator('input[maxlength="1"]:visible');
      assert.equal(await enterCode(page, boxes, '82955737'), want, mode || 'plain');
      if (want) assert.equal(await boxes.evaluateAll((els) => els.map((e) => e.value).join('')), '82955737', mode || 'plain');
    } finally { await page.close(); }
  }
});

// Ashby: the page's inline <script>window.__appData = {...}</script> holds JSON
// that mentions "required", and stuckReport read it as a validation message, so the runner refused
// to submit a clean form. Script, style, noscript and template text is never a message.
test('stuckReport: text inside script, style, noscript or template is not a validation message', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await show(page, `<!doctype html><html><body><form>
      <label for="n">Name</label><input id="n" value="Jordan">
      <script>window.__appData = {"fields":[{"title":"Email","isRequired":true,"msg":"This field is required"}]}</script>
      <style>.err::after{content:"is required"}</style>
      <noscript>This field is required</noscript>
      <template><p>This field is required</p></template>
      <button type="submit">Submit Application</button></form></body></html>`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(markRoot, 'form');
    assert.deepEqual(await page.evaluate(stuckReport), []);
  } finally { await page.close(); }
});

// The approved CV was the second row of LinkedIn's resume picker. Clicking the
// row's outermost box missed, and the run stopped with "not the selected resume" twice.
test('LinkedIn resume picker: selectResumeRow selects a lower row through its card and confirms the radio', { skip }, async () => {
  const { selectResumeRow } = await import('../scripts/lib/apply-click.mjs');
  const page = await browser.newPage();
  try {
    await show(page, readFileSync(join(FIX, 'synthetic-li-resume-picker.html'), 'utf8'), { waitUntil: 'load' });
    await page.evaluate(markRoot, 'dialog');
    const snap = await page.evaluate(collectForm);
    const rc = resumeChoice(snap.fields, 'jordan-example-cv-cto-head-of-engineering.pdf');
    assert.equal(rc.status, 'select');
    assert.equal(await selectResumeRow(page, rc.key, rc.option), true);
    const after = resumeChoice(await page.evaluate(collectForm).then((s) => s.fields), 'jordan-example-cv-cto-head-of-engineering.pdf');
    assert.equal(after.status, 'ok');
    // A row far down the scrolled list works the same way.
    const far = resumeChoice(snap.fields, 'jordan-example-cv-interim-a.pdf');
    assert.equal(await selectResumeRow(page, far.key, far.option), true);
    assert.equal(await page.evaluate(() => window.downloads || 0), 0);
  } finally { await page.close(); }
});

test('collectForm: a Gem textarea keeps its long question (over 160 characters) as its label', { skip }, async () => {
  const { snap } = await snapshot('gem-long-label.html', 'form');
  const labels = snap.fields.filter((f) => f.kind === 'textarea').map((f) => f.label);
  assert.ok(labels.some((l) => /^Describe a project where you replaced a manual process with software you designed\. What was your part in it, how did you measure the result, and what would you do differently next time\?/.test(l)), `labels: ${JSON.stringify(labels)}`);
});

test('Rippling (ats.rippling.com): uploads take their field title, not the "Drop or select" button; Résumé is required by its asterisk; input-less menus are selects; a custom radio is required by the CSS * in its question; the SMS opt-in keeps its question and options; a disabled Apply is reported', { skip }, async () => {
  const { marked, snap } = await snapshot('synthetic-rippling.html', 'form');
  assert.equal(marked, true);
  const by = Object.fromEntries(snap.fields.map((f) => [f.label, f]));
  assert.deepEqual(snap.fields.filter((f) => f.kind === 'file').map((f) => [f.label, f.required]), [['Résumé*', true], ['Cover letter', false]]);
  for (const l of ['First name', 'Last name', 'Email', 'Phone number', 'Location']) assert.equal(by[l]?.required, true, l);
  for (const l of ['Gender', 'Are you Hispanic/Latino?', 'Veteran Status']) {
    assert.equal(by[l]?.kind, 'select', l);
    assert.equal(by[l].value, '', `${l}: "Select..." is a placeholder`);
    assert.deepEqual(by[l].options, []);
    assert.ok(by[l].widget, `${l}: options render only when opened`);
  }
  // A custom radio (Apply stays disabled until it is answered): required only by the CSS * in its question.
  const rel = snap.fields.find((f) => f.kind === 'radio' && /relatives/.test(f.label));
  assert.equal(rel?.label, 'Do you have any relatives working at Acme Corp?');
  assert.deepEqual(rel.options, ['Yes', 'No']);
  assert.equal(rel.required, true, 'a CSS-drawn * marks it required');
  const sms = snap.fields.find((f) => f.kind === 'radio' && /text message/.test(f.label));
  assert.match(sms.label, /^Check Yes or No to indicate your agreement to receive text message updates from Acme Corp/);
  assert.deepEqual(sms.options, ['Yes - I consent to receiving text messages', 'No - I do not consent to receiving text messages']);
  assert.equal(sms.required, false);
  assert.equal(submitLabel(snap.buttons), 'Apply');
  assert.deepEqual(snap.disabled_buttons, ['Apply']);

  const ripBank = { ...bank, profile: { ...bank.profile, phone: '(555) 555-0100', city: 'Springfield, Illinois, United States' }, eeo: EEO };
  const plan = planFill(snap.fields, ripBank, { cv: '/tmp/cv.pdf', coverPdf: '/tmp/letter.pdf', coverNote: 'Letter text' });
  const act = (l) => plan.actions.find((a) => snap.fields.find((f) => f.key === a.key)?.label === l);
  assert.equal(act('Résumé*')?.value, '/tmp/cv.pdf');
  assert.equal(act('Cover letter')?.value, '/tmp/letter.pdf');
  assert.deepEqual(['First name', 'Last name', 'Email', 'Location'].map((l) => act(l)?.value), ['Jordan', 'Example', 'jordan@example.com', 'Springfield, Illinois, United States']);
  assert.deepEqual(['Gender', 'Are you Hispanic/Latino?', 'Veteran Status'].map((l) => [act(l)?.action, act(l)?.eeo]), [['pick', 'Gender'], ['pick', 'Are you Hispanic/Latino?'], ['pick', 'Veteran Status']]);
  // The relatives question has no bank answer, so it is asked; the SMS opt-in is consent: asked, never answered on its own.
  assert.deepEqual(plan.missing.map((m) => [m.label.slice(0, 42), m.reason, m.options.length]), [['Do you have any relatives working at Acme Corp?'.slice(0, 42), 'no-answer', 2], ['Check Yes or No to indicate your agreement', 'consent', 2]]);
});

test('pickWidget: a Rippling menu (options in the aria-controls list, the choice shown in the box, Escape leaves it open) takes the option a chooser names, such as the EEO pick', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const menu = (id, key, opts) => `<div><span id="${id}-label">Q ${id}</span>
      <div id="${id}" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-label" tabindex="0" data-hunt-key="${key}"><p>Select...</p></div></div>
      <script>(() => { const box = document.getElementById('${id}');
        box.addEventListener('click', () => {
          if (document.getElementById('${id}-list')) return;
          box.setAttribute('aria-expanded', 'true'); box.setAttribute('aria-controls', '${id}-list');
          const ul = document.createElement('ul'); ul.id = '${id}-list'; ul.setAttribute('role', 'listbox');
          for (const v of ${JSON.stringify(opts)}) { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.innerHTML = '<div><div data-testid="menuListLabel"><p></p></div></div>'; li.querySelector('p').textContent = v;
            li.addEventListener('click', (e) => { e.stopPropagation(); box.querySelector('p').textContent = v; ul.remove(); box.setAttribute('aria-expanded', 'false'); box.removeAttribute('aria-controls'); }); ul.appendChild(li); }
          document.body.appendChild(ul);
        }); })();</script>`;
    const vet = ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', 'Choose not to disclose'];
    await show(page, menu('field-74', 'f9', vet) + menu('field-68', 'f8', ['Yes', 'No', 'Choose not to disclose']));
    const eeo = EEO;
    assert.equal(await pickWidget(page.locator('[data-hunt-key="f9"]'), 'No', { choose: (texts) => eeoPick(texts, 'Veteran Status', eeo) }), true);
    assert.equal((await page.locator('#field-74').innerText()).trim(), 'I am not a protected veteran');
    assert.equal(await pickWidget(page.locator('[data-hunt-key="f8"]'), 'No'), true);
    assert.equal((await page.locator('#field-68').innerText()).trim(), 'No');
    // Already showing the answer: nothing is opened again.
    assert.equal(await pickWidget(page.locator('[data-hunt-key="f8"]'), 'No'), true);
    assert.equal(await page.locator('#field-68-list').count(), 0);
  } finally {
    await page.close();
  }
});

test('Rippling custom questions: a menu named only by its placeholder ("Select") takes the question above its field block', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const q = (text, id, inner) => `<div><div><div><p>${text}<div></div></p></div></div><div data-testid="field"><div><div data-testid="customQuestions.x.${id}"><div><div data-testid="select-controller"><div>${inner}</div></div></div></div></div></div>`;
    await show(page, `<form>
      ${q('How did you hear about Acme Corp?', 'a', '<div id="field-63" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label="Select" aria-required="true" tabindex="0"><p>Select</p></div>')}
      ${q('Are you legally authorized to work in the United States?', 'b', '<div id="field-69" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label="Select" aria-required="true" tabindex="0"><p>Yes</p></div>')}
      <button type="submit" aria-disabled="true">Apply</button></form>`);
    await page.evaluate(markRoot, 'form');
    const snap = await page.evaluate(collectForm);
    assert.deepEqual(snap.fields.map((f) => [f.label, f.kind, f.widget, f.required, f.value]), [
      ['How did you hear about Acme Corp?', 'select', 'menu', true, ''],
      ['Are you legally authorized to work in the United States?', 'select', 'menu', true, 'Yes'],
    ]);
  } finally {
    await page.close();
  }
});

// A custom question longer than 160 characters named its menu with the question above it (the
// sponsorship and non-compete menus took "legally authorized" and were answered Yes): a block holding
// another menu ends the search, and a placeholder-named menu reads up to 600 characters.
test('Rippling custom questions: a long question names its own menu and never borrows the question above it', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const q = (text, id, inner) => `<div><div><div><p>${text}<div></div></p></div></div><div data-testid="field"><div><div data-testid="customQuestions.x.${id}"><div><div data-testid="select-controller"><div>${inner}</div></div></div></div></div></div>`;
    const menu = (id) => `<div id="${id}" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label="Select" aria-required="true" tabindex="0"><p>Select</p></div>`;
    const auth = 'Are you legally authorized to work for any employer in the U.S. now and in the future without the need for visa sponsorship?';
    const spons = 'Do you now, or will you in the future, require visa sponsorship (e.g., H-1B, L-1) or are you currently working under F-1 OPT or STEM OPT status to work legally in the country in which this position is located for Acme Corp or any of its affiliates? Please note: At this time, Acme Corp and its affiliates are not able to consider candidates who require current or future visa sponsorship, or candidates working under F-1 OPT or STEM OPT authorization.';
    const nonc = 'Are you currently subject to any agreement, such as a non-compete, non-solicitation, or required notice period, that would legally restrict or prevent you from performing the responsibilities of this role or working with our clients? Please do not disclose any confidential, proprietary, or trade secret information in your response.';
    await show(page, `<form>${q(auth, 'a', menu('field-55'))}${q(spons, 'b', menu('field-61'))}${q(nonc, 'c', menu('field-67'))}<button type="submit" aria-disabled="true">Apply</button></form>`);
    await page.evaluate(markRoot, 'form');
    const labels = (await page.evaluate(collectForm)).fields.map((f) => f.label);
    assert.equal(labels[0], auth);
    assert.match(labels[1], /^Do you now, or will you in the future, require visa sponsorship/);
    assert.match(labels[2], /^Are you currently subject to any agreement/);
  } finally {
    await page.close();
  }
});

test('menuOptions: reads a Rippling menu\'s options by opening it, then closes it with nothing chosen and without opening the next one (Escape and a second click do not close it; an outside mousedown does)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, `<div><span id="m-label">What is your current Work Authorization Status?</span>
      <div id="m" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="m-label" tabindex="0" data-hunt-key="f1"><p>Select</p></div></div>
      <script>(() => { const box = document.getElementById('m');
        box.addEventListener('click', () => {
          if (document.getElementById('m-list')) return;
          box.setAttribute('aria-expanded', 'true'); box.setAttribute('aria-controls', 'm-list');
          const ul = document.createElement('ul'); ul.id = 'm-list'; ul.setAttribute('role', 'listbox');
          for (const v of ['US Citizen', 'Green Card', 'Sponsorship Needed']) { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.innerHTML = '<p></p>'; li.querySelector('p').textContent = v;
            li.addEventListener('click', (e) => { e.stopPropagation(); box.querySelector('p').textContent = v; ul.remove(); box.setAttribute('aria-expanded', 'false'); }); ul.appendChild(li); }
          document.body.appendChild(ul);
        });
        // Rippling closes a menu on a mousedown outside it; the next menu opens when it takes focus.
        document.addEventListener('mousedown', (e) => { const ul = document.getElementById('m-list'); if (!ul || box.contains(e.target) || ul.contains(e.target)) return; ul.remove(); box.setAttribute('aria-expanded', 'false'); box.removeAttribute('aria-controls'); });
        const next = document.getElementById('n'); next.addEventListener('focus', () => next.setAttribute('aria-expanded', 'true'));
      })();</script>`.replace('<script>', '<div id="n" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0"><p>Select</p></div><script>'));
    const loc = page.locator('[data-hunt-key="f1"]');
    assert.deepEqual(await menuOptions(loc), ['US Citizen', 'Green Card', 'Sponsorship Needed']);
    assert.equal(await loc.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#n').getAttribute('aria-expanded'), 'false', 'the next menu is not opened on the way out');
    assert.equal((await loc.innerText()).trim(), 'Select');
  } finally {
    await page.close();
  }
});

// ---------- Workday (myworkdayjobs.com) ----------
async function workdaySnap(file) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, file), 'utf8'), { waitUntil: 'domcontentloaded' });
    return await page.evaluate(workdayPage);
  } finally {
    await page.close();
  }
}

test('Workday start dialog: "Start Your Application" lists Autofill with Resume, Apply Manually, Use My Last Application and Apply with LinkedIn; the runner takes Apply Manually, never the parse or another application', { skip }, async () => {
  const p = await workdaySnap('synthetic-workday-start.html');
  assert.deepEqual(p.startOptions, ['autofillWithResume', 'applyManually', 'useMyLastApplication', 'applyWithLinkedIn']);
  assert.equal(workdayStage(p), 'start');
  assert.equal(workdayStartChoice(p.startOptions), 'applyManually');
});

test('Workday account step: Create Account with email, password, verify and a privacy-notice box; the box is consent, asked unless the operator answered it; the honeypot "website" input is never a field', { skip }, async () => {
  const p = await workdaySnap('synthetic-workday-create-account.html');
  assert.equal(workdayStage(p), 'create-account');
  assert.deepEqual(p.step, { index: 1, total: 6, label: 'Create Account/Sign In' });
  assert.deepEqual(p.steps, ['Create Account/Sign In', 'My Information', 'My Experience', 'Application Questions', 'Voluntary Disclosures', 'Review']);
  assert.deepEqual(p.consent, [{ label: "I acknowledge and agree to Acme's Candidate Privacy Notice", checked: false }]);
  const boxes = p.consent.map((c, i) => ({ key: `c${i}`, kind: 'checkbox', label: c.label, required: true, options: [], value: '' }));
  assert.deepEqual(planFill(boxes, bank, { cv: '/tmp/cv.pdf' }).missing.map((m) => m.reason), ['consent']);
  const learned = { ...bank, learned: [{ label: normLabel(p.consent[0].label), answer: 'Yes' }] };
  assert.deepEqual(planFill(boxes, learned, { cv: '/tmp/cv.pdf' }).actions.map((a) => a.action), ['check']);
  const form = await (async () => {
    const page = await browser.newPage();
    try {
      await page.route(/^https?:/, (r) => r.abort());
      await show(page, readFileSync(join(FIX, 'synthetic-workday-create-account.html'), 'utf8'));
      await page.evaluate(markRoot, 'form');
      return await page.evaluate(collectForm);
    } finally { await page.close(); }
  })();
  assert.ok(!form.fields.some((f) => /robots|website/i.test(f.label)), 'the beecatcher honeypot is not collected');
});

test('Workday error page: "Something went wrong" with Error Code VPS under the progress bar is the error stage, not the My Information step', { skip }, async () => {
  const p = await workdaySnap('synthetic-workday-error.html');
  assert.deepEqual(p.step, { index: 1, total: 5, label: 'My Information' });
  assert.equal(workdayStage(p), 'error');
});

test('Workday sign-in and sign-in choice: Sign In has email and password with a Create Account link; Workday\'s own board first offers Apple, Google or email', { skip }, async () => {
  const s = await workdaySnap('synthetic-workday-sign-in.html');
  assert.equal(workdayStage(s), 'sign-in');
  assert.deepEqual(s.consent, []);
  const c = await workdaySnap('synthetic-workday-auth-choice.html');
  assert.equal(workdayStage(c), 'auth-choice');
  assert.deepEqual(c.steps.slice(3, 5), ['Application Questions 1 of 2', 'Application Questions 2 of 2']);
});

test('safeHtml: a page capture never carries a password, whether typed (property) or mirrored into the value attribute as React does; other values stay', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, '<form><input type="text" data-automation-id="email" value=""><input type="password" id="pw" value=""><input type="password" id="pw2"></form>');
    await page.fill('input[type=text]', 'jordan@example.com');
    await page.fill('#pw', 'S3cret!Pass-word');
    await page.evaluate(() => document.getElementById('pw2').setAttribute('value', 'S3cret!Pass-word'));
    const html = await page.evaluate(safeHtml);
    assert.ok(!html.includes('S3cret'), 'no password in the capture');
    assert.match(html, /data-automation-id="email"/);
    assert.equal(await page.inputValue('#pw'), 'S3cret!Pass-word', 'the live page is untouched');
  } finally {
    await page.close();
  }
});

// Workday wizard pages: synthetic fixtures with their widget behaviour (tests/fixtures/workday-widgets.js).
const WD_WIDGETS = readFileSync(join(FIX, 'workday-widgets.js'), 'utf8');
async function wdOpen(file) {
  const page = await browser.newPage();
  await page.route(/^https?:/, (r) => r.abort());
  await show(page, readFileSync(join(FIX, file), 'utf8').replace('<!-- workday-widgets -->', `<script>${WD_WIDGETS}</script>`));
  await page.evaluate(markRoot, 'workday');
  return page;
}
const wdBank = {
  profile: { first_name: 'Jordan', last_name: 'Example', full_name: 'Jordan Example', email: 'jordan@example.com', phone: '(555) 555-0199', phone_country: 'United States (+1)', city: 'Springfield, Illinois, United States', state: 'Illinois', zip: '62701', country: 'United States', street_address: '100 Main St', linkedin: 'https://www.linkedin.com/in/jordan-example' },
  facts: { work_authorization: 'Yes', sponsorship: 'No', how_heard: 'LinkedIn', remote: 'Yes' },
  eeo: EEO,
  learned: [],
};
const wdHistory = {
  work: [
    { title: 'CTO', company: 'Globex', from: '03/2023', to: null, current: true, description: 'Ctx' },
    { title: 'VP Engineering', company: 'Initech', from: '01/2021', to: '07/2024', current: false, description: 'Ctx' },
  ],
  education: [{ school: 'Springfield University', degree: "Master's Degree", field: 'Applied Mathematics', from: null, to: '2010' }],
};
const wdCtx = { cv: '/tmp/jordan-example-cv.pdf', coverNote: 'Letter text', today: '2026-11-09' };
const brief = (fields) => fields.map((f) => [f.label, f.kind, f.widget || '', f.required, Array.isArray(f.value) ? f.value.join('|') : f.value]);

test('Workday My Information: formField containers give label, kind and required (* in the label); listbox buttons and search prompts are dropdowns read on open; the radios take their sibling labels; the honeypot is skipped', { skip }, async () => {
  const page = await wdOpen('synthetic-workday-my-information.html');
  try {
    const snap = await page.evaluate(workdayFields);
    assert.deepEqual(brief(snap.fields), [
      ['How Did You Hear About Us?', 'select', 'wd-prompt', true, ''],
      ['Have you previously worked for Acme?', 'radio', '', true, ''],
      ['Country', 'select', 'wd-list', true, 'United States of America'],
      ['First Name', 'text', '', true, ''],
      ['Last Name', 'text', '', true, ''],
      ['I have a preferred name', 'checkbox', '', false, ''],
      ['Address Line 1', 'text', '', true, ''],
      ['City', 'text', '', true, ''],
      ['State', 'select', 'wd-list', true, ''],
      ['Postal Code', 'text', '', true, ''],
      ['Email Address', 'text', '', false, 'jordan@example.com'],
      ['Phone Device Type', 'select', 'wd-list', true, ''],
      ['Country Phone Code', 'select', 'wd-prompt', true, 'United States of America (+1)'],
      ['Phone Number', 'text', '', true, ''],
      ['Phone Extension', 'text', '', false, ''],
    ]);
    assert.deepEqual(snap.fields[1].options, ['Yes', 'No']);
    assert.equal(snap.fields[0].id, 'source--source');
    assert.deepEqual(snap.footer, ['Back', 'Save and Continue']);
    assert.equal(await page.locator('[data-automation-id="beecatcher"][data-hunt-key]').count(), 0);
    // The State list is read by opening it; then the plan picks from it.
    snap.fields[8].options = await wdListOptions(page.locator(`[data-hunt-key="${snap.fields[8].key}"]`));
    assert.deepEqual(snap.fields[8].options, ['Arizona', 'Illinois', 'Texas']);
    assert.equal(await page.locator('[role="listbox"][data-wd-popup]').count(), 0, 'the list is closed again, nothing chosen');
    snap.fields[11].options = await wdListOptions(page.locator(`[data-hunt-key="${snap.fields[11].key}"]`));
    const plan = workdayPlan(snap.fields, wdBank, wdCtx, { history: wdHistory, company: 'Acme Corp', known: 'Globex Initech Hooli' });
    const by = Object.fromEntries(plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).label, [a.action, a.value]]));
    assert.deepEqual(by['How Did You Hear About Us?'], ['pick', 'LinkedIn']);
    assert.deepEqual(by['Have you previously worked for Acme?'], ['radio', 'No']);
    assert.deepEqual(by['State'], ['pick', 'Illinois']);
    assert.deepEqual(by['First Name'], ['fill', 'Jordan']);
    assert.deepEqual(by['City'], ['fill', 'Springfield']);
    assert.deepEqual(by['Phone Number'], ['fill', '5555550199'], 'national digits beside the country phone code');
    assert.equal(by['Country'], undefined, 'already the answer');
    assert.equal(by['Country Phone Code'], undefined, 'already the answer');
    assert.deepEqual(plan.missing.map((m) => [m.label, m.reason]), [['Phone Device Type', 'no-answer']]);
    // A company the operator's claims name (a client, an employer) is asked, never answered No.
    const asked = workdayPlan(snap.fields, wdBank, wdCtx, { history: wdHistory, company: 'Hooli', known: 'Globex Initech Hooli' });
    assert.ok(asked.missing.some((m) => m.label === 'Have you previously worked for Acme?'));
  } finally { await page.close(); }
});

test('Workday widgets: wdPickList takes the option from a list that renders in the box or at the end of <body>; wdPickPrompt searches and picks an item into the pill', { skip }, async () => {
  const page = await wdOpen('synthetic-workday-my-information.html');
  try {
    const snap = await page.evaluate(workdayFields);
    const key = (label) => snap.fields.find((f) => f.label === label).key;
    assert.equal(await wdPickList(page.locator(`[data-hunt-key="${key('State')}"]`), 'Illinois'), true);
    assert.equal((await page.locator('#address--countryRegion').innerText()).trim(), 'Illinois');
    assert.equal(await wdPickPrompt(page.locator(`[data-hunt-key="${key('How Did You Hear About Us?')}"]`), 'LinkedIn'), true);
    assert.deepEqual(await page.locator('[data-fkit-id="source--source"] [data-automation-id="selectedItem"]').allInnerTexts(), ['LinkedIn']);
    assert.equal(await wdPickPrompt(page.locator(`[data-hunt-key="${key('How Did You Hear About Us?')}"]`), 'Glassdoor'), false, 'no such item: nothing picked');
    assert.deepEqual(await page.locator('[data-fkit-id="source--source"] [data-automation-id="selectedItem"]').allInnerTexts(), ['LinkedIn']);
    assert.equal(await wdCheckOption(page, key('Have you previously worked for Acme?'), 'No'), true);
    assert.equal(await page.locator('#pw-no').isChecked(), true);
  } finally { await page.close(); }
  const d = await wdOpen('synthetic-workday-disclosures.html');
  try {
    const snap = await d.evaluate(workdayFields);
    const g = snap.fields.find((f) => f.label === 'Veteran Status');
    const opts = await wdListOptions(d.locator(`[data-hunt-key="${g.key}"]`));
    assert.equal(opts.length, 3);
    assert.equal(await wdPickList(d.locator(`[data-hunt-key="${g.key}"]`), 'No', { choose: (t) => eeoPick(t, 'Veteran Status', wdBank.eeo) }), true);
    assert.equal((await d.locator('#personalInfoUS--veteranStatus').innerText()).trim(), 'I am not a protected veteran');
  } finally { await d.close(); }
});

test('Workday My Experience: Add renders an entry with page-numbered ids; entries are planned from the CV history (title, company, current box, MM/YYYY dates) and education; the resume slot takes the CV; dates are typed into their sections', { skip }, async () => {
  const page = await wdOpen('synthetic-workday-my-experience.html');
  try {
    let snap = await page.evaluate(workdayFields);
    assert.deepEqual(snap.sections, [{ name: 'Work Experience', entries: 0 }, { name: 'Education', entries: 0 }]);
    assert.deepEqual(workdayAdds(snap.sections, wdHistory), ['Work Experience', 'Work Experience', 'Education']);
    for (const name of workdayAdds(snap.sections, wdHistory)) assert.equal(await wdAddEntry(page, name), true);
    await page.evaluate(markRoot, 'workday');
    snap = await page.evaluate(workdayFields);
    assert.deepEqual(snap.sections, [{ name: 'Work Experience', entries: 2 }, { name: 'Education', entries: 1 }]);
    assert.deepEqual(workdayAdds(snap.sections, wdHistory), []);
    const from = snap.fields.find((f) => f.id === 'workExperience-7--startDate');
    assert.deepEqual([from.label, from.kind, from.widget, from.required, from.entry], ['From', 'date', 'wd-date', true, { section: 'workExperience', index: 0, part: 'startDate' }]);
    const plan = workdayPlan(snap.fields, wdBank, wdCtx, { history: wdHistory, company: 'Acme', known: '' });
    const by = Object.fromEntries(plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).id, [a.action, a.value]]));
    assert.deepEqual(by['workExperience-7--jobTitle'], ['fill', 'CTO']);
    assert.deepEqual(by['workExperience-7--companyName'], ['fill', 'Globex']);
    assert.deepEqual(by['workExperience-7--currentlyWorkHere'], ['check', null]);
    assert.deepEqual(by['workExperience-7--startDate'], ['wd-date', '03/2023']);
    assert.equal(by['workExperience-7--endDate'], undefined, 'a current role has no end date');
    assert.deepEqual(by['workExperience-8--companyName'], ['fill', 'Initech']);
    assert.equal(by['workExperience-8--currentlyWorkHere'], undefined, 'already unticked');
    assert.deepEqual(by['workExperience-8--endDate'], ['wd-date', '07/2024']);
    assert.equal(by['workExperience-7--location'], undefined, 'optional, no fact: left blank');
    assert.equal(by['workExperience-7--roleDescription'], undefined, 'optional: left blank');
    assert.deepEqual(by['education-12--schoolName'], ['fill', 'Springfield University']);
    assert.deepEqual(by['education-12--degree'], ['pick', "Master's Degree"]);
    assert.deepEqual(by['education-12--fieldOfStudy'], ['pick', 'Applied Mathematics']);
    assert.deepEqual(by['education-12--lastYearAttended'], ['wd-date', '2010']);
    assert.deepEqual(by['resumeAttachments--attachments'], ['file', '/tmp/jordan-example-cv.pdf']);
    assert.deepEqual(by['socialNetworkAccounts--linkedInAccount'], ['fill', 'https://www.linkedin.com/in/jordan-example']);
    assert.deepEqual(plan.missing, []);
    // Dates go in key by key, section by section.
    assert.equal(await wdTypeDate(page, from.key, '03/2023'), true);
    assert.equal(await page.inputValue('#workExperience-7--startDate-dateSectionMonth-input'), '03');
    assert.equal(await page.inputValue('#workExperience-7--startDate-dateSectionYear-input'), '2023');
    const year = snap.fields.find((f) => f.id === 'education-12--lastYearAttended');
    assert.equal(await wdTypeDate(page, year.key, '2010'), true);
    // The uploaded CV shows by name in the slot.
    await page.locator('[data-automation-id="file-upload-input-ref"]').setInputFiles({ name: 'jordan-example-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.waitForTimeout(400);
    const after = await page.evaluate(workdayFields);
    assert.deepEqual(after.fields.find((f) => f.kind === 'file').value, ['jordan-example-cv.pdf']);
  } finally { await page.close(); }
});

test('Workday Application Questions, Voluntary Disclosures, Self Identify and Review: questionnaire lists answered from the bank, unknown ones asked; EEO picks; the terms box is consent; the disability boxes are one question; the date signed is today; Review\'s footer is Submit', { skip }, async () => {
  const q = await wdOpen('synthetic-workday-questions.html');
  try {
    const snap = await q.evaluate(workdayFields);
    for (const f of snap.fields) if (f.widget === 'wd-list') f.options = await wdListOptions(q.locator(`[data-hunt-key="${f.key}"]`));
    assert.deepEqual(brief(snap.fields).map((x) => x.slice(0, 4)), [
      ['Are you legally authorized to work in the United States?', 'select', 'wd-list', true],
      ['Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?', 'select', 'wd-list', true],
      ['Do you have a current active security clearance?', 'select', 'wd-list', true],
      ['Which work arrangements are you open to?', 'radio', '', true],
      ['Is there anything else you would like us to know?', 'textarea', '', false],
    ]);
    const plan = workdayPlan(snap.fields, wdBank, wdCtx, { history: wdHistory, company: 'Acme', known: '' });
    assert.deepEqual(plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).label.slice(0, 20), a.action, a.value]), [
      ['Are you legally auth', 'pick', 'Yes'], ['Will you now or in t', 'pick', 'No'], ['Is there anything el', 'fill', 'Letter text'],
    ]);
    assert.deepEqual(plan.missing.map((m) => m.label), ['Do you have a current active security clearance?', 'Which work arrangements are you open to?']);
  } finally { await q.close(); }
  const d = await wdOpen('synthetic-workday-disclosures.html');
  try {
    const snap = await d.evaluate(workdayFields);
    const plan = workdayPlan(snap.fields, wdBank, wdCtx, { history: wdHistory, company: 'Acme', known: '' });
    // The pick carries its label; eeoPick chooses the option once the list is open. A Workday
    // "Ethnicity" list that lists races is the race question (Asian here), not the Hispanic one.
    assert.deepEqual(plan.actions.map((a) => [a.action, a.eeo]), [['pick', 'Gender'], ['pick', 'Ethnicity'], ['pick', 'Veteran Status']]);
    const eth = snap.fields.find((f) => f.label === 'Ethnicity');
    assert.equal(eeoPick(await wdListOptions(d.locator(`[data-hunt-key="${eth.key}"]`)), 'Ethnicity', wdBank.eeo), 'Asian (Not Hispanic or Latino) (United States of America)');
    assert.deepEqual(plan.missing.map((m) => [m.label, m.reason]), [['Yes, I have read and consent to the terms and conditions', 'consent']]);
  } finally { await d.close(); }
  const s = await wdOpen('synthetic-workday-self-identify.html');
  try {
    const snap = await s.evaluate(workdayFields);
    const ds = snap.fields.find((f) => f.id === 'selfIdentifiedDisabilityData--disabilityStatus');
    assert.deepEqual([ds.kind, ds.checkboxes, ds.options.length], ['radio', true, 3]);
    const plan = workdayPlan(snap.fields, wdBank, wdCtx, { history: wdHistory, company: 'Acme', known: '' });
    const by = Object.fromEntries(plan.actions.map((a) => [snap.fields.find((f) => f.key === a.key).id, [a.action, a.value]]));
    assert.deepEqual(by['selfIdentifiedDisabilityData--name'], ['fill', 'Jordan Example']);
    assert.deepEqual(by['selfIdentifiedDisabilityData--dateSignedOn'], ['wd-date', '11/09/2026']);
    assert.deepEqual(by['selfIdentifiedDisabilityData--disabilityStatus'], ['radio', 'No, I do not have a disability and have not had one in the past']);
    assert.equal(by['selfIdentifiedDisabilityData--disabilityForm'], undefined);
    assert.deepEqual(plan.missing, []);
    assert.equal(await wdCheckOption(s, ds.key, 'No, I do not have a disability and have not had one in the past'), true);
    assert.deepEqual(await s.locator('input[name="disabilityStatus"]').evaluateAll((els) => els.map((e) => e.checked)), [false, true, false]);
    assert.equal(await wdTypeDate(s, snap.fields.find((f) => f.id === 'selfIdentifiedDisabilityData--dateSignedOn').key, '11/09/2026'), true);
  } finally { await s.close(); }
  const r = await wdOpen('synthetic-workday-review.html');
  try {
    const p = await r.evaluate(workdayPage);
    assert.equal(workdayStage(p), 'review');
    const snap = await r.evaluate(workdayFields);
    assert.equal(submitLabel(snap.footer), 'Submit');
  } finally { await r.close(); }
});

// ---------- Walmart (careers.walmart.com) ----------
async function walmartSnap(file, fn) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, file), 'utf8'), { waitUntil: 'domcontentloaded' });
    return await fn(page);
  } finally {
    await page.close();
  }
}

test('Walmart job page: the shown "Apply now" only (its responsive panes hide the others), and the stage is job', { skip }, async () => {
  const p = await walmartSnap('synthetic-walmart-job.html', (page) => page.evaluate(walmartPage));
  assert.deepEqual(p.apply, [{ label: 'Apply now', disabled: false }]);
  assert.equal(p.form, false);
  assert.equal(p.email, false);
  assert.equal(walmartStage(p), 'job');
});

test('Walmart contact page: the email box and the site terms box, its label without the Read more button, unticked; stage contact; the box is the operator\'s consent, asked unless answered', { skip }, async () => {
  const p = await walmartSnap('synthetic-walmart-contact.html', (page) => page.evaluate(walmartPage));
  assert.equal(p.email, true);
  assert.equal(p.consent.length, 1);
  assert.equal(p.consent[0].label, 'I understand and accept the Website Terms & Conditions and Privacy Policy available on our website as well as the Terms and Conditions.');
  assert.equal(p.consent[0].checked, false);
  assert.equal(p.consent[0].id, 'mvk-info-r3-input');
  assert.equal(walmartStage(p), 'contact');
  const boxes = p.consent.map((c, i) => ({ key: `wmc${i}`, kind: 'checkbox', label: c.label, required: true, options: [], value: c.checked ? 'on' : '' }));
  assert.deepEqual(planFill(boxes, bank, { cv: '/tmp/cv.pdf' }).missing.map((m) => m.reason), ['consent']);
  const said = { ...bank, learned: [{ label: normLabel(p.consent[0].label), answer: 'Yes', source: 'test' }] };
  assert.deepEqual(planFill(boxes, said, { cv: '/tmp/cv.pdf' }).actions.map((a) => a.action), ['check']);
});

test('Walmart code page: six code boxes, stage otp', { skip }, async () => {
  const p = await walmartSnap('synthetic-walmart-otp.html', (page) => page.evaluate(walmartPage));
  assert.equal(p.otp, 6);
  assert.equal(walmartStage(p), 'otp');
});

test('Walmart questionnaire page: the root is the questionnaire form, not the header search; fields by their LD labels; Next is the step, "Use my last application" is never one; the progress title is read', { skip }, async () => {
  const r = await walmartSnap('synthetic-walmart-questionnaire.html', async (page) => {
    const p = await page.evaluate(walmartPage);
    const marked = await page.evaluate(markRoot, 'walmart');
    const rootIsForm = await page.evaluate(() => document.querySelector('[data-hunt-root]')?.getAttribute('aria-labelledby'));
    const snap = await page.evaluate(collectForm);
    return { p, marked, rootIsForm, snap };
  });
  assert.equal(walmartStage(r.p), 'questionnaire');
  assert.equal(r.p.progress, 'About you Personal information Step 1 of 4');
  assert.equal(r.p.ssn, false);
  assert.equal(r.marked, true);
  assert.equal(r.rootIsForm, 'questionnaire-title');
  const byLabel = Object.fromEntries(r.snap.fields.map((f) => [f.label, f]));
  assert.deepEqual(r.snap.fields.map((f) => f.kind), ['file', 'text', 'text', 'text', 'radio', 'select']);
  assert.equal(byLabel['Upload resume *'].kind, 'file');
  assert.equal(byLabel['Legal first name (Required)*'].required, true);
  assert.deepEqual(byLabel['Are you a current or former Walmart associate?*'].options, ['Yes, I am a current associate', 'Yes, I am a former associate', 'No']);
  assert.ok(!r.snap.fields.some((f) => /search/i.test(f.label)));
  const nav = walmartNav(r.snap.buttons, r.snap.text);
  assert.deepEqual(nav, { review: false, submit: null, next: 'Next', jobs: null });
  const plan = planFill(r.snap.fields, { ...bank, profile: { ...bank.profile, phone: '+1 555 0100' } }, { cv: '/tmp/cv.pdf' });
  assert.deepEqual(plan.actions.map((a) => a.source), ['cv', 'first_name', 'last_name', 'phone', 'work_authorization']);
  assert.deepEqual(plan.missing.map((m) => m.label), ['Are you a current or former Walmart associate?*']);
});

test('Walmart review page: Edit per section makes it the review; Submit is the submit and never a Next', { skip }, async () => {
  const r = await walmartSnap('synthetic-walmart-review.html', async (page) => {
    await page.evaluate(markRoot, 'walmart');
    return page.evaluate(collectForm);
  });
  assert.deepEqual(walmartNav(r.buttons, r.text), { review: true, submit: 'Submit', next: null, jobs: null });
});

test('WALMART_SEL: each selector the runner clicks or types into finds exactly the one shown control (Continue has no test id, and the header search form has a submit button too)', { skip }, async () => {
  const count = (file, sel) => walmartSnap(file, (page) => page.locator(sel).count());
  assert.equal(await count('synthetic-walmart-job.html', WALMART_SEL.apply), 1);
  assert.equal(await count('synthetic-walmart-contact.html', WALMART_SEL.email), 1);
  assert.equal(await count('synthetic-walmart-contact.html', WALMART_SEL.continue), 1);
  assert.equal(await walmartSnap('synthetic-walmart-contact.html', (page) => page.locator(WALMART_SEL.continue).getAttribute('aria-label')), 'Continue');
  assert.equal(await count('synthetic-walmart-otp.html', WALMART_SEL.otp), 6);
  assert.equal(await count('synthetic-walmart-otp.html', WALMART_SEL.verify), 1);
});

// ---------- iCIMS (*.icims.com) ----------
async function icimsSnap(file, fn) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, readFileSync(join(FIX, file), 'utf8'), { waitUntil: 'domcontentloaded' });
    return await fn(page);
  } finally {
    await page.close();
  }
}

test('iCIMS job page: the "Apply for this job online" link only (not Share, not the hidden search box), stage job', { skip }, async () => {
  const p = await icimsSnap('synthetic-icims-job.html', (page) => page.evaluate(icimsPage));
  assert.deepEqual(p.apply, ['Apply for this job online']);
  assert.equal(p.heading, 'Staff Software Engineer');
  assert.equal(p.inputs, 0);
  assert.equal(p.email, false);
  assert.equal(icimsStage(p), 'job');
  assert.equal(await icimsSnap('synthetic-icims-job.html', async (page) => { await page.evaluate(icimsPage); return page.locator(ICIMS_SEL.apply).count(); }), 1);
});

// What the runner's shownFrames() reads: every iframe and whether it is shown.
const frameVis = () => [...document.querySelectorAll('iframe')].filter((f) => f.src).map((f) => { const r = f.getBoundingClientRect(); const cs = getComputedStyle(f); return { src: f.src, visible: r.width > 20 && r.height > 20 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 }; });

test('iCIMS login page, live capture A: the email box and the privacy box, named with the GDPR block before it because the box itself says only "I accept"; stage login; the box is the operator\'s consent, asked unless answered; the invisible hCaptcha and its badge are no bot check', { skip }, async () => {
  const r = await icimsSnap('icims-login-acme.html', async (page) => {
    const p = await page.evaluate(icimsPage);
    const counts = {};
    for (const k of ['email', 'next', 'consent']) counts[k] = await page.locator(ICIMS_SEL[k]).count();
    const frames = await page.evaluate(frameVis);
    return { p, counts, frames };
  });
  assert.equal(r.p.heading, 'Enter Your Information');
  assert.equal(r.p.email, true);
  assert.equal(r.p.inputs, 2);
  assert.deepEqual(r.p.consent, [{ label: 'Acme Corp Candidate Privacy Policy Consent Please acknowledge that you\'ve read the Acme Corp Candidate Privacy Policy. I accept', checked: false }]);
  assert.equal(icimsStage(r.p), 'login');
  assert.deepEqual(r.counts, { email: 1, next: 1, consent: 1 });
  const boxes = r.p.consent.map((c, i) => ({ key: `icc${i}`, kind: 'checkbox', label: c.label, required: true, options: [], value: c.checked ? 'on' : '' }));
  assert.deepEqual(planFill(boxes, bank, { cv: '/tmp/cv.pdf' }).missing.map((m) => m.reason), ['consent']);
  const said = { ...bank, learned: [{ label: normLabel(r.p.consent[0].label), answer: 'Yes', source: 'test' }] };
  assert.deepEqual(planFill(boxes, said, { cv: '/tmp/cv.pdf' }).actions.map((a) => a.action), ['check']);
  assert.equal(r.frames.length, 2);
  assert.ok(r.frames.every((f) => f.visible === false));
  assert.equal(blockerIn({ hasPassword: false, frames: r.frames }), null);
  assert.equal(challengeIn({ text: r.p.text, frames: r.frames }), false);
});

test('iCIMS login page, live capture B: the privacy box carries its own full label; stage login; Next is the disabled submit input, tagged for the runner', { skip }, async () => {
  const r = await icimsSnap('icims-login-globex.html', async (page) => {
    const p = await page.evaluate(icimsPage);
    const next = await page.locator(ICIMS_SEL.next).evaluate((el) => ({ id: el.id, disabled: el.disabled }));
    const consentId = await page.locator(`${ICIMS_SEL.consent}[data-hunt-consent="0"]`).getAttribute('id');
    return { p, next, consentId };
  });
  assert.deepEqual(r.p.consent, [{ label: 'I confirm I have read the Candidate Data Privacy Notice linked below.', checked: false }]);
  assert.equal(r.p.inputs, 2);
  assert.equal(icimsStage(r.p), 'login');
  assert.deepEqual(r.next, { id: 'enterEmailSubmitButton', disabled: true });
  assert.equal(r.consentId, 'accept_privacy');
  assert.deepEqual(r.p.buttons, []);
  assert.deepEqual(r.p.errors, []);
});

test('iCIMS candidate profile: an application page, not a login, though it shows an email box; the shared collector reads the CV slot and the fields; Next is the step and the import buttons are never taken', { skip }, async () => {
  const r = await icimsSnap('synthetic-icims-profile.html', async (page) => {
    const p = await page.evaluate(icimsPage);
    await page.evaluate(markRoot, 'form');
    const snap = await page.evaluate(collectForm);
    return { p, snap };
  });
  assert.equal(r.p.file, true);
  assert.equal(r.p.email, true);
  assert.equal(r.p.heading, 'Candidate Profile');
  assert.equal(icimsStage({ ...r.p, url: 'https://careers-acme.icims.com/jobs/1001/staff-software-engineer/candidate?in_iframe=1' }), 'profile');
  const plan = planFill(r.snap.fields, { ...bank, profile: { ...bank.profile, phone: '+1 555 0100' } }, { cv: '/tmp/cv.pdf' });
  assert.deepEqual(plan.actions.map((a) => a.source), ['cv', 'first_name', 'last_name', 'email', 'phone']);
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(icimsNav(r.snap.buttons, 'profile'), { review: false, submit: null, next: 'Next', held: null });
});

// iCIMS career sites draw the portal in iframe#icims_content_iframe and bounce a top-level in_iframe=1
// load back to the outer page: the runner drives the form inside the frame.
const IC_FRAMED = `<!doctype html><html><body><header><input type="search" aria-label="Search jobs"></header>
<iframe name="icims_content_iframe" title="iCIMS Content iFrame" style="width:100%;height:400px" srcdoc="<form><p>Are you legally authorized to work in the United States?</p>
<label><input type='radio' name='auth' value='Y'><span>Yes</span></label><label><input type='radio' name='auth' value='N'><span>No</span></label>
<input type='checkbox' id='terms'><label for='terms'>I accept</label></form>"></iframe></body></html>`;

test('framed(): inside the portal iframe, lookups and evaluate stay in the frame while the keyboard and screenshots are the page\'s; checkLabelRadio confirms a radio inside the frame (iCIMS)', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    await show(page, IC_FRAMED, { waitUntil: 'load' });
    const frame = page.frame({ name: 'icims_content_iframe' });
    const site = framed(page, () => page.frame({ name: 'icims_content_iframe' }) || page.mainFrame());
    assert.equal(await site.evaluate(() => document.querySelectorAll('input[type="radio"]').length), 2);
    assert.equal(await site.locator('input[type="search"]').count(), 0);
    assert.equal(site.keyboard, page.keyboard);
    assert.equal(typeof site.screenshot, 'function');
    assert.equal(site.url(), frame.url());
    assert.equal(await checkLabelRadio(frame.locator('input[value="Y"]')), true);
    assert.equal(await frame.evaluate(() => document.querySelector('input[value="Y"]').checked), true);
    assert.equal(await setBox(frame.locator('#terms'), true), true);
  } finally {
    await page.close();
  }
});

test('iCIMS account and code steps (synthetic, unseen live): two password boxes are a new account, tagged for the 1Password fill; a one-time-code box is the verification and a postal code box is not; the badge is no bot check', { skip }, async () => {
  const a = await icimsSnap('synthetic-icims-account.html', async (page) => {
    const p = await page.evaluate(icimsPage);
    const pw = await page.locator(ICIMS_SEL.password).count();
    const submit = await page.locator(`form:has(${ICIMS_SEL.password}) input[type="submit"]`).count();
    return { p, pw, submit };
  });
  assert.equal(a.p.passwords, 2);
  assert.equal(icimsStage(a.p), 'create-account');
  assert.equal(a.pw, 2);
  assert.equal(a.submit, 1);
  assert.deepEqual(a.p.consent.map((c) => c.label), ['I agree to the Terms of Use and the Privacy Policy.']);
  assert.equal(challengeIn({ text: a.p.text, frames: [] }), false);
  const c = await icimsSnap('synthetic-icims-code.html', async (page) => {
    const p = await page.evaluate(icimsPage);
    const ids = await page.locator(ICIMS_SEL.code).evaluateAll((els) => els.map((e) => e.id));
    return { p, ids };
  });
  assert.equal(c.p.code, 1);
  assert.deepEqual(c.ids, ['verificationCode']);
  assert.equal(icimsStage(c.p), 'verify-code');
});

test('iCIMS review page (synthetic, unseen live): stage review with no inputs; the shared collector lists Back and Submit, and icimsNav takes Submit, never Edit or Back', { skip }, async () => {
  const r = await icimsSnap('synthetic-icims-review.html', async (page) => {
    const p = await page.evaluate(icimsPage);
    await page.evaluate(markRoot, 'form');
    return { p, snap: await page.evaluate(collectForm) };
  });
  assert.equal(r.p.inputs, 0);
  assert.equal(icimsStage(r.p), 'review');
  assert.deepEqual(r.snap.fields, []);
  assert.deepEqual(icimsNav(r.snap.buttons, 'review'), { review: true, submit: 'Submit', next: null, held: null });
});

// ---------- iCIMS Candidate Profile that also creates the login (live captures, scrubbed) ----------
const IC_WIDGETS = readFileSync(join(FIX, 'icims-widgets.js'), 'utf8');
const IC_LISTS = {
  '-1_PersonProfileFields.AddressState': { 'United States': ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'Illinois', 'Indiana'] },
  '-1_CandProfileFields.School': ['*N/A', '*Other', 'Aalborg University', 'Aalto University', 'Springfield University', 'Springfield University of Applied Sciences', 'Stanford University'],
};
async function icimsProfile(file, fn) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const html = readFileSync(join(FIX, file), 'utf8').replace('<!-- icims-widgets -->', `<script>window.ICIMS_LISTS = ${JSON.stringify(IC_LISTS)};</script><script>${IC_WIDGETS}</script>`);
    await show(page, html, { waitUntil: 'domcontentloaded' });
    return await fn(page);
  } finally {
    await page.close();
  }
}
const icDomBank = {
  ...bank,
  profile: { ...bank.profile, phone: '(555) 555-0100', city: 'Springfield, Illinois, United States', country: 'United States', state: 'Illinois', street_address: '100 Main St', zip: '62701' },
  learned: [{ label: 'school', answer: 'Springfield University of Applied Sciences', source: 'test' }, { label: 'degree', answer: "Master's Degree", source: 'test' }],
};
const icLabel = (snap, re) => snap.fields.find((f) => re.test(f.label));

test('iCIMS profile with "Create a login", live capture B: stage account-profile; the dropdown widgets are select fields named by their labels (consent Yes/No lists read, searchable lists left to the search), the passwords are not fields, the search boxes are not fields; the plan fills the CV, Login, name, phone, city, Country before State, School, Degree, and asks Current Industry and the SMS and TCAI consents; Next moves on', { skip }, async () => {
  const r = await icimsProfile('icims-profile-globex.html', async (page) => {
    const p = await page.evaluate(icimsPage);
    await page.evaluate(markRoot, 'form');
    return { p, snap: await page.evaluate(collectForm), root: await page.evaluate(() => document.querySelector('[data-hunt-root]')?.id) };
  });
  assert.equal(icimsStage(r.p), 'account-profile');
  assert.equal(r.p.passwords, 2);
  assert.equal(r.root, 'profileForm');
  assert.equal(r.snap.hasPassword, true);
  assert.ok(!r.snap.fields.some((f) => /type to search/i.test(f.label)));
  const widgets = r.snap.fields.filter((f) => f.widget === 'icims').map((f) => [f.id, f.required, f.options, !!f.search]);
  assert.deepEqual(widgets, [
    ['rcf9553', true, ['Yes', 'No'], false],
    ['-1_PersonProfileFields.AddressState', true, [], true],
    ['-1_PersonProfileFields.AddressCountry', true, [], true],
    ['-1_CandProfileFields.School', true, [], true],
    ['-1_CandProfileFields.Degree', true, [], true],
    ['rcf9339', true, ['Yes', 'No'], false],
  ]);
  assert.equal(icLabel(r.snap, /^School$/).value, '');
  const plan = icimsPlan(r.snap.fields, icDomBank, { cv: '/tmp/cv.pdf' }, { login: 'jordan@example.com' });
  const label = (k) => r.snap.fields.find((f) => f.key === k).label;
  assert.deepEqual(plan.actions.map((a) => [label(a.key), a.action, a.source]), [
    ['Please upload your resume (Max size: 5 MB)', 'file', 'cv'],
    ['Login', 'fill', 'account'],
    ['Legal First Name', 'fill', 'first_name'],
    ['Legal Last Name', 'fill', 'last_name'],
    ['Email', 'fill', 'email'],
    ['Phone Number', 'fill', 'phone'],
    ['City', 'fill', 'city'],
    ['Country', 'pick', 'country'],
    ['State/Province', 'pick', 'state'],
    ['School', 'pick', 'learned'],
    ['Degree', 'pick', 'learned'],
  ]);
  assert.deepEqual(plan.missing.map((m) => [m.label.slice(0, 40), m.reason]), [
    ['Current Industry', 'no-answer'],
    ['Do you agree to receive automated text m', 'consent'],
    ['Do you consent to the use of iCIMS Talen', 'consent'],
  ]);
  assert.deepEqual(icimsNav(r.snap.buttons, 'account-profile').next, 'Next');
});

test('iCIMS profile with "Create a login", live capture A: its extra fields: the phone labelled "Number", the phone and address "Type" lists, street and zip, LinkedIn; required Preferred names asked; the hidden Source rows are not fields; "Submit Profile" moves on', { skip }, async () => {
  const r = await icimsProfile('icims-profile-acme.html', async (page) => {
    const p = await page.evaluate(icimsPage);
    await page.evaluate(markRoot, 'form');
    return { p, snap: await page.evaluate(collectForm) };
  });
  assert.equal(icimsStage(r.p), 'account-profile');
  assert.ok(!r.snap.fields.some((f) => /how did you hear|please specify/i.test(f.label)));
  const plan = icimsPlan(r.snap.fields, icDomBank, { cv: '/tmp/cv.pdf' }, { login: 'jordan@example.com' });
  const label = (k) => r.snap.fields.find((f) => f.key === k).label;
  assert.deepEqual(plan.actions.map((a) => [label(a.key), a.source]), [
    ['Please upload your resume (Max size: 5 MB)', 'cv'],
    ['Legal First Name', 'first_name'],
    ['Legal Last Name', 'last_name'],
    ['Email', 'email'],
    ['Number', 'phone'],
    ['Address', 'street_address'],
    ['City', 'city'],
    ['Zip/Postal Code', 'zip'],
    ['LinkedIn Profile (URL)', 'linkedin'],
    ['Email/Login', 'account'],
    ['Country', 'country'],
    ['State/Province', 'state'],
  ]);
  assert.deepEqual(plan.missing.map((m) => [m.label.slice(0, 40), m.reason]), [
    ['Preferred First Name', 'no-answer'],
    ['Preferred Last Name', 'no-answer'],
    ['Phone Type', 'no-answer'],
    ['Address Type', 'no-answer'],
    ['Do you wish to receive text message noti', 'consent'],
    ['Do you consent to use of Automated Emplo', 'consent'],
  ]);
  assert.equal(icimsNav(r.snap.buttons, 'account-profile').next, 'Submit Profile');
});

test('icimsPick: an iCIMS dropdown picks a shown option; a searchable list is typed into until the option shows (School); a State list answers once its Country is chosen; an option the list lacks is no pick and the list closes', { skip }, async () => {
  const r = await icimsProfile('icims-profile-globex.html', async (page) => {
    const a = (sid) => page.locator(`[id="${sid}_icimsDropdown"]`);
    const out = {};
    out.stateFirst = await icimsPick(a('-1_PersonProfileFields.AddressState'), 'Illinois');
    out.country = await icimsPick(a('-1_PersonProfileFields.AddressCountry'), 'United States');
    out.state = await icimsPick(a('-1_PersonProfileFields.AddressState'), 'Illinois');
    out.school = await icimsPick(a('-1_CandProfileFields.School'), 'Springfield University of Applied Sciences');
    out.degree = await icimsPick(a('-1_CandProfileFields.Degree'), "Master's Degree");
    out.none = await icimsPick(a('-1_CandProfileFields.Degree'), 'Doctorate of Wizardry');
    out.open = await page.locator('[id="-1_CandProfileFields.Degree_icimsDropdown_ctnr"]').isVisible();
    out.values = await page.evaluate(() => ['-1_PersonProfileFields.AddressCountry', '-1_PersonProfileFields.AddressState', '-1_CandProfileFields.School', '-1_CandProfileFields.Degree'].map((id) => document.getElementById(id).value));
    await page.evaluate(markRoot, 'form');
    out.snap = await page.evaluate(collectForm);
    return out;
  });
  assert.equal(r.stateFirst, false);
  assert.deepEqual([r.country, r.state, r.school, r.degree, r.none, r.open], [true, true, true, true, false, false]);
  assert.deepEqual(r.values, ['United States', 'Illinois', 'Springfield University of Applied Sciences', "Master's Degree"]);
  assert.equal(icLabel(r.snap, /^School$/).value, 'Springfield University of Applied Sciences');
  const plan = icimsPlan(r.snap.fields, icDomBank, { cv: '/tmp/cv.pdf' }, { login: 'jordan@example.com' });
  assert.ok(!plan.actions.some((x) => x.action === 'pick'), 'picked widgets read back as answered');
});

test('icimsPickOther: a school the list lacks picks the list\'s Other entry and goes into the Other School box', { skip }, async () => {
  const r = await icimsProfile('icims-profile-globex.html', async (page) => {
    const a = page.locator('[id="-1_CandProfileFields.School_icimsDropdown"]');
    const miss = await icimsPick(a, 'Unlisted Institute of Technology');
    const ok = await icimsPickOther(a, 'Unlisted Institute of Technology');
    const values = await page.evaluate(() => ['-1_CandProfileFields.School', '-1_CandProfileFields.OtherSchool'].map((id) => document.getElementById(id).value));
    const none = await icimsPickOther(page.locator('[id="-1_CandProfileFields.Degree_icimsDropdown"]'), 'Doctorate of Wizardry');
    return { miss, ok, values, none };
  });
  assert.equal(r.miss, false);
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, ['*Other', 'Unlisted Institute of Technology']);
  assert.equal(r.none, false, 'no Other box for Degree: no fallback');
});

test('icimsPick: the shown text lands late (live AJAX widget, an AEDT consent list): the pick waits for it instead of failing at 600 ms', { skip }, async () => {
  const r = await icimsProfile('icims-profile-globex.html', async (page) => {
    await page.evaluate(() => { window.ICIMS_TEXT_DELAY = 1200; });
    return icimsPick(page.locator('[id="rcf9339_icimsDropdown"]'), 'Yes');
  });
  assert.equal(r, true);
});

test('icimsPick: a list that searches only on a real keyup (a live School list) still finds the answer and the Other entry', { skip }, async () => {
  const r = await icimsProfile('icims-profile-globex.html', async (page) => {
    await page.evaluate(() => { window.ICIMS_TRUSTED_KEYS = true; });
    const a = page.locator('[id="-1_CandProfileFields.School_icimsDropdown"]');
    const found = await icimsPick(a, 'Stanford University');
    const other = await icimsPickOther(a, 'Unlisted Institute of Technology');
    const values = await page.evaluate(() => ['-1_CandProfileFields.School', '-1_CandProfileFields.OtherSchool'].map((id) => document.getElementById(id).value));
    return { found, other, values };
  });
  assert.equal(r.found, true);
  assert.equal(r.other, true);
  assert.deepEqual(r.values, ['*Other', 'Unlisted Institute of Technology']);
});

// ---------- react-select v1 lists (tests/fixtures/rs1-application.html) ----------
// A single-page company-site form whose education lists are react-select v1: typed text is dropped on blur, so a
// run that only typed into University, Degree and Field of Study left all three empty.
const RS_WIDGET = readFileSync(join(FIX, 'react-select-v1.js'), 'utf8');
const RS_LISTS = {
  'university-autocomplete-input-0': ['Example Institute of Technology', 'Example State University', 'Example State University of Science, Technology and Arts', 'Example Polytechnic University', 'Other'],
  'degree-autocomplete-field-0': ["Associate's Degree", "Bachelor's Degree", 'Master of Arts (MA)', 'Master of Business Administration (MBA)', 'Master of Science (MS)', "Master's Degree", 'Doctor of Philosophy (PhD)', 'Other'],
  'field-of-study-label-0': ['Applied Mathematics', 'Computer Science', 'Economics', 'Information Systems', 'Other'],
  'honors-label-0': ['Cum Laude', 'Magna Cum Laude', 'Summa Cum Laude'],
  'candidate-award-label': ['Example Merit Scholarship', 'Other'],
};
// The virtualized widget (mode 'virtualized', react-virtualized-select over v1) with lists shaped like a site's
// reference data: schools written "<name> - <abbreviation> - <country>", or plain v1 (mode 'v1') with the lists above.
const MATH = ['Actuarial Mathematics', 'Business Mathematics', 'Combinatorial Mathematics', 'Computational Mathematics', 'Discrete Mathematics', 'Educational Mathematics', 'Engineering Mathematics', 'Experimental Mathematics', 'Financial Mathematics', 'Industrial Mathematics', 'Mathematics & Philosophy', 'Mathematics & Physics', 'Mathematics Education', 'Mathematics and Computing', 'Mathematics and Statistics', 'Numerical Mathematics', 'Pure Mathematics', 'Recreational Mathematics', 'Theoretical Mathematics', 'Biomathematics', 'Mathematics for Finance', 'Geomathematics', 'Mathematics & Economics', 'Mathematics', 'Quantitative Mathematics', 'Topological Mathematics', 'Statistical Mathematics', 'Systems Mathematics', 'Mathematics Teaching', 'Logic & Mathematics'];
const DS_LISTS = {
  'university-autocomplete-input-0': ['Brotherhood College - BC - Freedonia', 'Example Aviation Institute - EAI - Freedonia', 'Example Institute of Electronics and Mathematics - EIEM - Freedonia', 'Example Institute of Physics and Technology - EIPT - Freedonia', 'Example Medical Academy - EMA - Freedonia', 'Example Mining University - Freedonia', 'Example Power Engineering Institute - EPEI - Freedonia', 'Example State Linguistic University - ESLU - Freedonia', 'Example State University - ESU - Freedonia', 'Example State University of Civil Engineering - ESUCE - Freedonia', 'Example State University of Railway Engineering - ESURE - Freedonia', 'Example Technical University - ETU - Freedonia', 'Example Technical University of Communications - ETUC - Freedonia', 'International University of Example - IUE - Freedonia', 'National Example University of Science - NEUS - Freedonia', 'Northern Example University - NEU - Freedonia', 'Example Polytechnic University - US', 'University of Example Business - UEB - Freedonia', 'Example State University of Science Technology and Arts - ESUSTA - Freedonia', 'Other'],
  'degree-autocomplete-field-0': ["Bachelor's Degree", 'Doctor of Philosophy (PhD)', 'Master of Arts', 'Master of Business Administration', 'Master of Computing', 'Master of Science (Bachelor’s degree)', 'Master of Science (MS)', 'Master of Science (MSc)', 'Master of Veterinary Physiotherapy', "Master's Degree", 'Other'],
  // "Mathematics" is the 24th of the 30 "Mathematics" matches, past the rows rendered at first.
  'field-of-study-label-0': [...MATH, 'Applied Chemistry', 'Applied Mathematics', 'Applied Physics', 'Computational Linguistics', 'Computer Science', 'Computer Science and Statistics', 'Information Systems', 'Linguistics', 'Other', 'Psycholinguistics', 'Psychotherapy', 'Sociolinguistics'],
  'honors-label-0': ["Dean's List", 'Summa Cum Laude', 'Magna Cum Laude', 'Cum Laude', 'Other'],
  'candidate-award-label': ['Example Merit Scholarship', 'Other'],
};
const DS_LINKS = { 'university-autocomplete-input-0': 'university', 'degree-autocomplete-field-0': 'degree' };
const DS_OTHER_BOXES = {
  'university-autocomplete-input-0': { id: 'otherUniversityName-0', label: 'Please specify your University name' },
  'degree-autocomplete-field-0': { id: 'other-degree-name-0', label: 'Please specify your Degree' },
  'honors-label-0': { id: 'other-honor-name-0', label: 'Please specify your Honor' },
};
async function rs1(fn, { mode = 'virtualized', lists = mode === 'v1' ? RS_LISTS : DS_LISTS, delay = null } = {}) {
  const page = await browser.newPage();
  try {
    await page.route(/^https?:/, (r) => r.abort());
    const setup = `<script>window.RS_MODE = ${JSON.stringify(mode)}; window.RS_LISTS = ${JSON.stringify(lists)}; window.RS_LINKS = ${JSON.stringify(DS_LINKS)}; window.RS_OTHER_BOXES = ${JSON.stringify(DS_OTHER_BOXES)};${delay == null ? '' : ` window.RS_DELAY = ${delay};`}</script><script>${RS_WIDGET}</script>`;
    await show(page, readFileSync(join(FIX, 'rs1-application.html'), 'utf8').replace('<!-- react-select-v1 -->', setup), { waitUntil: 'domcontentloaded' });
    return await fn(page);
  } finally {
    await page.close();
  }
}
const RS_SCHOOL = 'Example State University of Science, Technology and Arts';
// The job's answers for these fields (a job's answers.json; keys are normLabel).
const RS1_ANSWERS = {
  'do you have any formal education experience': 'Yes',
  university: RS_SCHOOL,
  'degree status': 'Graduated',
  'field of study (max 2)': 'Applied Linguistics',
  'honors: (max 2)': '',
  'gpa/grade (cumulative) achieved': '4.0',
  'gpa/grade (cumulative) total': '4.0',
  other: '',
};
const rs1DomBank = { ...bank, learned: [{ label: 'degree', answer: "Master's Degree", source: 'test' }] };
const rsAt = (page, which) => page.locator({ university: '#university-autocomplete-input-0', degree: '#degree-autocomplete-field-0', field: '[aria-labelledby="field-of-study-label-0"]', honors: '[aria-labelledby="honors-label-0"]', award: '[aria-labelledby="candidate-award-label"]' }[which]);

test('react-select v1 application: the lists are select fields (widget react-select, required by the * before the tooltip "?", no options until searched); the plan picks University, Degree and Field of Study and leaves the blank Honors and the unanswered award alone', { skip }, async () => {
  const snap = await rs1(async (page) => { await page.evaluate(markRoot, 'form'); return page.evaluate(collectForm); });
  const rs = snap.fields.filter((f) => f.widget === 'react-select');
  assert.deepEqual(rs.map((f) => [f.label, f.kind, f.required, f.value, f.options]), [
    ['University* ?', 'select', true, '', []],
    ['Degree* ?', 'select', true, '', []],
    ['Field of Study (Max 2)* ?', 'select', true, '', []],
    ['Honors: (Max 2) ?', 'select', false, '', []],
    ['Name of award/accomplishment', 'select', false, '', []],
  ]);
  assert.ok(!snap.fields.some((f) => f.kind === 'text' && f.combobox), 'no list is collected as a text box');
  const plan = planFill(snap.fields, rs1DomBank, { cv: '/tmp/cv.pdf', jobAnswers: RS1_ANSWERS });
  const keys = new Set(rs.map((f) => f.key));
  const label = (k) => snap.fields.find((f) => f.key === k).label;
  assert.deepEqual(plan.actions.filter((a) => keys.has(a.key)).map((a) => [label(a.key), a.action, a.value]), [
    ['University* ?', 'pick', RS_SCHOOL],
    ['Degree* ?', 'pick', "Master's Degree"],
    ['Field of Study (Max 2)* ?', 'pick', 'Applied Linguistics'],
  ]);
  assert.ok(!plan.missing.some((m) => keys.has(m.key)));
});

test('stuckReport on the react-select v1 application: the lists\' help tooltips ("If none of the options apply to you, please select \\"Other\\" ...") are not validation messages', { skip }, async () => {
  const open = await rs1(async (page) => { await page.evaluate(markRoot, 'form'); return page.evaluate(stuckReport); });
  assert.deepEqual(open, []);
});

test('rsPick (plain v1): searches a react-select v1 list and picks the answer on mousedown, confirmed by the shown choice; among several Master options "Master\'s Degree" takes its exact wording; an unlisted answer is no pick, its search text cleared and the menu closed; a list already showing the answer is left alone', { skip }, async () => {
  const r = await rs1(async (page) => {
    const out = {};
    out.uni = await rsPick(rsAt(page, 'university'), RS_SCHOOL);
    out.deg = await rsPick(rsAt(page, 'degree'), "Master's Degree");
    out.fos = await rsPick(rsAt(page, 'field'), 'Applied Linguistics');
    out.shown = [await rsShown(rsAt(page, 'university')), await rsShown(rsAt(page, 'degree')), await rsShown(rsAt(page, 'field'))];
    out.typed = await rsAt(page, 'field').inputValue();
    out.menus = await page.locator('.Select-menu-outer').count();
    out.again = await rsPick(rsAt(page, 'university'), RS_SCHOOL);
    out.hidden = await page.evaluate(() => [...document.querySelectorAll('.Select input[type="hidden"]')].map((i) => i.value).filter(Boolean));
    return out;
  }, { mode: 'v1' });
  assert.deepEqual([r.uni, r.deg, r.fos], [true, true, false]);
  assert.deepEqual(r.shown, [[RS_SCHOOL], ["Master's Degree"], []]);
  assert.equal(r.typed, '');
  assert.equal(r.menus, 0);
  assert.equal(r.again, true);
  assert.deepEqual(r.hidden, [RS_SCHOOL, "Master's Degree"]);
});

test('rsPick (plain v1): a slow list (2 s of "Loading...") is waited for; a degree list wording it "Masters" takes that one option; a list of only "Master of Science" and "Master of Arts" is no pick (never a near degree)', { skip }, async () => {
  const lists = { ...RS_LISTS, 'degree-autocomplete-field-0': ['Bachelors', 'Masters', 'Doctorate', 'Other'], 'field-of-study-label-0': ['Master of Science (MS)', 'Master of Arts (MA)'] };
  const r = await rs1(async (page) => ({
    uni: await rsPick(rsAt(page, 'university'), RS_SCHOOL),
    deg: await rsPick(rsAt(page, 'degree'), "Master's Degree"),
    shown: await rsShown(rsAt(page, 'degree')),
    near: await rsPick(rsAt(page, 'field'), "Master's Degree"),
  }), { mode: 'v1', lists, delay: 2000 });
  assert.deepEqual([r.uni, r.deg, r.shown, r.near], [true, true, ['Masters'], false]);
});

test('rsPickOther (plain v1): an answer the list lacks picks the list\'s Other entry and is typed into the free-text box that appears; the form then reads Other with that text, and the plan neither picks it again nor asks the box (its label "Other" has a blank job answer); a list with no Other entry is no pick', { skip }, async () => {
  const r = await rs1(async (page) => {
    const ok = await rsPickOther(rsAt(page, 'field'), 'Applied Linguistics');
    const box = await page.locator('.other-input input').inputValue();
    const shown = await rsShown(rsAt(page, 'field'));
    const none = await rsPickOther(rsAt(page, 'honors'), 'Summa Cum Laude Plus');
    const honors = await rsShown(rsAt(page, 'honors'));
    await page.evaluate(markRoot, 'form');
    return { ok, box, shown, none, honors, snap: await page.evaluate(collectForm) };
  }, { mode: 'v1' });
  assert.deepEqual([r.ok, r.box, r.shown], [true, 'Applied Linguistics', ['Other']]);
  assert.deepEqual([r.none, r.honors], [false, []]);
  const f = r.snap.fields.find((x) => x.label === 'Field of Study (Max 2)* ?');
  assert.deepEqual([f.value, f.other_text], ['Other', 'Applied Linguistics']);
  const ob = r.snap.fields.find((x) => x.other_for);
  assert.deepEqual([ob.label, ob.value, ob.required], ['Other', 'Applied Linguistics', true]);
  const plan = planFill(r.snap.fields, rs1DomBank, { cv: '/tmp/cv.pdf', jobAnswers: RS1_ANSWERS });
  assert.ok(!plan.actions.some((a) => a.key === f.key || a.key === ob.key));
  assert.ok(!plan.missing.some((m) => m.key === f.key || m.key === ob.key));
});

// react-virtualized-select over v1: rows are div.VirtualizedSelectOption (chosen on click, only the rows in view
// rendered), not .Select-option, so a runner that read .Select-option only found nothing in any list. Its University
// list names a school "<name> - <abbreviation> - <country>".
test('rsPick (react-virtualized-select): University takes its listed "<name> - ESUSTA - Freedonia" entry, Degree "Master\'s Degree", both on click; Field of Study "Applied Linguistics" is no pick, its searches logged, with no menu left open', { skip }, async () => {
  const r = await rs1(async (page) => {
    const out = {};
    out.uni = await rsPick(rsAt(page, 'university'), RS_SCHOOL);
    out.deg = await rsPick(rsAt(page, 'degree'), "Master's Degree");
    out.shown = [await rsShown(rsAt(page, 'university')), await rsShown(rsAt(page, 'degree'))];
    const seen = [];
    out.fos = await rsPick(rsAt(page, 'field'), 'Applied Linguistics', { seen });
    out.seen = seen;
    out.fosShown = await rsShown(rsAt(page, 'field'));
    out.menus = await page.locator('.Select-menu-outer').count();
    return out;
  });
  assert.deepEqual([r.uni, r.deg], [true, true]);
  assert.deepEqual(r.shown, [['Example State University of Science Technology and Arts - ESUSTA - Freedonia'], ["Master's Degree"]]);
  assert.equal(r.fos, false);
  assert.deepEqual(r.fosShown, []);
  assert.equal(r.menus, 0);
  assert.deepEqual(r.seen.map((x) => x.search), ['Applied Linguistics', 'Applied', 'Linguistics']);
  assert.deepEqual(r.seen.at(-1).options, ['Computational Linguistics', 'Linguistics', 'Psycholinguistics', 'Sociolinguistics']);
});

test('rsPick (react-virtualized-select): an option beyond the rendered rows of a long result is scrolled into the grid and taken', { skip }, async () => {
  const r = await rs1(async (page) => {
    const uni = rsAt(page, 'university');
    // 31 rows match "Example State University": the answer's row is the 31st, past the 16 rendered at first.
    return { ok: await rsPick(uni, 'Example State University'), shown: await rsShown(uni) };
  }, { lists: { ...DS_LISTS, 'university-autocomplete-input-0': [...Array.from({ length: 30 }, (_, i) => `Example State University Branch ${i + 1} - Freedonia`), 'Example State University - Freedonia', 'Other'] } });
  assert.deepEqual([r.ok, r.shown], [true, ['Example State University - Freedonia']]);
});

test('rsPickOther (react-virtualized-select): a university the list lacks takes its Other entry (never "Brotherhood College") and goes into "Please specify your University name"; Field of Study\'s Other entry brings no box, so it is no pick and the list is cleared again', { skip }, async () => {
  const r = await rs1(async (page) => {
    const uni = rsAt(page, 'university');
    const miss = await rsPick(uni, 'Unlisted Institute of Technology');
    const ok = await rsPickOther(uni, 'Unlisted Institute of Technology');
    const box = await page.locator('#otherUniversityName-0').inputValue();
    const fos = await rsPickOther(rsAt(page, 'field'), 'Applied Linguistics');
    await page.evaluate(markRoot, 'form');
    return { miss, ok, box, shown: await rsShown(uni), fos, fosShown: await rsShown(rsAt(page, 'field')), snap: await page.evaluate(collectForm) };
  });
  assert.deepEqual([r.miss, r.ok, r.box, r.shown], [false, true, 'Unlisted Institute of Technology', ['Other']]);
  assert.deepEqual([r.fos, r.fosShown], [false, []]);
  const f = r.snap.fields.find((x) => x.label === 'University* ?');
  assert.deepEqual([f.value, f.other_text], ['Other', 'Unlisted Institute of Technology']);
  const ob = r.snap.fields.find((x) => x.other_for);
  assert.deepEqual([ob.label, ob.value], ['Please specify your University name*', 'Unlisted Institute of Technology']);
});

// A "(Max 2)" list drawn as one react-select per value: the second row comes from the field's "Add Field of Study"
// button, which is gone once two rows exist.
test('rsRow: the second row of a "(Max 2)" list is added through its "Add Field of Study" button and both values are picked; the form then reads both, the plan takes no action and asks nothing; there is no third row', { skip }, async () => {
  const r = await rs1(async (page) => {
    const first = rsAt(page, 'field');
    const out = {};
    out.row0 = await rsRow(first, 0).then((l) => l && l.evaluate((el) => el.getAttribute('aria-describedby').trim()));
    out.cs = await rsPick(first, 'Computer Science');
    const second = await rsRow(first, 1);
    out.row1 = second && (await second.evaluate((el) => el.getAttribute('aria-describedby').trim()));
    out.math = second ? await rsPick(second, 'Mathematics') : false;
    out.third = await rsRow(first, 2);
    out.addLeft = await page.locator('#add-field-of-study-autocompletes-add-btn').count();
    out.honorsRows = await page.locator('[aria-labelledby="honors-label-0"]').count();
    await page.evaluate(markRoot, 'form');
    out.snap = await page.evaluate(collectForm);
    return out;
  });
  assert.deepEqual([r.row0, r.cs, r.row1, r.math, r.third, r.addLeft, r.honorsRows], ['field-of-study-label-0-0', true, 'field-of-study-label-0-1', true, null, 0, 1]);
  const rows = r.snap.fields.filter((f) => f.label === 'Field of Study (Max 2)* ?');
  assert.deepEqual(rows.map((f) => [f.value, f.rs_group]), [['Computer Science', 'field-of-study-label-0'], ['Mathematics', 'field-of-study-label-0']]);
  const plan = planFill(r.snap.fields, rs1DomBank, { cv: '/tmp/cv.pdf', jobAnswers: { ...RS1_ANSWERS, 'field of study (max 2)': 'Computer Science | Mathematics' } });
  const keys = new Set(rows.map((f) => f.key));
  assert.ok(!plan.actions.some((a) => keys.has(a.key)));
  assert.ok(!plan.missing.some((m) => keys.has(m.key)));
});
