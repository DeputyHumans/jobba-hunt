import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normLabel, classifyLabel, pickOption, planFill, detectAts, confirmationIn, blockerIn, validateAnswers, learnAnswer, resumeChoice, followBoxesChecked, typeaheadFallback, maskPrivate, siteChannel, paylocityApplyUrl, NEXT_STEP, challengeIn, entryAnswers, entriesToRemove, entriesNotKept, sameChoice, pollText, choiceAliases, greenhouseFromGhJid, eeoPick, eeoProbe, eeoAnswer, codeRequestIn, securityCodeIn, paycorStandaloneUrl, rescanActions, formSettled, notUploaded, pickChoice, eeoCategory, afterSubmit, typeaheadIndex, stuckReason, submitLabel, applicationForm, ripplingApplyUrl, resumeParseState, recordedAtsUrl, workdayStage, workdayError, workdayStartChoice, workdayVerifyLink, workdayHistory, variantForCv, previousWorkerAnswer, walmartStage, walmartNav, walmartOtpCode, walmartCodeMail, codeMismatch, buttonNameRe, icimsFrameIndex, icimsStage, icimsNav, icimsCodeMail, icimsPlan, otherOption, afterStuck, settledAfterChallenge, listValues, listChoice, listSearches, COOKIE_DECLINE, isAiApplicantQuestion, aiApplicantHandoff } from '../scripts/lib/apply-forms.mjs';

// The synthetic persona (tests/fixtures/workspace/profile/answers.json), with the facts these tests
// depend on spelled out here.
const bank = {
  profile: { first_name: 'Jordan', last_name: 'Example', full_name: 'Jordan Example', email: 'jordan@example.com', phone: '(555) 555-0100', phone_country: 'United States (+1)', city: 'Springfield, Illinois, United States', country: 'United States', linkedin: 'https://www.linkedin.com/in/jordan-example', website: 'https://jordan.example.com' },
  facts: { work_authorization: 'Yes', sponsorship: 'No', start_date: 'Within 2 weeks', relocation: 'No', remote: 'Yes', years_total: '15', how_heard: 'LinkedIn', rate_hourly: '150', rate_annual: '240000' },
  eeo: 'decline',
  learned: [{ label: 'how many years of work experience do you have with typescript', answer: '8', source: 'operator' }],
};
const ctx = { cv: '/tmp/cv.pdf', coverNote: 'Hi team, ...' };
const field = (o) => ({ key: 'f1', kind: 'text', label: '', required: true, options: [], value: '', ...o });
// Explicit EEO answers (injected; the workspace default is decline for every category).
const EEO = { gender: 'Female', race: 'Asian', hispanic: 'No', veteran: 'No', disability: 'No' };

test('labels normalize: case, asterisks, "Required", whitespace and trailing punctuation', () => {
  assert.equal(normLabel('  Are you legally authorized to work in the United States?* Required '), 'are you legally authorized to work in the united states');
  // "(Required)" in brackets: dropping the word alone left "address line 1 ( )", which matched no field type.
  assert.equal(normLabel('Address line 1 (Required) *'), 'address line 1');
  assert.equal(classifyLabel('Address line 1 (Required) *'), 'street_address');
});

test('classify: the common Easy Apply and ATS questions map to answer-bank keys', () => {
  assert.equal(classifyLabel('Are you legally authorized to work in the United States?'), 'work_authorization');
  assert.equal(classifyLabel('Will you now or in the future require sponsorship for employment visa status?'), 'sponsorship');
  assert.equal(classifyLabel('Mobile phone number'), 'phone');
  assert.equal(classifyLabel('Phone country code'), 'phone_country');
  assert.equal(classifyLabel('Email address'), 'email');
  assert.equal(classifyLabel('First name'), 'first_name');
  assert.equal(classifyLabel('LinkedIn Profile'), 'linkedin');
  assert.equal(classifyLabel('Location (city)'), 'city');
  assert.equal(classifyLabel('How many years of work experience do you have?'), 'years_total');
  assert.equal(classifyLabel('What is your desired hourly rate?'), 'rate_hourly');
  assert.equal(classifyLabel('What are your salary expectations?'), 'rate_annual');
  assert.equal(classifyLabel('When can you start?'), 'start_date');
  assert.equal(classifyLabel('Gender'), 'eeo');
  assert.equal(classifyLabel('Are you a protected veteran?'), 'eeo');
  assert.equal(classifyLabel('Cover Letter'), 'cover_letter');
  assert.equal(classifyLabel('How did you hear about us?'), 'how_heard');
});

test('classify: "based in X, or open to relocating" asks where the applicant lives, not the relocation fact', () => {
  assert.equal(classifyLabel('Are you currently based in the Springfield area, or open to relocating here?'), null);
  assert.equal(classifyLabel('Do you live in New York or are you willing to relocate?'), null);
  assert.equal(classifyLabel('Are you located in the Shelbyville area or open to relocation?'), null);
  assert.equal(classifyLabel('Are you open to relocation?'), 'relocation');
  assert.equal(classifyLabel('Would you be willing to relocate for this role?'), 'relocation');
});

test('classify: a referral question asking for the referrer\'s email is not the applicant\'s own email', () => {
  assert.equal(classifyLabel('Has someone at Acme Corp referred you for this role? If so, please include their email here'), null);
  assert.equal(classifyLabel('Referrer email'), null);
  assert.equal(classifyLabel('Who referred you?'), null);
  assert.equal(classifyLabel('Email'), 'email');
  assert.equal(classifyLabel('Email address'), 'email');
});

test('classify: a technology-specific experience question is not the total-years fact', () => {
  assert.equal(classifyLabel('How many years of work experience do you have with Supabase?'), null);
  assert.equal(classifyLabel('Do you have experience building multi-tenant SaaS?'), null);
});

test('pickOption: exact, then prefix, then the decline option for EEO', () => {
  assert.equal(pickOption(['Select an option', 'Yes', 'No'], 'Yes'), 'Yes');
  assert.equal(pickOption(['United States (+1)', 'Canada (+1)'], 'United States (+1)'), 'United States (+1)');
  assert.equal(pickOption(['Male', 'Female', 'I don\'t wish to answer'], 'decline'), 'I don\'t wish to answer');
  assert.equal(pickOption(['Male', 'Female', 'Decline To Self Identify'], 'decline'), 'Decline To Self Identify');
  assert.equal(pickOption(['Male', 'Female'], 'decline'), null);
  assert.equal(pickOption(['Yes', 'No'], 'Maybe'), null);
});

test('pickOption: two options that both start with the answer are ambiguous, never the first one', () => {
  // Ashby: a bank "Yes" picked "...work in Canada" and a bank "No" picked the future-sponsorship option.
  assert.equal(pickOption(['Yes - I am legally eligible to work in Canada', 'Yes - I am legally eligible to work in the USA', 'No'], 'Yes'), null);
  assert.equal(pickOption(['Yes, I will require sponsorship', 'No, I do not currently require sponsorship, but I will require sponsorship in the future.', 'No, I do not require sponsorship'], 'No'), null);
  // One prefix match is still taken.
  assert.equal(pickOption(['Yes, I am authorized to work in the US', 'No'], 'Yes'), 'Yes, I am authorized to work in the US');
  // An exact match still wins over several prefix matches.
  assert.equal(pickOption(['Yes', 'Yes, with sponsorship', 'No'], 'Yes'), 'Yes');
});

test('plan: known facts fill, the resume uploads, the cover note fills, Follow gets unticked', () => {
  const p = planFill([
    field({ key: 'a', kind: 'radio', label: 'Are you legally authorized to work in the United States?', options: ['Yes', 'No'] }),
    field({ key: 'b', kind: 'file', label: 'Upload resume', required: false }),
    field({ key: 'c', kind: 'textarea', label: 'Cover letter', required: false }),
    field({ key: 'd', kind: 'checkbox', label: 'Follow Acme Corp to stay up to date with their page.', required: false, value: 'on' }),
    field({ key: 'e', kind: 'number', label: 'How many years of work experience do you have?' }),
    field({ key: 'f', kind: 'select', label: 'Will you require sponsorship?', options: ['Select an option', 'Yes', 'No'] }),
  ], bank, ctx);
  assert.deepEqual(p.missing, []);
  const by = Object.fromEntries(p.actions.map((a) => [a.key, a]));
  assert.deepEqual(by.a, { key: 'a', action: 'radio', value: 'Yes', source: 'work_authorization' });
  assert.deepEqual(by.b, { key: 'b', action: 'file', value: '/tmp/cv.pdf', source: 'cv' });
  assert.equal(by.c.value, 'Hi team, ...');
  assert.deepEqual(by.d, { key: 'd', action: 'uncheck', value: null, source: 'never-follow' });
  assert.equal(by.e.value, '15');
  assert.equal(by.f.value, 'No');
});

test('plan: a required question with no answer is missing; nothing is guessed', () => {
  const p = planFill([field({ key: 'x', kind: 'radio', label: 'Do you have experience with Supabase?', options: ['Yes', 'No'] })], bank, ctx);
  assert.equal(p.actions.length, 0);
  assert.deepEqual(p.missing, [{ key: 'x', label: 'Do you have experience with Supabase?', kind: 'radio', options: ['Yes', 'No'], reason: 'no-answer' }]);
});

test('plan: an optional unknown field is left alone; a prefilled required field is kept', () => {
  const p = planFill([
    field({ key: 'o', label: 'Headline', required: false }),
    field({ key: 'm', label: 'Your current job title', value: 'Head of Engineering' }),
  ], bank, ctx);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.actions, []);
});

test('plan: learned answers match on the normalized label', () => {
  const p = planFill([field({ key: 't', kind: 'number', label: 'How many years of work experience do you have with TypeScript?*' })], bank, ctx);
  assert.deepEqual(p.actions, [{ key: 't', action: 'fill', value: '8', source: 'learned' }]);
});

test('plan: a known answer that matches no option is missing, with the options listed', () => {
  const p = planFill([field({ key: 's', kind: 'select', label: 'When can you start?', options: ['Immediately', 'In 1 month', 'In 3 months'] })], bank, ctx);
  assert.equal(p.missing[0].reason, 'no-matching-option');
  assert.deepEqual(p.missing[0].options, ['Immediately', 'In 1 month', 'In 3 months']);
});

test('plan: EEO defaults to decline; a required EEO field without a decline option is missing', () => {
  const ok = planFill([field({ key: 'g', kind: 'select', label: 'Gender', required: false, options: ['Male', 'Female', 'Decline to self-identify'] })], bank, ctx);
  assert.equal(ok.actions[0].value, 'Decline to self-identify');
  const no = planFill([field({ key: 'g', kind: 'select', label: 'Gender', options: ['Male', 'Female'] })], bank, ctx);
  assert.equal(no.missing[0].reason, 'no-matching-option');
  // A bank with no eeo at all declines too.
  const bare = { ...bank };
  delete bare.eeo;
  assert.equal(planFill([field({ key: 'g', kind: 'select', label: 'Gender', required: false, options: ['Male', 'Female', 'Decline to self-identify'] })], bare, ctx).actions[0].value, 'Decline to self-identify');
});

test('plan: an empty fact (a value not given yet) counts as no answer', () => {
  const b = { ...bank, facts: { ...bank.facts, rate_hourly: '' } };
  const p = planFill([field({ key: 'r', label: 'What is your desired hourly rate?' })], b, ctx);
  assert.equal(p.missing[0].reason, 'no-answer');
});

test('plan: numeric fields get digits only', () => {
  const b = { ...bank, facts: { ...bank.facts, years_total: '25+' } };
  const p = planFill([field({ key: 'n', kind: 'number', label: 'How many years of work experience do you have?' })], b, ctx);
  assert.equal(p.actions[0].value, '25');
});

test('ATS detection from the URL, including the Greenhouse embed and Workday; an unknown portal host is no channel', () => {
  assert.equal(detectAts('https://job-boards.greenhouse.io/acme/jobs/123'), 'greenhouse');
  assert.equal(detectAts('https://boards.greenhouse.io/embed/job_app?for=acme&token=123'), 'greenhouse');
  assert.equal(detectAts('https://jobs.lever.co/acme/abc-123/apply'), 'lever');
  assert.equal(detectAts('https://jobs.ashbyhq.com/acme/abc/application'), 'ashby');
  assert.equal(detectAts('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x'), 'workday');
  assert.equal(detectAts('https://acme.com/careers?gh_jid=123'), null);
  assert.equal(detectAts('https://portal.example.com/acme/apply-jobs?id=a1&source=linkedin'), null);
});

test('confirmation text per channel', () => {
  assert.equal(confirmationIn('Your application was sent to Acme Corp'), true);
  assert.equal(confirmationIn('Application submitted'), true);
  assert.equal(confirmationIn('Thank you for applying to Acme!'), true);
  assert.equal(confirmationIn('Thank you for your application!'), true);
  assert.equal(confirmationIn("Success\nYour application was successfully submitted. We'll contact you if there are next steps."), true);
  assert.equal(confirmationIn('Review your application'), false);
});

test('blockers: password field means an account portal; a visible CAPTCHA challenge blocks; invisible reCAPTCHA does not', () => {
  assert.equal(blockerIn({ hasPassword: true, frames: [] }), 'account-required');
  assert.equal(blockerIn({ hasPassword: false, frames: ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=normal'] }), 'captcha');
  assert.equal(blockerIn({ hasPassword: false, frames: ['https://newassets.hcaptcha.com/captcha/v1/x'] }), 'captcha');
  assert.equal(blockerIn({ hasPassword: false, frames: ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=invisible'] }), null);
  assert.equal(blockerIn({ hasPassword: false, frames: [] }), null);
});

test('answer bank validation names the empty values', () => {
  const r = validateAnswers({ ...bank, facts: { ...bank.facts, work_authorization: '', sponsorship: '' } });
  assert.deepEqual(r.empty.sort(), ['facts.sponsorship', 'facts.work_authorization']);
});

test('learnAnswer stores the normalized label once, newest answer wins', () => {
  const b = structuredClone(bank);
  learnAnswer(b, 'Do you have experience with Supabase?*', 'No', 'operator');
  learnAnswer(b, 'Do you have experience with Supabase?', 'Yes', 'operator');
  const hits = b.learned.filter((l) => l.label === 'do you have experience with supabase');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].answer, 'Yes');
});

test('plan: a prefilled value that already matches is left alone (phone digits, select text)', () => {
  const p = planFill([
    field({ key: 'p', label: 'Phone', value: '5550100' }),
    field({ key: 'c', kind: 'select', label: 'Phone country code', options: ['United States (+1)', 'Canada (+1)'], value: 'United States (+1)' }),
  ], { ...bank, profile: { ...bank.profile, phone: '(555) 0100' } }, ctx);
  assert.deepEqual(p.actions, []);
  assert.deepEqual(p.missing, []);
});

// Easy Apply lists earlier uploads as radio cards and preselects one: the application must go out
// with the CV the operator approved.
const cards = (value, extra = []) => field({ key: 'r', kind: 'radio', label: 'Resume', options: ['Jordan Example – VP of Engineering.pdf 12/9/2024', 'Jordan Example – CTO.pdf 10/4/2024', ...extra], value });
const CV = 'jordan-example-cv-fractional-cto.pdf';

test('resume choice: no resume picker on this step', () => {
  assert.deepEqual(resumeChoice([field({ label: 'Phone' })], CV), { status: 'none' });
});

test('resume choice: an old resume preselected and the new CV not in the list is "missing"', () => {
  assert.equal(resumeChoice([cards('Jordan Example – VP of Engineering.pdf 12/9/2024')], CV).status, 'missing');
});

test('resume choice: the uploaded CV is listed but not selected -> select it; selected -> ok', () => {
  const up = 'jordan-example-cv-fractional-cto.pdf Uploaded 10/27/2026';
  assert.deepEqual(resumeChoice([cards('Jordan Example – CTO.pdf 10/4/2024', [up])], CV), { status: 'select', key: 'r', option: up });
  assert.deepEqual(resumeChoice([cards(up, [up])], CV), { status: 'ok', key: 'r', option: up });
});

test('resume choice: cards without .pdf or "resume" in their labels are still found by the uploaded name', () => {
  const f = field({ key: 'q', kind: 'radio', label: '', options: ['Select Jordan Example – VP of Engineering', 'Select jordan-example-cv-fractional-cto'], value: 'Select Jordan Example – VP of Engineering' });
  assert.deepEqual(resumeChoice([f], CV), { status: 'select', key: 'q', option: 'Select jordan-example-cv-fractional-cto' });
});

test('resume choice: a Yes/No question that mentions the resume is not the resume picker', () => {
  const f = field({ key: 'c', kind: 'radio', label: 'I certify that all information provided in this form and in my resume is truthful, complete, and accurate.*', options: ['Yes', 'No'], value: '' });
  assert.deepEqual(resumeChoice([f], 'jordan-example-cv-cto-head-of-engineering.pdf'), { status: 'none' });
});

test('follow guard: any ticked Follow box is reported; unticked or unrelated boxes are not', () => {
  const fs = [
    field({ key: 'a', kind: 'checkbox', label: 'Follow Acme to stay up to date with their page', value: 'on', required: false }),
    field({ key: 'b', kind: 'checkbox', label: 'Follow Beta to stay up to date', value: '', required: false }),
    field({ key: 'c', kind: 'checkbox', label: 'Mark job as a top choice', value: 'on', required: false }),
  ];
  assert.deepEqual(followBoxesChecked(fs).map((f) => f.key), ['a']);
});

test('file inputs: cover letter gets the cover PDF, resume the CV, a second unlabeled input is asked', () => {
  const bank = { profile: {}, facts: {}, learned: [] };
  const fields = [
    { key: 'f0', kind: 'file', label: 'Resume/CV', required: true, options: [], value: '' },
    { key: 'f1', kind: 'file', label: 'Cover Letter', required: false, options: [], value: '' },
    { key: 'f2', kind: 'file', label: '', required: false, options: [], value: '' },
  ];
  const p = planFill(fields, bank, { cv: '/cv.pdf', coverPdf: '/letter.pdf' });
  assert.deepEqual(p.actions.map((a) => [a.key, a.value]), [['f0', '/cv.pdf'], ['f1', '/letter.pdf']]);
  assert.deepEqual(p.missing.map((m) => [m.key, m.reason]), [['f2', 'unlabeled-file']]);
  const lone = planFill([{ key: 'f0', kind: 'file', label: '', required: true, options: [], value: '' }], bank, { cv: '/cv.pdf' });
  assert.deepEqual(lone.actions.map((a) => a.value), ['/cv.pdf']);
  const noLetter = planFill([fields[1]], bank, { cv: '/cv.pdf' });
  assert.deepEqual([noLetter.actions.length, noLetter.missing.length], [0, 0]);
});

test('file inputs: an "Additional Attachments" slot takes the approved letter, and without one an optional slot is skipped, not asked', () => {
  const bank = { profile: {}, facts: {}, learned: [] };
  const fields = [
    { key: 'f0', kind: 'file', label: 'Resume', required: true, options: [], value: '' },
    { key: 'f1', kind: 'file', label: 'Additional Attachments', required: false, options: [], value: '' },
  ];
  const withLetter = planFill(fields, bank, { cv: '/cv.pdf', coverPdf: '/letter.pdf' });
  assert.deepEqual(withLetter.actions.map((a) => [a.key, a.value]), [['f0', '/cv.pdf'], ['f1', '/letter.pdf']]);
  assert.deepEqual(withLetter.missing, []);
  const noLetter = planFill(fields, bank, { cv: '/cv.pdf' });
  assert.deepEqual(noLetter.actions.map((a) => a.key), ['f0']);
  assert.deepEqual(noLetter.missing, []);
  const requiredNoLetter = planFill([fields[0], { ...fields[1], required: true }], bank, { cv: '/cv.pdf' });
  assert.deepEqual(requiredNoLetter.missing.map((m) => [m.key, m.reason]), [['f1', 'unlabeled-file']]);
});

test('bot checks are recognised (appcast slider, Cloudflare, hCaptcha) and job pages are not', async () => {
  const { challengeIn, REDIRECT_HOST } = await import('../scripts/lib/apply-forms.mjs');
  assert.equal(challengeIn({ title: '', text: 'Verification Required\nSlide right to secure your access\nWe detected unusual activity from your device or network.' }), true);
  assert.equal(challengeIn({ title: 'Just a moment...', text: '' }), true);
  assert.equal(challengeIn({ text: '', frames: ['https://newassets.hcaptcha.com/captcha/v1/abc'] }), true);
  assert.equal(challengeIn({ title: 'Senior Engineer - Acme Careers', text: 'Apply for this job. Resume/CV. Submit application' }), false);
  assert.equal(REDIRECT_HOST.test('click.appcast.io'), true);
  assert.equal(REDIRECT_HOST.test('apply.appcast.io'), false);
  assert.equal(REDIRECT_HOST.test('boards.greenhouse.io'), false);
});

test('a screening answer LinkedIn prefilled is asked, never passed through', () => {
  const p = planFill([
    field({ key: 'a', kind: 'text', label: 'How many years of work experience do you have with Microsoft Azure?', value: '3', required: true }),
    field({ key: 'b', kind: 'radio', label: 'Have you led a SOC 2 audit?*', options: ['Yes', 'No'], value: 'Yes', required: true }),
    field({ key: 'c', kind: 'text', label: 'Headline', value: 'Fractional CTO', required: false }),
  ], bank, ctx);
  assert.deepEqual(p.missing.map((m) => [m.key, m.reason]), [['a', 'prefilled-unvetted'], ['b', 'prefilled-unvetted']]);
  assert.equal(p.actions.length, 0);
});

test('a work-authorization status question (citizen / green card / EAD / H-1B) is asked, not answered Yes', () => {
  const b = { ...bank, facts: { ...(bank.facts || {}), work_authorization: 'Yes' } };
  const p = planFill([field({ key: 'w', kind: 'text', label: 'Please confirm your work authorization. Select 1 for US Citizen, Select 2 for Green Card, Select 3 for EAD, Select 4 for H1B.', required: true })], b, ctx);
  assert.deepEqual(p.missing.map((m) => [m.key, m.reason]), [['w', 'status-question']]);
  assert.equal(p.actions.length, 0);
  const yn = planFill([field({ key: 'y', kind: 'radio', label: 'Are you legally authorized to work in the United States?', options: ['Yes', 'No'], required: true })], b, ctx);
  assert.equal(yn.actions[0]?.value, 'Yes');
});

test('sponsorship polarity: "authorized without sponsorship" is work authorization (Yes); only require/need wording is the sponsorship fact', () => {
  assert.equal(classifyLabel('Do you live in the United States and have authorization to work here without visa sponsorship, now or in the future?'), 'work_authorization');
  assert.equal(classifyLabel('Are you authorized to work in the US without sponsorship?'), 'work_authorization');
  assert.equal(classifyLabel('Will You Now or in the Future Require Sponsorship to Work in the U.S.?'), 'sponsorship');
  assert.equal(classifyLabel('Do you need visa sponsorship?'), 'sponsorship');
  assert.equal(classifyLabel('Sponsorship status'), null);
});

test('file inputs: with no cover PDF, a cover slot that takes .txt gets the approved intro note; a PDF-only slot does not', () => {
  const bank = { profile: {}, facts: {}, learned: [] };
  const slot = (accept, required = false) => [{ key: 'f1', kind: 'file', label: 'Cover Letter', required, options: [], value: '', accept }];
  const note = { cv: '/cv.pdf', coverNoteFile: '/note.txt' };
  const txt = planFill(slot('.pdf,.doc,.docx,.txt,.rtf'), bank, note);
  assert.deepEqual(txt.actions.map((a) => [a.key, a.value, a.source]), [['f1', '/note.txt', 'cover-note']]);
  assert.deepEqual(planFill(slot(''), bank, note).actions.map((a) => a.value), ['/note.txt']); // no accept attribute: any file
  assert.deepEqual([planFill(slot('.pdf'), bank, note).actions.length, planFill(slot('.pdf'), bank, note).missing.length], [0, 0]);
  assert.deepEqual(planFill(slot('.pdf', true), bank, note).missing.map((m) => m.reason), ['cover-letter-file']);
  assert.deepEqual(planFill(slot('.pdf,.txt'), bank, { ...note, coverPdf: '/letter.pdf' }).actions.map((a) => a.value), ['/letter.pdf']);
});

test('typeahead fallback: only a location answer may take the first suggestion; a yes/no answer needs a matching option', () => {
  for (const s of ['city', 'country', 'zip']) assert.equal(typeaheadFallback(s), true, s);
  for (const s of ['learned', 'sponsorship', 'work_authorization', 'eeo', null]) assert.equal(typeaheadFallback(s), false, String(s));
});

test('run records mask the phone, date of birth and street address; everything else is kept', () => {
  const filled = [
    { label: 'Phone*', value: '(555) 555-0100', source: 'phone', action: 'fill' },
    { label: 'Date of Birth', value: '01/02/1980', source: 'learned', action: 'fill' },
    { label: 'Street', value: '100 Main St', source: 'street_address', action: 'fill' },
    { label: 'Email*', value: 'jordan@example.com', source: 'email', action: 'fill' },
    { label: 'Resume/CV*', value: 'CV', source: 'cv', action: 'file' },
  ];
  assert.deepEqual(maskPrivate(filled).map((x) => x.value), ['[masked]', '[masked]', '[masked]', 'jordan@example.com', 'CV']);
  assert.equal(filled[0].value, '(555) 555-0100'); // the input is not changed
  assert.deepEqual(maskPrivate(undefined), []);
});

test('company sites: Paylocity is its own channel and opens on its Apply page; any other own-form site is a per-host channel the operator verifies once', () => {
  assert.equal(detectAts('https://recruiting.paylocity.com/Recruiting/Jobs/Details/1000001'), 'paylocity');
  assert.equal(paylocityApplyUrl('https://recruiting.paylocity.com/Recruiting/Jobs/Details/1000001'), 'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1000001');
  assert.equal(paylocityApplyUrl('https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1000001'), 'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1000001');
  assert.equal(detectAts('https://acme.example/careers/platform-architect'), null);
  assert.equal(siteChannel('https://www.acme.example/careers/platform-architect?utm=x'), 'site:acme.example');
  assert.equal(siteChannel('not a url'), null);
});

test('classify: a message box on an application form takes the intro note', () => {
  for (const l of ['Write your message here', 'Message', 'Message to the hiring team']) assert.equal(classifyLabel(l), 'cover_letter', l);
  assert.equal(classifyLabel('Text message opt-in'), null);
});

test('next-step buttons on ATS forms, Paylocity "Next Step" included', () => {
  for (const b of ['Continue', 'Next', 'Review', 'Save and continue', 'Save & continue', 'Next Step']) assert.ok(NEXT_STEP.test(b), b);
  for (const b of ['Add Work History', 'Delete This Work History', 'Next steps for your career', 'Submit']) assert.ok(!NEXT_STEP.test(b), b);
});

test('job answers: a job-scoped answer beats the bank and learned ones; an empty one leaves the field blank', () => {
  const bank = { profile: {}, facts: { start_date: 'Immediately' }, learned: [{ label: 'salary range', answer: '$200 - $250' }] };
  const fields = [
    { key: 'f0', kind: 'text', label: 'Salary Range', required: false, options: [], value: '' },
    { key: 'f1', kind: 'text', label: 'Available to Start', required: false, options: [], value: '' },
    { key: 'f2', kind: 'select', label: 'We may use SMS during the hiring process. Do you give us permission to text you? (required)', required: true, options: ['--', 'Yes', 'No'], value: '' },
  ];
  const jobAnswers = { [normLabel('Salary Range')]: '', [normLabel('Available to Start')]: '11/04/2026', [normLabel(fields[2].label)]: 'Yes' };
  const p = planFill(fields, bank, { cv: '/cv.pdf', jobAnswers });
  assert.deepEqual(p.actions.map((a) => [a.key, a.value, a.source]), [['f1', '11/04/2026', 'job'], ['f2', 'Yes', 'job']]);
  assert.deepEqual(p.missing, []);
  // A required field left blank by a job answer is still asked.
  const req = planFill([{ ...fields[0], required: true }], bank, { cv: '/cv.pdf', jobAnswers });
  assert.deepEqual(req.missing.map((m) => m.reason), ['job-blank-required']);
});

test('consent in any form, and conditional follow-ups, are asked, never answered from the bank', () => {
  const bank = { profile: { phone: '555 555 0100' }, facts: { sponsorship: 'No' }, learned: [] };
  const sms = { key: 'f0', kind: 'text', label: 'By selecting YES, I consent to receive recruiting SMS messages from Acme Corp at the phone number provided above.*', required: true, options: [], value: '' };
  const follow = { key: 'f1', kind: 'textarea', label: 'If you answered "yes" to the question above, please describe your current visa status and the timing of any current or future visa sponsorship needs. (If you answered "no" please enter "N/A")*', required: true, options: [], value: '' };
  const p = planFill([sms, follow], bank, { cv: '/cv.pdf' });
  assert.deepEqual(p.actions, []);
  assert.deepEqual(p.missing.map((m) => [m.key, m.reason]), [['f0', 'consent'], ['f1', 'no-answer']]);
  assert.equal(classifyLabel(follow.label), null);
  // The operator's answer for the job wins.
  const ok = planFill([sms], bank, { cv: '/cv.pdf', jobAnswers: { [normLabel(sms.label)]: 'Yes' } });
  assert.deepEqual(ok.actions.map((a) => [a.value, a.source]), [['Yes', 'job']]);
  // A plain phone field still takes the phone.
  assert.equal(planFill([{ key: 'f2', kind: 'text', label: 'Phone*', required: true, options: [], value: '' }], bank, { cv: '/cv.pdf' }).actions[0].source, 'phone');
});

test('a "protected by reCAPTCHA" footer is not a bot check; a real challenge still is', () => {
  assert.equal(challengeIn({ text: 'Facebook Linkedin YouTube This site is protected by reCAPTCHA. We value your privacy.', frames: [] }), false);
  assert.equal(challengeIn({ text: 'This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply.', frames: [] }), false);
  assert.equal(challengeIn({ text: 'Please complete the CAPTCHA to continue', frames: [] }), true);
  assert.equal(challengeIn({ text: 'Verify you are human', frames: [] }), true);
  assert.equal(challengeIn({ text: '', frames: ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x'] }), true);
});

test('invisible reCAPTCHA: its hidden bframe is not a challenge; a visible checkbox reCAPTCHA still is', () => {
  const invisible = ['https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&k=x&size=invisible&cb=1', 'https://www.recaptcha.net/recaptcha/enterprise/bframe?hl=en&k=x'];
  assert.equal(blockerIn({ hasPassword: false, frames: invisible }), null);
  assert.equal(challengeIn({ text: '', frames: invisible }), false);
  const visible = ['https://www.google.com/recaptcha/api2/anchor?k=x&size=normal', 'https://www.google.com/recaptcha/api2/bframe?k=x'];
  assert.equal(blockerIn({ hasPassword: false, frames: visible }), 'captcha');
  assert.equal(challengeIn({ text: '', frames: visible }), true);
});

test('job answers by element id: fields that share a label ("County" in each work-history entry) take their own answer', () => {
  const bank = { profile: {}, facts: {}, learned: [] };
  const fields = [
    { key: 'f0', kind: 'text', label: 'County', id: 'wh-0-county', required: true, options: [], value: '' },
    { key: 'f1', kind: 'text', label: 'County', id: 'wh-1-county', required: true, options: [], value: '' },
  ];
  const p = planFill(fields, bank, { cv: '/cv.pdf', jobAnswers: { '#wh-0-county': 'Sangamon', '#wh-1-county': 'Menard' } });
  assert.deepEqual(p.actions.map((a) => [a.key, a.value, a.source]), [['f0', 'Sangamon', 'job'], ['f1', 'Menard', 'job']]);
  assert.deepEqual(p.missing, []);
});

test('the applicant\'s home address, city and zip never fill a work-history or education section', () => {
  const bank = { profile: { street_address: '100 Main St', city: 'Springfield, Illinois, United States', zip: '62701', country: 'United States' }, facts: {}, learned: [] };
  const wh = (id, label) => ({ key: id, kind: 'text', label, id, required: true, options: [], value: '' });
  const fields = [wh('public-candidate-work-history-address-0-address-1', 'Address Line 1'), wh('public-candidate-work-history-address-0-city', 'City'), wh('public-candidate-work-history-address-0-zip', 'Zip Code'), wh('educationHistory.city.0', 'City')];
  const p = planFill(fields, bank, { cv: '/cv.pdf' });
  assert.deepEqual(p.actions, []);
  assert.deepEqual(p.missing.map((m) => m.reason), ['section-field', 'section-field', 'section-field', 'section-field']);
  // The applicant's own address block still fills.
  assert.equal(planFill([{ key: 'a', kind: 'text', label: 'Address Line 1', id: 'info.address1', required: true, options: [], value: '' }], bank, { cv: '/cv.pdf' }).actions[0].value, '100 Main St');
});

test('Paylocity work history: answers follow the company in each entry, never its position; entries to delete come highest index first', () => {
  const fields = [
    { id: 'workHistory.companyName.0', value: 'Acme Corp' }, { id: 'workHistory.companyName.3', value: 'Globex' },
    { id: 'workHistory.companyName.4', value: 'Initech' }, { id: 'workHistory.companyName.6', value: ' Umbrella Labs ' },
    { id: 'public-candidate-work-history-address-6-city', value: '' },
  ];
  const byEntry = { 'Acme Corp': { city: 'Springfield', county: 'Sangamon' }, 'Umbrella Labs': { city: 'Capital City' }, Hooli: { city: 'Shelbyville' } };
  assert.deepEqual(entryAnswers(fields, byEntry), {
    '#public-candidate-work-history-address-0-city': 'Springfield', '#public-candidate-work-history-address-0-county': 'Sangamon',
    '#public-candidate-work-history-address-6-city': 'Capital City',
  });
  assert.deepEqual(entriesToRemove(fields, ['Globex', 'Initech', 'Soylent Systems']), [4, 3]);
  assert.deepEqual(entryAnswers(fields, null), {});
});

test('Paylocity work history: with a keep list, every parsed entry that is not a confirmed employer is removed, highest index first', () => {
  const fields = ['Acme Corp', 'Globex', 'Initech', 'Data platform programs', 'Hooli', 'Enterprise accounts portfolio', 'Umbrella Labs', 'Soylent Systems']
    .map((v, i) => ({ id: `workHistory.companyName.${i}`, value: v }));
  const keep = ['Acme Corp', 'Globex', 'Initech', 'Umbrella Labs', 'Soylent Systems', 'Independent'];
  assert.deepEqual(entriesNotKept(fields, keep), [5, 4, 3]);
  assert.deepEqual(entriesNotKept(fields, []), []); // an empty keep list removes nothing
});

test('sameChoice: for a US applicant a picked state shows as its code (Paylocity); anything else must match', () => {
  assert.equal(sameChoice('CA', 'California'), true);
  assert.equal(sameChoice('tx', 'Texas'), true);
  assert.equal(sameChoice('United States', 'united states'), true);
  assert.equal(sameChoice('', 'California'), false);
  assert.equal(sameChoice('NV', 'California'), false);
  assert.equal(sameChoice('CA', 'Canada'), false);
});

test('pollText: keeps reading the page until the confirmation shows, then stops', async () => {
  const pages = ['Review your application', 'Review your application', 'Your application is on its way!', 'never read'];
  let reads = 0;
  const text = await pollText(async () => pages[reads++], confirmationIn, { tries: 6, waitMs: 0 });
  assert.equal(text, 'Your application is on its way!');
  assert.equal(reads, 3);
});

test('pollText: gives up after its tries and returns the last text read', async () => {
  let reads = 0;
  const text = await pollText(async () => `still loading ${++reads}`, confirmationIn, { tries: 4, waitMs: 0 });
  assert.equal(text, 'still loading 4');
  assert.equal(reads, 4);
});

test('choiceAliases: a US applicant\'s state answer is also tried as its code (Paylocity lists "CA")', () => {
  // The default country is the workspace answer bank's (the synthetic persona lives in the US).
  assert.deepEqual(choiceAliases('California'), ['California', 'CA']);
  assert.deepEqual(choiceAliases('new york'), ['new york', 'NY']);
  assert.deepEqual(choiceAliases('Yes'), ['Yes']);
  assert.deepEqual(choiceAliases('CA'), ['CA']);
});

test('choiceAliases and sameChoice: country names that select lists spell differently are one country', () => {
  assert.deepEqual(choiceAliases('United Kingdom'), ['United Kingdom', 'UK', 'Great Britain']);
  assert.deepEqual(choiceAliases('Russian Federation'), ['Russian Federation', 'Russia']);
  assert.equal(sameChoice('UNITED KINGDOM', 'UK'), true);
  assert.equal(sameChoice('Russia', 'Russian Federation'), true);
  assert.equal(sameChoice('Ireland', 'United Kingdom'), false);
});

test('US-only helpers follow the bank country: a non-US applicant gets no state codes, keeps the phone as written and an ISO date', () => {
  assert.deepEqual(choiceAliases('California', 'Germany'), ['California']);
  assert.equal(sameChoice('CA', 'California', 'Germany'), false);
  assert.equal(pickChoice(['Please Select', 'CA', 'NV'], 'California', 'Germany'), null);
  assert.equal(pickChoice(['Please Select', 'CA', 'NV'], 'California', 'United States'), 'CA');
  const uk = { profile: { phone: '+44 20 7946 0958', country: 'United Kingdom', phone_country: 'United Kingdom (+44)' }, facts: { start_date: 'Immediately' }, learned: [] };
  const fields = [
    field({ key: 'c', kind: 'select', label: 'Country Phone Code', options: ['Please Select', 'United Kingdom (+44)'] }),
    field({ key: 'p', label: 'Phone number *' }),
    field({ key: 'd', kind: 'date', label: 'When are you available to start?' }),
  ];
  const by = Object.fromEntries(planFill(fields, uk, { today: '2026-11-05' }).actions.map((a) => [a.key, a.value]));
  assert.equal(by.p, '+44 20 7946 0958');
  assert.equal(by.d, '2026-11-05');
  const us = { ...uk, profile: { ...uk.profile, country: 'United States' } };
  assert.equal(Object.fromEntries(planFill(fields, us, { today: '2026-11-05' }).actions.map((a) => [a.key, a.value])).d, '11/05/2026');
});

test('the applicant\'s availability start date never fills a work-history or education date', () => {
  const bank = { profile: {}, facts: { start_date: 'Immediately' }, learned: [] };
  const wh = (id, value, required = false) => ({ key: id, kind: 'text', label: 'Start Date', id, required, options: [], value });
  const p = planFill([wh('txt-workHistory-startDate-0', '03/2023'), wh('txt-workHistory-startDate-1', '', true)], bank, { cv: '/cv.pdf' });
  assert.deepEqual(p.actions, []);
  assert.deepEqual(p.missing.map((m) => m.reason), ['section-field']);
  // The application's own "Available to Start" still fills.
  assert.equal(planFill([{ key: 'a', kind: 'text', label: 'Available to Start', id: 'availableToStart', required: true, options: [], value: '' }], bank, { cv: '/cv.pdf' }).actions[0].value, 'Immediately');
});

test('confirmationIn: Greenhouse\'s post-submit page with a blank employer message ("TBD", "View more jobs at", "Back to job post")', () => {
  assert.equal(confirmationIn('TBD\nView more jobs at Acme Corp\nBack to job post\nPowered by greenhouse'), true);
  assert.equal(confirmationIn('Staff AI Engineer\nApply\nBack to jobs'), false);
});

test('optional open questions are not left blank: they come back as optional-text for a claims-grounded answer', () => {
  const bank = { profile: {}, facts: {}, learned: [] };
  const q = (label, kind = 'textarea', o = {}) => ({ key: label, kind, label, id: '', required: false, options: [], value: '', ...o });
  const fields = [
    q('What was the hardest technical challenge you solved?'),
    q('Anything else you would like us to know?'),
    q('Tell us about a project you are proud of', 'text'),
    q('Why are you interested in this role?', 'text'),
    q('Preferred name', 'text'), q('Website', 'text'), q('Desired salary?', 'text'), q('How did you hear about us?', 'text'),
    q('Pronouns', 'text'), q('Twitter URL', 'text'), q('Middle Name', 'text'),
    q('What was the hardest technical challenge you solved?', 'textarea', { key: 'done', value: 'Already answered' }),
  ];
  const p = planFill(fields, bank, { cv: '/cv.pdf' });
  assert.deepEqual(p.missing.filter((m) => m.reason === 'optional-text').map((m) => m.label), [
    'What was the hardest technical challenge you solved?', 'Anything else you would like us to know?', 'Tell us about a project you are proud of', 'Why are you interested in this role?',
  ]);
});

test('greenhouseFromGhJid: a careers page with gh_jid and the board script resolves to the job-boards form', () => {
  assert.equal(greenhouseFromGhJid('https://www.acme.example/careers/jobs?gh_jid=9000000401&gh_src=03b9', ['https://boards.greenhouse.io/embed/job_board/js?for=acme']), 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=9000000401');
  assert.equal(greenhouseFromGhJid('https://acme.com/jobs?gh_jid=42', ['https://boards.greenhouse.io/embed/job_app?for=acme&token=42']), 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=42');
  assert.equal(greenhouseFromGhJid('https://acme.com/jobs?gh_jid=42', ['https://cdn.example.com/app.js']), null);
  assert.equal(greenhouseFromGhJid('https://acme.com/jobs/42', ['https://boards.greenhouse.io/embed/job_board/js?for=acme']), null);
});

test('detectAts: Paycor Recruiting (recruitingbypaycor.com) is its own channel', () => {
  assert.equal(detectAts('https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=8a&id=8b&source=LinkedIn'), 'paycor');
  assert.equal(detectAts('https://recruitingbypaycor.com/career/SubmitResume.action?clientId=8a&id=8b'), 'paycor');
});

test('classify: "how did you first hear" and a sentence asking for the applicant\'s own zip code', () => {
  assert.equal(classifyLabel('How did you first hear about this job opportunity?*'), 'how_heard');
  assert.equal(classifyLabel('Please provide the zip code of your current, permanent address.*'), 'zip');
  assert.equal(classifyLabel('What is your postal code?'), 'zip');
  assert.equal(classifyLabel('Zip Code'), 'zip');
});

test('eeoPick: explicit EEO answers from the bank pick their options; categories the bank lacks stay declined', () => {
  const D = 'Decline To Self Identify';
  assert.equal(eeoPick(['Male', 'Female', D], 'Gender', EEO), 'Female');
  // "Male" never lands on "Female", and "Man" is the same answer.
  assert.equal(eeoPick(['Female', 'Male', D], 'Gender', { gender: 'Male' }), 'Male');
  assert.equal(eeoPick(['Female', 'Man', 'Non-binary', 'Prefer not to say'], 'What is your gender identity?', { gender: 'Male' }), 'Man');
  // An option's own text is an answer too.
  assert.equal(eeoPick(['Male', 'Female', 'Non-binary', D], 'Gender', { gender: 'Non-binary' }), 'Non-binary');
  assert.equal(eeoPick(['Asian', 'Black or African American', 'Hispanic or Latino', 'White', 'Two or More Races', D], 'Race', EEO), 'Asian');
  assert.equal(eeoPick(['Yes', 'No', D], 'Are you Hispanic/Latino?', EEO), 'No');
  assert.equal(eeoPick(['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', "I don't wish to answer"], 'Veteran Status', EEO), 'I am not a protected veteran');
  assert.equal(eeoPick(['Yes, I have a disability (or previously had a disability)', 'No, I do not have a disability and have not had one in the past', 'I do not want to answer'], 'Disability Status', EEO), 'No, I do not have a disability and have not had one in the past');
  assert.equal(eeoPick(['Heterosexual', 'Gay', 'Prefer not to say'], 'Sexual orientation', EEO), 'Prefer not to say');
  // Yes answers take each category's own wording.
  assert.equal(eeoPick(['Hispanic or Latino', 'Not Hispanic or Latino', D], 'Ethnicity', { hispanic: 'Yes' }), 'Hispanic or Latino');
  assert.equal(eeoPick(['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', D], 'Veteran Status', { veteran: 'Yes' }), 'I identify as one or more of the classifications of protected veteran');
  assert.equal(eeoPick(['No, I do not have a disability', 'Yes, I have a disability (or previously had a disability)', D], 'Disability Status', { disability: 'Yes' }), 'Yes, I have a disability (or previously had a disability)');
  // An answer no option matches falls back to the decline option.
  assert.equal(eeoPick(['Male', 'Female', D], 'Gender', { gender: 'Agender' }), D);
});

test('eeoPick: decline (the default) picks the decline option, as a plain string, per category, or from the workspace bank', () => {
  const D = 'Decline To Self Identify';
  assert.equal(eeoPick(['Male', 'Female', D], 'Gender', 'decline'), D);
  assert.equal(eeoPick(['Male', 'Female', D], 'Gender', { ...EEO, gender: 'decline' }), D);
  assert.equal(eeoPick(['Asian', 'White', 'I prefer not to specify'], 'Race', { gender: 'Female' }), 'I prefer not to specify');
  // No eeo given: answers().eeo from the workspace (the synthetic persona declines every category).
  assert.equal(eeoPick(['Male', 'Female', D], 'Gender'), D);
  assert.equal(eeoAnswer(undefined, 'gender'), 'decline');
  assert.equal(eeoAnswer({ gender: '  ' }, 'gender'), 'decline');
  assert.equal(eeoAnswer({ gender: 'Female' }, null), 'decline');
});

test('EEO typeaheads (Greenhouse react-select): a short probe built from the answer is typed and the option chosen by eeoPick; a decline types "decline"', () => {
  const t = (label) => ({ key: label, kind: 'text', label, id: label, required: false, options: [], value: '', combobox: true });
  const labels = ['Gender', 'Race', 'Veteran Status', 'Self-identification of disability', 'Sexual orientation'];
  const p = planFill(labels.map(t), { profile: {}, facts: {}, learned: [], eeo: EEO }, { cv: '/cv.pdf' });
  assert.deepEqual(p.actions.map((a) => [a.key, a.value, a.eeo]), [
    ['Gender', 'Fem', 'Gender'], ['Race', 'Asi', 'Race'], ['Veteran Status', 'not', 'Veteran Status'],
    ['Self-identification of disability', 'No', 'Self-identification of disability'], ['Sexual orientation', 'decline', 'Sexual orientation'],
  ]);
  const declined = planFill(labels.map(t), { profile: {}, facts: {}, learned: [], eeo: 'decline' }, { cv: '/cv.pdf' });
  assert.deepEqual(declined.actions.map((a) => a.value), ['decline', 'decline', 'decline', 'decline', 'decline']);
});

test('eeoProbe: what goes into an EEO typeahead for each kind of answer', () => {
  assert.equal(eeoProbe('gender', { gender: 'Male' }), 'Mal');
  assert.equal(eeoProbe('race', { race: 'Black or African American' }), 'Bla');
  assert.equal(eeoProbe('veteran', { veteran: 'No' }), 'not');
  assert.equal(eeoProbe('veteran', { veteran: 'Yes' }), 'veteran');
  assert.equal(eeoProbe('hispanic', { hispanic: 'No' }), 'No');
  assert.equal(eeoProbe('gender', { gender: 'decline' }), 'decline');
  assert.equal(eeoProbe(null, EEO), 'decline');
  assert.equal(eeoProbe('gender'), 'decline'); // the workspace bank declines
});

test('EEO in a plain text box gets the whole answer, not the typeahead probe', () => {
  const p = planFill([{ key: 'g', kind: 'text', label: 'Gender', id: 'g', required: false, options: [], value: '' }], { profile: {}, facts: {}, learned: [], eeo: EEO }, { cv: '/cv.pdf' });
  assert.deepEqual(p.actions.map((a) => [a.value, a.eeo]), [['Female', undefined]]);
});

test('Greenhouse email security code: the page asks, the mail holds the code', () => {
  assert.equal(codeRequestIn("A verification code was sent to jordan@example.com. To submit your application, enter the 8-character code to confirm you're human."), true);
  assert.equal(codeRequestIn('Apply for this job * indicates a required field'), false);
  const mail = 'Copy and paste this code into the security code field on your application:\nAb3dEf9H\n  After you enter the code, resubmit your application.';
  assert.equal(securityCodeIn(mail), 'Ab3dEf9H');
  assert.equal(securityCodeIn('Thank you for applying to Acme Corp'), null);
});

test('EEO: a group named "Gender, Ethnicity/Race" is the gender question when its options are genders (Paycor)', () => {
  assert.equal(eeoPick(['Male', 'Female', 'I decline to identify'], 'Invitation to Self-Identify Gender, Ethnicity/Race', EEO), 'Female');
  assert.equal(eeoPick(['White (Not Hispanic or Latino) A person having origins', 'Asian (Not Hispanic or Latino) A person having origins', 'I decline to identify'], 'Invitation to Self-Identify Gender, Ethnicity/Race', EEO), 'Asian (Not Hispanic or Latino) A person having origins');
});

test('home State: the profile state fills a State select as name or code; a work-history State is never the applicant\'s (Paycor)', () => {
  const bank = { profile: { state: 'Illinois', country: 'United States' }, facts: {}, learned: [] };
  const sel = (label, options, id = '') => ({ key: label + id, kind: 'select', label, id, required: true, options, value: '' });
  const p = planFill([sel('State', ['Please Select', 'AZ', 'IL', 'TX']), sel('State/Province', ['Arizona', 'Illinois']), sel('State', ['AZ', 'IL'], 'public-candidate-work-history-address-0-us-state')], bank, { cv: '/cv.pdf' });
  assert.deepEqual(p.actions.map((a) => a.value), ['IL', 'Illinois']);
  assert.deepEqual(p.missing.map((m) => m.reason), ['section-field']);
});

test('classify: a bare "Comments" box takes the cover letter text (Paycor)', () => {
  assert.equal(classifyLabel('Comments'), 'cover_letter');
  assert.equal(classifyLabel('Additional Comments'), 'cover_letter');
  assert.notEqual(classifyLabel('Comments on your salary expectations'), 'cover_letter');
});

test('detectAts: Workable (apply.workable.com), whose form lives at /apply/ under the job', () => {
  assert.equal(detectAts('https://apply.workable.com/acme/j/ABCDEF0123'), 'workable');
  assert.equal(detectAts('https://apply.workable.com/acme/j/ABCDEF0123/apply/'), 'workable');
});

test('paycorStandaloneUrl: an embedded Paycor job page drops parentUrl so Apply stays on Paycor', () => {
  const u = 'https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=8a&parentUrl=https%3A%2F%2Facme.example%2Fcareers&id=8b&source=LinkedIn%2BLimited';
  assert.equal(paycorStandaloneUrl(u), 'https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=8a&id=8b&source=LinkedIn%2BLimited');
  assert.equal(paycorStandaloneUrl('https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=8a&id=8b'), 'https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=8a&id=8b');
});

test('classify: "authorized to work ... without requiring sponsorship" is work authorization (Yes), and "how did you find out?" inside a story question is not how_heard', () => {
  assert.equal(classifyLabel('Are you legally authorized to work in the United States now and in the future without requiring visa sponsorship?'), 'work_authorization');
  assert.equal(classifyLabel('Will you now or in the future require visa sponsorship?'), 'sponsorship');
  assert.notEqual(classifyLabel('Describe a system you built that broke in production. How did you find out? What did you change?'), 'how_heard');
  assert.equal(classifyLabel('How did you hear about us?'), 'how_heard');
  assert.equal(classifyLabel('How did you find out about this job?'), 'how_heard');
});

test('rescan: only actions not done, plus the ones the last fill skipped; a file already uploaded never again', () => {
  const tag = (x) => `${x.id}|${x.action}`;
  const actions = [
    { key: 'f0', id: 'btn-forceResume', action: 'file', value: '/tmp/cv.pdf' },
    { key: 'f7', id: 'info.dateAvailableToStart', action: 'fill', value: '11/04/2026' },
    { key: 'f74', id: 'address-5-locality', action: 'fill', value: 'Springfield' },
    { key: 'f80', id: 'address-6-locality', action: 'fill', value: 'Shelbyville' },
  ];
  // Every action is marked done before the fill; the fill skipped the locality whose element was re-rendered.
  const done = new Set(['btn-forceResume|file', 'file:/tmp/cv.pdf', 'info.dateAvailableToStart|fill', 'address-5-locality|fill']);
  const skipped = new Set(['address-5-locality|fill']);
  // The skipped field and the new one are filled; the start date already filled is not touched again, the CV never.
  assert.deepEqual(rescanActions(actions, { done, tag, skipped }).map((x) => x.key), ['f74', 'f80']);
  assert.deepEqual(rescanActions(actions, { done, tag }).map((x) => x.key), ['f80']);
  // A relabelled CV slot (new id, same file) is still not re-sent, even if its old slot was skipped.
  const relabel = [{ key: 'f9', id: 'replace-file', action: 'file', value: '/tmp/cv.pdf' }];
  assert.deepEqual(rescanActions(relabel, { done, tag, skipped: new Set(['replace-file|file']) }), []);
});

test('formSettled: a resume parse has landed once the same fields and values show three looks running (Paylocity)', () => {
  const snap = (n, first) => ({ fields: [{ id: 'info.firstName', value: first }, ...Array.from({ length: n }, (_, i) => ({ id: `workHistory.companyName.${i}`, value: `Co ${i}` }))] });
  assert.equal(formSettled([snap(0, ''), snap(1, ''), snap(1, '')]), false); // still filling in
  assert.equal(formSettled([snap(1, ''), snap(8, 'Jordan'), snap(8, 'Jordan')]), false);
  assert.equal(formSettled([snap(8, 'Jordan'), snap(8, 'Jordan'), snap(8, 'Jordan')]), true);
  assert.equal(formSettled([snap(8, 'Jordan'), snap(8, 'Jordan')]), false); // fewer than three looks
});

test('notUploaded: a file goes up once per run, whatever step or slot asks for it again', () => {
  const actions = [
    { key: 'f0', action: 'file', value: '/tmp/cv.pdf' },
    { key: 'f1', action: 'file', value: '/tmp/letter.pdf' },
    { key: 'f2', action: 'fill', value: 'Jordan' },
  ];
  assert.deepEqual(notUploaded(actions, new Set(['/tmp/cv.pdf'])).map((x) => x.key), ['f1', 'f2']);
  assert.deepEqual(notUploaded(actions, new Set()).map((x) => x.key), ['f0', 'f1', 'f2']);
});

test('phone fields: an extension is never the phone number, a phone code is the country code, and "United States" matches "United States of America" (Phenom)', () => {
  assert.notEqual(classifyLabel('Phone Extension'), 'phone');
  assert.equal(classifyLabel('Location Phone Code *'), 'phone_country');
  assert.ok(choiceAliases('United States').includes('United States of America'));
  assert.ok(choiceAliases('United States (+1)').includes('United States of America (+1)'));
  const plan = planFill([field({ key: 'f12', id: 'phoneExtension', label: 'Phone Extension', required: false })], bank, ctx);
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.missing, []);
  const code = planFill([field({ key: 'f10', kind: 'select', label: 'Location Phone Code *', options: ['Please Select', 'United States Minor Outlying Islands (+1)', 'United States of America (+1)'] })], bank, ctx);
  assert.equal(code.actions[0]?.value, 'United States of America (+1)');
});

test('pickChoice: an exact alias beats a prefix match ("United States" picks "United States of America", never "United States Minor Outlying Islands")', () => {
  const opts = ['Please Select', 'United States Minor Outlying Islands', 'United States of America'];
  assert.equal(pickChoice(opts, 'United States'), 'United States of America');
  assert.equal(pickChoice(['Please Select', 'Mobile', 'Home'], 'Mobile'), 'Mobile');
  assert.equal(pickChoice(['Yes, I am', 'No'], 'Yes'), 'Yes, I am'); // a prefix match still works when no exact one exists
});

test('phone with its own country-code field: a US number goes in as national digits only ("Not a valid phone number")', () => {
  const fields = [
    field({ key: 'f10', kind: 'select', label: 'Location Phone Code *', options: ['Please Select', 'United States of America (+1)'] }),
    field({ key: 'f11', id: 'phoneWidget.phoneNumber', label: 'Phone number *' }),
  ];
  assert.equal(planFill(fields, bank, ctx).actions.find((a) => a.key === 'f11').value, '5555550100');
  const plus = { ...bank, profile: { ...bank.profile, phone: '+1 555 555 0100' } };
  assert.equal(planFill(fields, plus, ctx).actions.find((a) => a.key === 'f11').value, '5555550100');
  // Without a country-code field the bank's format is kept.
  assert.equal(planFill([fields[1]], bank, ctx).actions[0].value, '(555) 555-0100');
});

test('formSettled with ready: a still form before the parse starts is not settled', () => {
  const snap = (n) => ({ fields: [{ id: 'info.firstName', value: 'Jordan' }, ...Array.from({ length: n }, (_, i) => ({ id: `workHistory.companyName.${i}`, value: `Co ${i}` }))] });
  const ready = (s) => s.fields.some((f) => /^workHistory\.companyName\.\d+$/.test(f.id || ''));
  assert.equal(formSettled([snap(0), snap(0), snap(0)], { ready }), false);
  assert.equal(formSettled([snap(8), snap(8), snap(8)], { ready }), true);
  assert.equal(formSettled([snap(0), snap(0), snap(0)]), true); // without ready, stillness alone counts
});

test('a react-widgets dropdown (options load on open) gets a pick action with the answer (Paylocity SMS consent)', () => {
  const sms = field({ key: 'f9', id: 'info.smsOptedIn', kind: 'select', widget: 'rw', options: [], label: 'We may use SMS during the hiring process. Do you give us permission to text you? (required)' });
  const jobAnswers = { [normLabel('We may use SMS during the hiring process. Do you give us permission to text you? (required)')]: 'Yes' };
  const plan = planFill([sms], bank, { ...ctx, jobAnswers });
  assert.deepEqual(plan.actions.map((a) => [a.key, a.action, a.value]), [['f9', 'pick', 'Yes']]);
  assert.deepEqual(plan.missing, []);
  // Already showing the answer: nothing to do.
  assert.deepEqual(planFill([{ ...sms, value: 'Yes' }], bank, { ...ctx, jobAnswers }).actions, []);
});

test('a section date ("Start date month", "Start date year", "End date month") is never the availability answer (Greenhouse education)', () => {
  for (const l of ['Start date month*', 'Start date year*', 'End date month', 'End date year']) assert.notEqual(classifyLabel(l), 'start_date', l);
  assert.equal(classifyLabel('When can you start?'), 'start_date');
  assert.equal(classifyLabel('Available to Start'), 'start_date');
});

test('eeoPick: an "Ethnicity" group whose options are races is the race question, never the first "(Not Hispanic ...)" option', () => {
  const us = ' (United States of America)';
  const opts = ['American Indigenous/Native or Alaskan Indigenous/Native/Inuit (Not Hispanic or LatinX)', 'Asian or Indian Subcontinent (Not Hispanic or LatinX)', 'Black or African American (Not Hispanic or LatinX)', 'Hispanic or LatinX', 'I prefer not to disclose', 'Middle Eastern/North African (Not Hispanic or LatinX)', 'Two or More Races (Not Hispanic or LatinX)', 'White (Not Hispanic or LatinX)'].map((o) => o + us);
  assert.equal(eeoPick(opts, 'Ethnicity*', EEO), 'Asian or Indian Subcontinent (Not Hispanic or LatinX)' + us);
  assert.equal(eeoPick(opts, 'Ethnicity*', { race: 'White' }), 'White (Not Hispanic or LatinX)' + us);
  assert.equal(eeoPick(['Hispanic or Latino', 'Not Hispanic or Latino', 'Decline to self-identify'], 'Ethnicity*', EEO), 'Not Hispanic or Latino');
});

test('EEO veterans: "Veterans*" is the EEO question, and a non-veteran never picks "a veteran, just not a protected veteran"', () => {
  assert.equal(classifyLabel('Veterans*'), 'eeo');
  const opts = ['I identify as one or more of the classifications of protected veterans', 'I identify as a veteran, just not a protected veteran', 'I am not a veteran', 'I do not wish to self-identify'];
  assert.equal(eeoPick(opts, 'Veterans*', EEO), 'I am not a veteran');
  assert.equal(eeoPick(['I identify as a veteran, just not a protected veteran', 'I do not wish to self-identify'], 'Veterans*', EEO), 'I do not wish to self-identify');
  assert.equal(eeoPick(['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', "I don't wish to answer"], 'Veteran Status', EEO), 'I am not a protected veteran');
});

test('eeoCategory: "Ethnicity" alone is the Hispanic or Latino question; race wording stays race', () => {
  assert.equal(eeoCategory('Ethnicity*'), 'hispanic');
  assert.equal(eeoCategory('Race/Ethnicity'), 'race');
  assert.equal(eeoCategory('Race'), 'race');
});

test('afterSubmit: a form still showing required-field errors after Submit was rejected, not sent ("School is required.")', () => {
  assert.equal(afterSubmit({ confirmed: true, errors: [] }), 'submitted');
  assert.equal(afterSubmit({ confirmed: false, errors: [{ label: 'School', error: 'School is required.' }], formStill: true }), 'rejected');
  assert.equal(afterSubmit({ confirmed: false, errors: [], formStill: false }), 'unverified');
  assert.equal(afterSubmit({ confirmed: false, errors: [{ label: 'x', error: 'This field is required.' }], formStill: false }), 'unverified');
});

test('afterSubmit: a bot check over the unsent form after Submit waits for the operator in a headed run and ends manual otherwise, never unverified', () => {
  assert.equal(afterSubmit({ confirmed: false, challenged: true, headed: true }), 'wait');
  assert.equal(afterSubmit({ confirmed: false, challenged: true, headed: false }), 'manual');
  // Not cleared within the wait.
  assert.equal(afterSubmit({ confirmed: false, challenged: true, headed: true, cleared: false }), 'manual');
  // Required-field errors under the challenge: the challenge is what holds the form.
  assert.equal(afterSubmit({ confirmed: false, challenged: true, headed: false, errors: [{ label: 'x', error: 'required' }], formStill: true }), 'manual');
  // Cleared by the operator: the usual decision on the page as it now stands.
  assert.equal(afterSubmit({ confirmed: true, challenged: true, headed: true, cleared: true }), 'submitted');
  assert.equal(afterSubmit({ confirmed: false, challenged: true, headed: true, cleared: true }), 'unverified');
  assert.equal(afterSubmit({ confirmed: false, challenged: false, headed: true }), 'unverified');
});

test('challengeIn: an invisible reCAPTCHA\'s image challenge shown over the form is a bot check; its hidden bframe is not', () => {
  const anchor = { src: 'https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&k=x&co=y&hl=en&v=z&size=invisible&anchor-ms=2000', visible: true };
  const bframe = 'https://www.recaptcha.net/recaptcha/enterprise/bframe?hl=en&v=z&k=x&bft=abc';
  assert.equal(challengeIn({ text: 'Submit Application', frames: [anchor, { src: bframe, visible: false }] }), false);
  assert.equal(challengeIn({ text: 'Submit Application', frames: [anchor, { src: bframe, visible: true }] }), true);
  // Bare URLs (visibility unknown) keep the old rule: an invisible reCAPTCHA's bframe is not a challenge.
  assert.equal(challengeIn({ text: '', frames: [anchor.src, bframe] }), false);
});

test('typeaheadIndex: an exact option beats a substring match ("Other" must not land on "Christian Brothers University")', () => {
  assert.equal(typeaheadIndex(['Christian Brothers University', 'Other'], 'Other'), 1);
  assert.equal(typeaheadIndex(['Job Boards (e.g., LinkedIn, Indeed, Monster, Glassdoor)', 'Word of Mouth'], 'Job Boards'), 0);
  assert.equal(typeaheadIndex(['Alpha', 'Beta'], 'Gamma'), -1);
});

// "Notice period in days?*" got "Immediately" and LinkedIn answered "Invalid input". Immediately, in
// days or weeks, is 0.
test('a notice period asked in days takes 0 when the answer is Immediately', () => {
  const fields = [{ key: 'f1', kind: 'text', label: 'Notice period in days?*', required: true, value: '' }, { key: 'f2', kind: 'text', label: 'When can you start?*', required: true, value: '' }];
  const { actions, missing } = planFill(fields, { profile: {}, facts: { start_date: 'Immediately' }, learned: [] }, {});
  assert.deepEqual(missing, []);
  assert.deepEqual(actions.map((a) => [a.key, a.value]), [['f1', '0'], ['f2', 'Immediately']]);
});

// The Easy Apply stuck path once referenced site-only variables and crashed with "clickErr is not
// defined". One builder serves both paths.
test('stuckReason: plain without detail, with the Next click error and failed requests when known', () => {
  assert.equal(stuckReason(), 'stuck');
  assert.equal(stuckReason({ clickErr: 'Timeout', failed: ['500 POST x/y', '500 POST x/y', '403 GET z'] }), 'stuck; Next click: Timeout; failed requests: 500 POST x/y, 403 GET z');
});

// A react-select Yes/No got a whole sentence typed into it, the list filtered to nothing, the runner
// clicked nothing, and the site refused the form.
test('comboValue: a sentence that opens with "Yes," or "No." types only that word into a combobox; anything else stays as written', async () => {
  const { comboValue } = await import('../scripts/lib/apply-forms.mjs');
  assert.equal(comboValue('Yes, 15 years.'), 'Yes');
  assert.equal(comboValue('Yes, GCP and AWS. At Acme Corp I designed...'), 'Yes');
  assert.equal(comboValue('No. Never.'), 'No');
  assert.equal(comboValue('Yes for AWS: I have hands-on experience with Amazon Bedrock. I have not worked with Azure hands-on.'), 'Yes for AWS: I have hands-on experience with Amazon Bedrock. I have not worked with Azure hands-on.');
  assert.equal(comboValue('Yesterday'), 'Yesterday');
  assert.equal(comboValue('United States'), 'United States');
});

test('comboOutcome: no matching option fails, even when typing filtered the list to nothing; places and street addresses keep their exceptions', async () => {
  const { comboOutcome } = await import('../scripts/lib/apply-forms.mjs');
  assert.equal(comboOutcome({ matched: true, visible: 2 }), 'pick');
  assert.equal(comboOutcome({ matched: false, visible: 0 }), 'fail');
  assert.equal(comboOutcome({ matched: false, visible: 3 }), 'fail');
  assert.equal(comboOutcome({ matched: false, visible: 3, fallback: true }), 'first');
  assert.equal(comboOutcome({ matched: false, visible: 0, freeAddress: true }), 'keep-typed');
  assert.equal(comboOutcome({ matched: false, visible: 0, fallback: true }), 'fail');
  // EEO probes are optional: an EEO combobox with no matching option is left alone, never a stop.
  assert.equal(comboOutcome({ matched: false, visible: 0, lenient: true }), 'skip');
  assert.equal(comboOutcome({ matched: true, visible: 1, lenient: true }), 'pick');
});

test('comboOutcome: an optional typeahead with no matching option is cleared and left blank, never a stop', async () => {
  // An optional Greenhouse "School" list may not list the applicant's school.
  const { comboOutcome } = await import('../scripts/lib/apply-forms.mjs');
  assert.equal(comboOutcome({ matched: false, visible: 0, optional: true }), 'clear');
  assert.equal(comboOutcome({ matched: false, visible: 4, optional: true }), 'clear');
  assert.equal(comboOutcome({ matched: true, visible: 1, optional: true }), 'pick');
  // A required one still stops.
  assert.equal(comboOutcome({ matched: false, visible: 0, optional: false }), 'fail');
});

test('plan: a typed fill on an optional field is marked optional, a required one is not', () => {
  // The runner leaves an optional typeahead blank when no option matches; it needs the plan to say
  // which fills are optional.
  const b = { ...bank, learned: [{ label: 'school', answer: 'Springfield University', source: 'operator' }] };
  const opt = planFill([field({ key: 'f8', label: 'School', required: false })], b, ctx).actions.find((x) => x.key === 'f8');
  assert.equal(opt.optional, true);
  const req = planFill([field({ key: 'f9', label: 'School', required: true })], b, ctx).actions.find((x) => x.key === 'f9');
  assert.ok(!req.optional);
});

test('ashbyFromJid: a careers page with ashby_jid resolves to the Ashby application form under the company slug', async () => {
  const { ashbyFromJid } = await import('../scripts/lib/apply-forms.mjs');
  const jid = '11111111-1111-4111-8111-111111111111';
  assert.equal(ashbyFromJid(`https://globex.example/business?ashby_jid=${jid}&utm_source=x`, 'Globex'), `https://jobs.ashbyhq.com/globex/${jid}/application`);
  assert.equal(ashbyFromJid('https://www.example.com/careers?ashby_jid=22222222-2222-4222-8222-222222222222', 'Umbrella Labs, Inc.'), 'https://jobs.ashbyhq.com/umbrellalabs/22222222-2222-4222-8222-222222222222/application');
  assert.equal(ashbyFromJid('https://globex.example/careers', 'Globex'), null);
  assert.equal(ashbyFromJid('https://globex.example/careers?ashby_jid=not-a-uuid', 'Globex'), null);
  assert.equal(ashbyFromJid(`https://globex.example/careers?ashby_jid=${jid}`, ''), null);
});

test('submitLabel: Gem\'s "Apply without saving" is the submit, never "Apply and save", which makes a Gem account', () => {
  const gem = ['cross', 'cross', 'Please select', 'Please select', 'Expand', 'Apply and save', 'Apply without saving'];
  assert.equal(submitLabel(gem), 'Apply without saving');
  assert.equal(submitLabel(['Apply and save']), undefined);
  assert.equal(submitLabel(['Back', 'Submit application']), 'Submit application');
  assert.equal(submitLabel(['Save draft', 'Submit your application']), 'Submit your application');
  assert.equal(submitLabel(['Continue']), undefined);
});

test('confirmationIn: Ashby\'s "Thank you for taking the time to apply" is a confirmation', () => {
  assert.ok(confirmationIn('Success\nThank you for taking the time to apply. If minimum requirements are met, the Talent Team will be in touch'));
});

test('confirmationIn: Gem\'s "Your application for <role> has been received!" is a confirmation', () => {
  assert.ok(confirmationIn('Congratulations!\nYour application for Senior Platform Engineer, Applications has been received!\nSave your information in Gem'));
  assert.ok(!confirmationIn('Your application for this role has not been received yet. Please complete the form.'));
});

test('applicationForm: a lone email box (a talent-network or job-alert signup) is not a job application', () => {
  assert.equal(applicationForm([{ label: 'E-mail Address...', kind: 'text' }]), false);
  assert.equal(applicationForm([{ label: 'First Name', kind: 'text' }, { label: 'Last Name', kind: 'text' }, { label: 'Email', kind: 'text' }]), true);
  assert.equal(applicationForm([{ label: 'Email', kind: 'text' }, { label: 'Resume/CV', kind: 'file' }]), true);
  assert.equal(applicationForm([{ label: 'Full name', kind: 'text' }, { label: 'Email', kind: 'text' }]), true);
});

const RIP = '11111111-1111-4111-8111-111111111101';
const RIP2 = '11111111-1111-4111-8111-111111111102';
test('detectAts: Rippling ATS (ats.rippling.com) is its own channel, "rippling"', () => {
  assert.equal(detectAts(`https://ats.rippling.com/acme/jobs/${RIP}?jobSite=LinkedIn`), 'rippling');
  assert.equal(detectAts(`https://ats.rippling.com/globex/jobs/${RIP2}/apply?src=LinkedIn`), 'rippling');
  assert.equal(detectAts('https://www.rippling.com/careers'), null);
});

test('ripplingApplyUrl: the job page\'s "Apply now" is a client route to <board>/jobs/<uuid>/apply, query kept; an apply URL stays as it is', () => {
  assert.equal(ripplingApplyUrl(`https://ats.rippling.com/acme/jobs/${RIP}?jobSite=LinkedIn`), `https://ats.rippling.com/acme/jobs/${RIP}/apply?jobSite=LinkedIn`);
  assert.equal(ripplingApplyUrl(`https://ats.rippling.com/globex/jobs/${RIP2}`), `https://ats.rippling.com/globex/jobs/${RIP2}/apply`);
  assert.equal(ripplingApplyUrl(`https://ats.rippling.com/globex/jobs/${RIP2}/apply?src=LinkedIn`), `https://ats.rippling.com/globex/jobs/${RIP2}/apply?src=LinkedIn`);
  assert.equal(ripplingApplyUrl('https://ats.rippling.com/acme/jobs'), 'https://ats.rippling.com/acme/jobs');
});

test('planFill: a "Résumé" upload (accented) takes the CV; an input-less menu answered from the EEO bank is a pick that carries its label for eeoPick (Rippling)', () => {
  const plan = planFill([
    field({ key: 'r', kind: 'file', label: 'Résumé*' }),
    field({ key: 'c', kind: 'file', label: 'Cover letter', required: false }),
    field({ key: 'v', kind: 'select', label: 'Veteran Status', required: false, widget: 'menu' }),
    field({ key: 'g', kind: 'select', label: 'Gender', required: false, widget: 'menu', value: 'Female' }),
  ], { ...bank, eeo: EEO }, { ...ctx, coverPdf: '/tmp/letter.pdf' });
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(plan.actions.map((a) => [a.key, a.action, a.value, a.eeo ?? null]), [
    ['r', 'file', '/tmp/cv.pdf', null],
    ['c', 'file', '/tmp/letter.pdf', null],
    ['v', 'pick', 'No', 'Veteran Status'],
  ]);
});

test('resumeParseState: Rippling\'s résumé parse toasts ("Parsing the résumé...", "Résumé parsing was successful."); the form is filled only after it', () => {
  assert.equal(resumeParseState('Application\nParsing the résumé. This might take a few seconds.'), 'parsing');
  assert.equal(resumeParseState('Résumé parsing was successful.\nFirst name'), 'done');
  assert.equal(resumeParseState('Application: Senior Platform Engineer\nRésumé\nFirst name'), null);
});

test('confirmationIn: Rippling\'s "You have successfully applied to <role>" is a confirmation; "Unable to apply for <role>" is not', () => {
  assert.ok(confirmationIn('You have successfully applied to Senior Platform Engineer'));
  assert.ok(!confirmationIn('Unable to apply for Senior Platform Engineer. Please try again later.'));
  assert.ok(!confirmationIn('Unable to apply for Senior Platform Engineer: You have already applied to this job'));
});

test('planFill: a menu whose options the runner read is planned like a select and filled by a pick; an answer with no matching option is asked, not picked (Rippling)', () => {
  const menu = (key, label, options, o = {}) => field({ key, kind: 'select', label, options, widget: 'menu', ...o });
  const plan = planFill([
    menu('a', 'Are you legally permitted to work in the country where this job is located?', ['Yes', 'No']),
    menu('s', 'What is your current Work Authorization Status?', ['US Citizen', 'Green Card', 'Sponsorship Needed']),
    menu('v', 'Veteran Status', ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', 'Choose not to disclose'], { required: false }),
    menu('h', 'How did you hear about Acme Corp?', ['LinkedIn', 'Job Board or search engine (Google, etc.)', 'Other']),
  ], { ...bank, eeo: EEO }, ctx);
  assert.deepEqual(plan.actions.map((a) => [a.key, a.action, a.value]), [
    ['a', 'pick', 'Yes'],
    ['v', 'pick', 'I am not a protected veteran'],
    ['h', 'pick', 'LinkedIn'],
  ]);
  assert.deepEqual(plan.missing.map((m) => [m.key, m.reason]), [['s', 'no-matching-option']]);
});

test('challengeIn: Cloudflare Turnstile after Apply ("Verify you are human", challenges.cloudflare.com) is a bot check (Rippling)', () => {
  assert.ok(challengeIn({ text: 'By clicking "Apply" you agree ...\nVerify you are human\nCLOUDFLARE Privacy - Help', title: 'Application', frames: [] }));
  assert.ok(challengeIn({ text: '', title: '', frames: ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abc/light/fbE/new/normal'] }));
});

test('recordedAtsUrl: a re-run starts from the company-site URL the last attempt recorded (result.json ats_url); LinkedIn and Dice pages, bad or missing records and jobs with no attempt keep the LinkedIn path', () => {
  const results = {
    '/runs/a': { ats_url: 'https://acme.wd5.myworkdayjobs.com/Careers/job/X_JR-1?source=LinkedIn' },
    '/runs/b': { outcome: 'error' },
    '/runs/li': { ats_url: 'https://www.linkedin.com/jobs/view/123/' },
    '/runs/dice': { ats_url: 'https://www.dice.com/job-detail/abc' },
    '/runs/js': { ats_url: 'javascript:alert(1)' },
  };
  const read = (dir) => { if (!(dir in results)) throw new Error('ENOENT'); return results[dir]; };
  const app = (...dirs) => ({ attempts: dirs.map((dir) => ({ mode: 'submit', outcome: 'manual', dir })) });
  assert.equal(recordedAtsUrl(app('/runs/b', '/runs/a'), read), 'https://acme.wd5.myworkdayjobs.com/Careers/job/X_JR-1?source=LinkedIn');
  // Only the last attempt counts: an older URL behind a newer run that recorded none is not used.
  assert.equal(recordedAtsUrl(app('/runs/a', '/runs/b'), read), null);
  assert.equal(recordedAtsUrl(app('/runs/li'), read), null);
  assert.equal(recordedAtsUrl(app('/runs/dice'), read), null);
  assert.equal(recordedAtsUrl(app('/runs/js'), read), null);
  assert.equal(recordedAtsUrl(app('/runs/missing'), read), null);
  assert.equal(recordedAtsUrl({ attempts: [] }, read), null);
  assert.equal(recordedAtsUrl(undefined, read), null);
  assert.equal(recordedAtsUrl({ attempts: [{ outcome: 'manual', dir: null }] }, read), null);
});

test('workdayStage: page signals to the step the runner is on; verification, already-applied, review and the wizard pages', () => {
  const base = { ids: [], startOptions: [], consent: [], step: null, steps: [], text: '', authTitle: '' };
  assert.equal(workdayStage({ ...base, ids: ['adventureButton'] }), 'job');
  assert.equal(workdayStage({ ...base, ids: ['signInContent'], text: 'We sent a verification email to jordan@example.com. Please verify your account before you sign in.' }), 'verify-email');
  assert.equal(workdayStage({ ...base, ids: ['signInContent', 'email', 'password', 'signInSubmitButton'], text: 'You must verify your account before you can sign in.' }), 'verify-email');
  assert.equal(workdayStage({ ...base, step: { index: 2, total: 6, label: 'My Information' }, ids: ['progressBar', 'pageFooterNextButton'] }), 'wizard');
  assert.equal(workdayStage({ ...base, step: { index: 6, total: 6, label: 'Review' }, ids: ['progressBar'] }), 'review');
  assert.equal(workdayStage({ ...base, ids: ['adventureButton'], text: "You've already applied for this job." }), 'already-applied');
  assert.equal(workdayStage({ ...base }), 'loading');
});

test('workdayStartChoice: Apply Manually only; Autofill with Resume (its parse writes entries no one vetted), Use My Last Application (another application\'s answers) and LinkedIn or SEEK are never taken', () => {
  assert.equal(workdayStartChoice(['autofillWithResume', 'applyManually', 'useMyLastApplication']), 'applyManually');
  assert.equal(workdayStartChoice(['autofillWithResume', 'useMyLastApplication', 'applyWithLinkedIn', 'applyWithSeek']), null);
  assert.equal(workdayStartChoice([]), null);
});

test('workdayVerifyLink: the account-verification link in a Workday mail is the one on the tenant\'s own host; other links (privacy, unsubscribe, another tenant) are not', () => {
  const host = 'acme.wd5.myworkdayjobs.com';
  const mail = `Hello,\nPlease verify your email address to activate your candidate account.\nhttps://www.workday.com/en-us/privacy.html\nhttps://other.wd1.myworkdayjobs.com/Careers/activate/zzz\nhttps://acme.wd5.myworkdayjobs.com/en-US/Careers/activate/abc123def?redirect=%2Fen-US%2FCareers%2Fjob%2FX\nThanks`;
  assert.equal(workdayVerifyLink(mail, host), 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/activate/abc123def?redirect=%2Fen-US%2FCareers%2Fjob%2FX');
  assert.equal(workdayVerifyLink('no link here', host), null);
  assert.equal(workdayVerifyLink('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/X', host), null);
});

test('workdayVerifyLink: a link in an HTML mail body (href with &amp;) is decoded before it is matched', () => {
  const html = '<a href="https://acme.wd5.myworkdayjobs.com/Careers/activate/t0k?a=1&amp;b=2">Verify Account</a>';
  assert.equal(workdayVerifyLink(html, 'acme.wd5.myworkdayjobs.com'), 'https://acme.wd5.myworkdayjobs.com/Careers/activate/t0k?a=1&b=2');
});

const MASTER = {
  roles: {
    acme: { title: 'Head of Engineering', titles: { cto: { text: 'CTO' } }, company: 'Acme Corp', dates: 'Mar 2023 – Present', contexts: { default: { text: 'Ctx Acme' }, services: { text: 'Ctx Acme services' } } },
    globex: { title: 'VP Engineering', company: 'Globex', dates: 'Jan 2021 – Jul 2024', contexts: { default: { text: 'Ctx Globex' } } },
    initech: { title: 'Engineering Manager', company: 'Initech', dates: 'Nov 2016 – Dec 2020', contexts: { default: { text: 'Ctx Initech' } } },
    umbrella: { title: 'Senior Engineer', company: 'Umbrella Labs', dates: '2012 – 2016', contexts: {} },
    hooli: { title: 'Engineer', company: 'Hooli', dates: 'Jun 2010 – Dec 2011', contexts: {} },
  },
  education: [{ degree: "Master's Degree, Computer Science", school: 'Springfield University', year: '2010' }],
};

test('workdayHistory: Workday work entries are the approved CV variant\'s roles (its title choice, the company, MM/YYYY dates, Present as current); year-only roles are left to the CV file; education splits degree and field', () => {
  const variant = { experience: [{ role: 'acme', title: 'cto', context: 'services' }, { role: 'globex' }, { role: 'initech' }], earlier: ['umbrella'] };
  const h = workdayHistory(MASTER, variant);
  assert.deepEqual(h.work, [
    { title: 'CTO', company: 'Acme Corp', from: '03/2023', to: null, current: true, description: 'Ctx Acme services' },
    { title: 'VP Engineering', company: 'Globex', from: '01/2021', to: '07/2024', current: false, description: 'Ctx Globex' },
    { title: 'Engineering Manager', company: 'Initech', from: '11/2016', to: '12/2020', current: false, description: 'Ctx Initech' },
  ]);
  assert.deepEqual(h.education, [{ school: 'Springfield University', degree: "Master's Degree", field: 'Computer Science', from: null, to: '2010' }]);
  assert.equal(variantForCv('data/out/cv/share/jordan-example-cv-ai-architect.pdf', [{ slug: 'x', share: 'cto-head-of-engineering' }, { slug: 'ai-architect', share: 'ai-architect' }]).slug, 'ai-architect');
  assert.equal(variantForCv('/tmp/other.pdf', [{ share: 'ai-architect' }]), null);
});

test('workdayHistory: with no variant, the main roles are the first N role keys of master.json (3 by default), in file order', () => {
  assert.deepEqual(workdayHistory(MASTER, null).work.map((w) => [w.company, w.title]), [['Acme Corp', 'Head of Engineering'], ['Globex', 'VP Engineering'], ['Initech', 'Engineering Manager']]);
  assert.deepEqual(workdayHistory(MASTER, null, { count: 2 }).work.map((w) => w.company), ['Acme Corp', 'Globex']);
  // A year-only role is still skipped when the count reaches it.
  assert.deepEqual(workdayHistory(MASTER, null, { count: 5 }).work.map((w) => w.company), ['Acme Corp', 'Globex', 'Initech', 'Hooli']);
  assert.deepEqual(workdayHistory(MASTER, null, { roleKeys: ['hooli'] }).work.map((w) => w.company), ['Hooli']);
  assert.deepEqual(workdayHistory({}, null), { work: [], education: [] });
});

// Client engagements through one employer show on the CV as "Client (via Employer)", one role each with
// year-only dates. On a Workday form they are one job: the employer, its own month dates, the first
// client role's title and every client's context. A variant's practice section is a current job too.
test('workdayHistory: client roles "via" one employer merge into that employer\'s single entry with its own dates; the practice section is an entry after the experience', () => {
  const master = {
    employers: { globex: { name: 'Globex Corporation', dates: 'Mar 2019 – Jun 2022', claims: ['C1'] } },
    roles: {
      acme: { title: 'Founder & Principal Consultant', company: 'Acme Consulting', dates: 'Jul 2022 – Present', contexts: { default: { text: 'Ctx Acme' } } },
      'initech-advisor': { title: 'Technical Advisor', company: 'Initech', dates: 'Jan 2023 – Present', contexts: { default: { text: 'Ctx Initech' } } },
      'globex-hooli': { title: 'Director, Software Engineering', company: 'Hooli', via: 'globex', dates: '2021 – 2022', contexts: { default: { text: 'Ctx Hooli' } } },
      'globex-umbrella': { title: 'Engineering Manager', company: 'Umbrella', via: 'globex', dates: '2019 – 2021', contexts: { default: { text: 'Ctx Umbrella' } } },
    },
    education: [{ degree: 'Bachelor of Science, Computer Science', school: 'Example State University', year: '2012' }],
  };
  const variant = { experience: [{ role: 'initech-advisor' }, { role: 'globex-hooli' }, { role: 'globex-umbrella' }], practice: { role: 'acme' } };
  const w = workdayHistory(master, variant).work;
  assert.deepEqual(w.map((x) => [x.company, x.title, x.from, x.to, x.current]), [
    ['Initech', 'Technical Advisor', '01/2023', null, true],
    ['Globex Corporation', 'Director, Software Engineering', '03/2019', '06/2022', false],
    ['Acme Consulting', 'Founder & Principal Consultant', '07/2022', null, true],
  ]);
  assert.equal(w[1].description, 'Hooli: Ctx Hooli Umbrella: Ctx Umbrella');
  // The no-variant path (roleKeys, or the first `count` role keys) merges the same way.
  assert.deepEqual(workdayHistory(master, null, { roleKeys: ['globex-hooli', 'globex-umbrella'] }).work.map((x) => [x.company, x.from, x.to]), [['Globex Corporation', '03/2019', '06/2022']]);
  assert.deepEqual(workdayHistory(master, null).work.map((x) => x.company), ['Acme Consulting', 'Initech', 'Globex Corporation']);
});

test('previousWorkerAnswer: "Have you previously worked for <Company>?" is No only when no claim, employer or client names that company; otherwise it is asked', () => {
  const known = 'Acme Corp. Globex. Initech: clients included Hooli, Soylent Systems, Umbrella Labs.';
  assert.equal(previousWorkerAnswer('Wayne Enterprises', known), 'No');
  assert.equal(previousWorkerAnswer('Vandelay Industries Ltd.', known), 'No');
  assert.equal(previousWorkerAnswer('Hooli', known), null);
  assert.equal(previousWorkerAnswer('Initech, Inc.', known), null);
  assert.equal(previousWorkerAnswer('', known), null);
});

test('classifyLabel: Workday\'s "Phone Device Type" is not the phone number', () => {
  assert.equal(classifyLabel('Phone Device Type'), null);
  assert.equal(classifyLabel('Phone Number'), 'phone');
  assert.equal(classifyLabel('Country Phone Code'), 'phone_country');
});

test('workdayStage: a removed posting ("The page you are looking for doesn\'t exist.") is closed, not a page still loading', () => {
  const base = { ids: ['header', 'legalNotice'], startOptions: [], consent: [], step: null, steps: [], authTitle: '' };
  assert.equal(workdayStage({ ...base, text: "Sign In\nThe page you are looking for doesn't exist.\nSearch for Jobs" }), 'closed');
  assert.equal(workdayStage({ ...base, ids: ['adventureButton'], text: 'This job posting is no longer available' }), 'closed');
});

// ---------- Walmart (careers.walmart.com) ----------
const WM = 'https://careers.walmart.com/us/en/jobs';
test('detectAts: careers.walmart.com is its own channel, "walmart"; walmart.com shopping pages are not', () => {
  assert.equal(detectAts(`${WM}/R-0000001?source=Job_Board_LinkedIn`), 'walmart');
  assert.equal(detectAts(`${WM}/contact-details`), 'walmart');
  assert.equal(detectAts('https://www.walmart.com/ip/12345'), null);
  assert.equal(detectAts('https://cms.careers.walmart.com/content/dam/careers/x.svg'), null);
});

test('walmartStage: page signals to the step the runner is on (job page, contact, emailed code, questionnaire, submitted, already applied, errors)', () => {
  const base = { url: `${WM}/R-0000001`, apply: [], email: false, consent: [], otp: 0, form: false, progress: null, ssn: false, errors: [], text: '' };
  assert.equal(walmartStage({ ...base, apply: [{ label: 'Apply now', disabled: false }] }), 'job');
  assert.equal(walmartStage({ ...base, apply: [{ label: 'Apply now', disabled: true }] }), 'loading');
  assert.equal(walmartStage({ ...base, apply: [{ label: 'Applied', disabled: true }] }), 'already-applied');
  assert.equal(walmartStage({ ...base, url: `${WM}/contact-details`, email: true, consent: [{ label: 'I understand and accept the Website Terms & Conditions', checked: false }], text: 'Let us know how to contact you' }), 'contact');
  assert.equal(walmartStage({ ...base, url: `${WM}/contact-details`, otp: 6, text: 'Check your email for the verification code.' }), 'otp');
  assert.equal(walmartStage({ ...base, url: `${WM}/apply`, form: true, progress: { title: 'About you', current: 1, total: 5 } }), 'questionnaire');
  assert.equal(walmartStage({ ...base, url: `${WM}/submitted?applicationGroupId=abc`, text: 'Application Submitted!' }), 'submitted');
  assert.equal(walmartStage({ ...base, url: `${WM}/apply`, text: 'Application Submitted!\nWhat\'s next?' }), 'submitted');
  assert.equal(walmartStage({ ...base, url: 'https://careers.walmart.com/us/en/login-error' }), 'error');
  assert.equal(walmartStage({ ...base, url: `${WM}/apply`, text: 'Something went wrong\nWe are experiencing a technical issue' }), 'error');
  assert.equal(walmartStage({ ...base, url: `${WM}/apply`, text: 'No questionnaire available' }), 'error');
  assert.equal(walmartStage({ ...base, url: `${WM}/apply` }), 'loading');
});

test('walmartNav: Next on a questionnaire page; the Submit only on the review page, which also says whether the cart holds more than this job; import, last-application and Back buttons are never taken', () => {
  assert.deepEqual(walmartNav(['Use my last application', 'Apply with LinkedIn', 'Upload resume', 'Next', 'Back'], 'About you'), { review: false, submit: null, next: 'Next', jobs: null });
  assert.deepEqual(walmartNav(['Read more', 'Continue', 'Previous'], 'Work and education'), { review: false, submit: null, next: 'Continue', jobs: null });
  const rv = walmartNav(['Edit', 'Edit', 'Edit', 'Submit', 'Back'], 'About you Edit Email Work experience Edit Voluntary Edit');
  assert.equal(rv.review, true);
  assert.equal(rv.submit, 'Submit');
  assert.equal(rv.next, null);
  // A review page is never stepped past with a Next-like label: that press could be the submit.
  assert.deepEqual(walmartNav(['Edit', 'Continue'], 'Review'), { review: true, submit: null, next: null, jobs: null });
  assert.equal(walmartNav(['Edit', 'Submit application'], 'You are applying to 3 jobs\nShow job list (3 jobs)').jobs, 3);
  assert.equal(walmartNav(['Edit', 'Submit'], 'You are applying to 1 job').jobs, 1);
  // An unknown label is no step: the run stops and lists the buttons.
  assert.deepEqual(walmartNav(['Let me think', 'Back'], 'About you'), { review: false, submit: null, next: null, jobs: null });
  assert.deepEqual(walmartNav([], ''), { review: false, submit: null, next: null, jobs: null });
});

test('walmartOtpCode: the six-digit code in Walmart\'s sign-in mail, only next to "code" wording; an address, a zip or a date is never taken', () => {
  assert.equal(walmartOtpCode('Your verification code is 482913. It expires in 10 minutes.'), '482913');
  assert.equal(walmartOtpCode('Use this one-time passcode to continue:\n\n 482913 \n\nIf you did not request it, ignore this email.'), '482913');
  assert.equal(walmartOtpCode('482913 is your Walmart Careers verification code'), '482913');
  assert.equal(walmartOtpCode('Thank you for applying. Example Inc., 100 Main St, Springfield, IL 62701-0100. 11/09/2026'), null);
  assert.equal(walmartOtpCode(''), null);
});

test('walmartOtpCode: the mail says "OTP" with "valid for 5 minutes" between the word and the code, after CSS whose font URLs hold six-digit runs (synthetic digits)', () => {
  const mail = 'Email verification - OTP\n#outlook a { padding: 0; } body { margin: 0; } @media only screen and (min-width:480px) { .mj-column-per-100 { width: 100% !important; } } '
    + "@font-face { font-family: 'Example Sans'; src: url('https://fonts.example.com/af/918273/00000000000000007735a0f4/30/l?primer=7cdcb44be4a7db8877ffa1c5371b8dd123b9bbc&fvd=n4&v=3') format('woff2'); } "
    + '&zwnj; &zwnj; Dear Candidate, To continue application, please verify your email using the below provided OTP. This is valid for 5 minutes. 507314 Cheers, Walmart Careers &copy; 2026 Walmart, Inc.';
  assert.equal(walmartOtpCode(mail), '507314');
  assert.equal(walmartOtpCode('Your one-time password is 640218.'), '640218');
});

test('challengeIn: Lever\'s hidden hCaptcha frames (checkbox-invisible and an unshown challenge frame) are not a challenge; a visible hCaptcha frame still is', () => {
  const base = 'https://newassets.hcaptcha.com/captcha/v1/abc123/static/hcaptcha.html';
  const hidden = [{ src: `${base}#frame=checkbox-invisible&id=0x1`, visible: false }, { src: `${base}#frame=challenge&id=0x1`, visible: false }];
  assert.equal(challengeIn({ text: 'Submit your application', frames: hidden }), false);
  assert.equal(challengeIn({ text: 'Submit your application', frames: [hidden[0], { ...hidden[1], visible: true }] }), true);
  assert.equal(challengeIn({ text: '', frames: [`${base}#frame=challenge&id=0x1`] }), true);
});

test('walmartCodeMail: only a Walmart sender, dated after the code was requested, is read for the code', () => {
  const since = Date.parse('2026-11-09T23:00:00Z');
  assert.equal(walmartCodeMail({ from: 'Walmart Careers <noreply@careers.walmart.com>', date: '2026-11-09T23:00:40Z' }, since), true);
  assert.equal(walmartCodeMail({ from: 'Sam\'s Club Careers <donotreply@careers.samsclub.example>', date: '2026-11-09T23:02:00Z' }, since), true);
  assert.equal(walmartCodeMail({ from: 'Walmart Careers <noreply@careers.walmart.com>', date: '2026-11-09T22:30:00Z' }, since), false);
  assert.equal(walmartCodeMail({ from: 'Greenhouse <no-reply@mail.greenhouse.example>', date: '2026-11-09T23:01:00Z' }, since), false);
  assert.equal(walmartCodeMail(null, since), false);
});

test('resumeParseState: Walmart\'s "Uploading Resume..." and "Parsing Resume..." are a parse in progress; their absence after it is the end', () => {
  assert.equal(resumeParseState('Upload resume\nParsing Resume...'), 'parsing');
  assert.equal(resumeParseState('Uploading Resume...'), 'parsing');
  assert.equal(resumeParseState('Upload resume\njordan-example-cv.pdf'), null);
});

// ---------- Checkbox groups (Greenhouse "Location Preference *") ----------
// Boxes sharing name="question_<id>[]", each with required="": ticking one box once still stopped the
// run with needs_answers, listing the unticked boxes as [no-answer].
const LOC = ['Springfield, IL', 'Denver, CO', 'Portland, OR', 'Boston, MA', 'Remote'];
const locGroup = (ticked = []) => LOC.map((label, i) => field({ key: `f${8 + i}`, id: `question_9000000101[]_${i}`, kind: 'checkbox', label, required: true, value: ticked.includes(label) ? 'on' : '', group: 'question_9000000101[]', group_label: 'Location Preference *' }));

test('planFill: a required checkbox group (boxes sharing a name) is answered by one ticked or answered box; its unticked siblings are not asked', () => {
  assert.deepEqual(planFill(locGroup(['Remote']), bank, ctx).missing, []);
  const answered = planFill(locGroup(), bank, { ...ctx, jobAnswers: { remote: 'Yes' } });
  assert.deepEqual(answered.missing, []);
  assert.deepEqual(answered.actions.map((a) => [a.key, a.action]), [['f12', 'check']]);
});

test('planFill: a required checkbox group with no box chosen is asked once, by its group label, with the box labels as options; boxes all answered No leave it unchosen', () => {
  // The bank's city is no answer to it: "Location Preference" reads as a city label, never a group answer.
  assert.deepEqual(planFill(locGroup(), bank, ctx).missing, [{ key: 'f8', label: 'Location Preference *', kind: 'checkbox', options: LOC, reason: 'no-answer' }]);
  const allNo = planFill(locGroup(), bank, { ...ctx, jobAnswers: Object.fromEntries(LOC.map((l) => [normLabel(l), 'No'])) });
  assert.deepEqual(allNo.missing.map((m) => [m.label, m.reason]), [['Location Preference *', 'no-answer']]);
});

test('planFill: an answer to the group question (job or learned, under the group label) ticks the box it names; one that names no box is asked', () => {
  const learned = { ...bank, learned: [...bank.learned, { label: normLabel('Location Preference *'), answer: 'Remote' }] };
  const p = planFill(locGroup(), learned, ctx);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.actions.map((a) => [a.key, a.action, a.source]), [['f12', 'check', 'learned']]);
  const off = planFill(locGroup(), bank, { ...ctx, jobAnswers: { 'location preference': 'Austin, TX' } });
  assert.deepEqual(off.missing.map((m) => [m.label, m.reason]), [['Location Preference *', 'no-matching-option']]);
  assert.deepEqual(off.actions, []);
});

// ---------- Workday error page ----------
// Right after sign-in, My Information can show Workday's own error page ("Something went wrong. Please
// refresh the page and then try again." Error Code: VPS|<id>) under the progress bar; the runner took it
// for the wizard step and timed out on a Save and Continue that was not there.
const WD_BASE = { ids: ['header', 'applyFlowPage', 'progressBar', 'progressBarActiveStep', 'progressBarInactiveStep', 'footerContainer'], startOptions: [], consent: [], step: { index: 1, total: 5, label: 'My Information' }, steps: ['My Information', 'My Experience', 'Application Questions', 'Voluntary Disclosures', 'Review'], authTitle: '', errors: [] };
const WD_ERROR = { ...WD_BASE, text: 'Back to Job Posting\nStaff Platform Engineer\ncurrent step 1 of 5\nMy Information\nstep 2 of 5\nMy Experience\nSomething went wrong\nPlease refresh the page and then try again.\nError Code: VPS|00000000-0000-4000-8000-000000000001\nFollow Us' };

test('workdayStage: Workday\'s own error page ("Something went wrong ... Error Code: VPS|<id>") is the error stage, not the wizard step under it', () => {
  assert.equal(workdayStage(WD_ERROR), 'error');
  assert.equal(workdayStage({ ...WD_BASE, ids: [...WD_BASE.ids, 'pageFooterNextButton'], text: 'My Information\nFirst Name\nLast Name\nSave and Continue' }), 'wizard');
});

test('workdayError: the error page is reloaded once; seen again after that reload, the run stops with its code; any other page is no error', () => {
  assert.deepEqual(workdayError(WD_ERROR, 0), { code: 'VPS', reload: true });
  assert.deepEqual(workdayError(WD_ERROR, 1), { code: 'VPS', reload: false, detail: 'Workday error page (VPS) after one reload' });
  assert.equal(workdayError({ ...WD_BASE, text: 'My Information\nFirst Name\nSave and Continue' }, 0), null);
  // "Something went wrong" alone (a notice over a live form) is not the error page.
  assert.equal(workdayError({ ...WD_BASE, text: 'My Information\nSomething went wrong while saving your draft\nFirst Name' }, 0), null);
});

test('codeMismatch: describes a code that did not read back without quoting either string', () => {
  assert.equal(codeMismatch('AB12CD34', 'AB12CD34'), null);
  assert.deepEqual(codeMismatch('AB12CD34', 'AB12XD34'), { want: 8, got: 8, at: [5], caseOnly: false });
  assert.deepEqual(codeMismatch('ab12cd34', 'AB12CD34'), { want: 8, got: 8, at: [1, 2, 5, 6], caseOnly: true });
  assert.deepEqual(codeMismatch('AB12CD34', 'AB12CD345'), { want: 8, got: 9, at: [9], caseOnly: false });
  const text = JSON.stringify(codeMismatch('AB12CD34', 'AB12XD34'));
  assert.ok(!/AB|CD|12|34/.test(text), 'never quotes the code');
});

test('buttonNameRe: a button label read from innerText matches its accessible name in any letter case, but only the whole name (CSS capitals)', () => {
  const re = buttonNameRe('SUBMIT APPLICATION');
  assert.ok(re.test('Submit Application'));
  assert.ok(re.test('  submit application  '));
  assert.ok(!re.test('Submit Application Later'));
  assert.ok(!buttonNameRe('Submit').test('Submit Application'));
  assert.ok(buttonNameRe('Next (2/3)').test('NEXT (2/3)'));
});

// ---------- iCIMS (*.icims.com, channel icims) ----------
// Each employer portal is its own host: <tenant>.icims.com/jobs/<id>/login shows "Enter Your
// Information", an email box, a privacy box, Next.
const IC_ACME = 'https://careers-acme.icims.com/jobs/1001';
const IC_GLOBEX = 'https://us-careers-globex.icims.com/jobs/2002';
test('detectAts: any iCIMS portal host (*.icims.com) is channel "icims"; the iCIMS marketing site and look-alike hosts are not', () => {
  assert.equal(detectAts(`${IC_GLOBEX}/login?iis=LinkedIn&mobile=false&width=1525&height=500&bga=true&needsRedirect=false&jan1offset=-360&jun1offset=-300`), 'icims');
  assert.equal(detectAts(`${IC_ACME}/login?iis=Job+Board&iisn=LinkedIn`), 'icims');
  assert.equal(detectAts(`${IC_ACME}/staff-software-engineer/job?in_iframe=1`), 'icims');
  assert.equal(detectAts('https://www.icims.com/'), null);
  assert.equal(detectAts('https://icims.com/products/'), null);
  assert.equal(detectAts('https://jobs.noticims.com/jobs/1/login'), null);
  assert.equal(detectAts('https://careers-acme.icims.com.example.org/jobs/1/login'), null);
});

test('icimsFrameIndex: the career site draws the portal in iframe#icims_content_iframe, which the runner drives (a top-level in_iframe=1 load bounces back to the outer page); an employer page embedding the portal under another name gives that frame; no portal frame gives -1', () => {
  const inner = `${IC_GLOBEX}/login?iis=LinkedIn&mobile=false&in_iframe=1`;
  const hc = { name: '', url: 'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox-invisible' };
  assert.equal(icimsFrameIndex([hc, { name: 'icims_content_iframe', url: inner }]), 1);
  assert.equal(icimsFrameIndex([{ name: 'yt', url: 'https://www.youtube.com/embed/x' }, { name: 'careers', url: inner }]), 1);
  // The named frame wins even before its first page loads (about:blank).
  assert.equal(icimsFrameIndex([{ name: 'other', url: inner }, { name: 'icims_content_iframe', url: 'about:blank' }]), 1);
  assert.equal(icimsFrameIndex([hc, { name: 'yt', url: 'https://www.youtube.com/embed/x' }]), -1);
  assert.equal(icimsFrameIndex([]), -1);
  // Only a portal page (/jobs/...), never another iCIMS asset frame.
  assert.equal(icimsFrameIndex([{ name: 'a', url: 'https://us-careers-globex.icims.com/icims2/servlet/icims2?module=AppInert' }]), -1);
});

test('challengeIn: iCIMS\'s "Protected by hCaptcha Privacy | Terms" badge is a notice, not a challenge; a request to complete an hCaptcha still is', () => {
  assert.equal(challengeIn({ text: 'Enter Your Information\nEmail\nI accept\nNext\nApplication FAQs\nProtected by hCaptcha Privacy | Terms', frames: [] }), false);
  assert.equal(challengeIn({ text: 'Please complete the hCaptcha to continue', frames: [] }), true);
});

// What icimsPage() (apply-dom.mjs) reads; each stage below changes only what tells it apart.
const IC = { url: `${IC_ACME}/staff-software-engineer/login?in_iframe=1`, heading: '', apply: [], email: false, consent: [], passwords: 0, code: 0, file: false, inputs: 0, buttons: [], errors: [], text: '' };
const icPath = (seg) => `${IC_ACME}/staff-software-engineer/${seg}?in_iframe=1`;

test('icimsStage: the job page (Apply for this job online), the login page (Enter Your Information: email, a privacy box, Next) and a page still loading', () => {
  assert.equal(icimsStage({ ...IC, url: icPath('job'), heading: 'Staff Software Engineer', apply: ['Apply for this job online'], text: 'Staff Software Engineer\nOverview\nApply for this job online' }), 'job');
  const login = { ...IC, heading: 'Enter Your Information', email: true, consent: [{ id: 'gdpr', label: 'I accept', checked: false }], inputs: 2, buttons: ['Next'], text: 'Enter Your Information\nEmail\nConsent\nPlease acknowledge that you\'ve read the Acme Corp Candidate Privacy Policy.\nI accept\nNext\nProtected by hCaptcha Privacy | Terms' };
  assert.equal(icimsStage(login), 'login');
  assert.equal(icimsStage({ ...login, consent: [], inputs: 1 }), 'login');
  assert.equal(icimsStage(IC), 'loading');
});

test('icimsStage: account pages: one password box is a sign-in, a password and its confirmation is a new account, a code box or a "check your email" notice is the email verification', () => {
  assert.equal(icimsStage({ ...IC, heading: 'Welcome Back', email: true, passwords: 1, inputs: 2, buttons: ['Log In'], text: 'Welcome Back\nPassword\nForgot your password?' }), 'sign-in');
  assert.equal(icimsStage({ ...IC, heading: 'Create Your Account', email: true, passwords: 2, inputs: 3, buttons: ['Create Account'], text: 'Create Your Account\nPassword\nConfirm Password' }), 'create-account');
  assert.equal(icimsStage({ ...IC, heading: 'Verify Your Email', code: 1, inputs: 1, buttons: ['Verify'], text: 'We sent a verification code to j****@example.com. Enter the code below.' }), 'verify-code');
  assert.equal(icimsStage({ ...IC, heading: 'Check Your Email', text: 'Check your email. We sent you a link to verify your email address.' }), 'verify-email');
});

test('icimsStage: application pages by heading or path: candidate profile, questions, EEO, review; a profile page still shows the email box but is no login', () => {
  assert.equal(icimsStage({ ...IC, url: icPath('candidate'), heading: 'Candidate Profile', email: true, file: true, inputs: 9, buttons: ['Next'], text: 'Candidate Profile\nResume\nFirst Name\nLast Name\nEmail' }), 'profile');
  assert.equal(icimsStage({ ...IC, url: icPath('questions'), heading: 'Job-Specific Questions', inputs: 4, buttons: ['Back', 'Next'], text: 'Job-Specific Questions\nAre you legally authorized to work in the United States?' }), 'questions');
  assert.equal(icimsStage({ ...IC, url: icPath('candidate'), heading: 'Voluntary Self-Identification', inputs: 4, buttons: ['Next'], text: 'Voluntary Self-Identification\nGender\nRace/Ethnicity\nVeteran Status' }), 'eeo');
  assert.equal(icimsStage({ ...IC, url: icPath('eeo'), heading: 'Diversity Information', inputs: 3, buttons: ['Next'], text: 'Diversity Information' }), 'eeo');
  assert.equal(icimsStage({ ...IC, url: icPath('candidate'), heading: 'Review Your Application', buttons: ['Back', 'Submit'], text: 'Review Your Application\nPlease review your application before you submit it.\nCandidate Profile Edit' }), 'review');
  // The profile intro can mention equal opportunity; only the heading or the path names the EEO page.
  assert.equal(icimsStage({ ...IC, url: icPath('candidate'), heading: 'Candidate Profile', file: true, inputs: 8, buttons: ['Next'], text: 'Candidate Profile\nWe are an equal opportunity employer.\nFirst Name' }), 'profile');
});

test('icimsStage: after Submit or on a re-run: the confirmation, an earlier application, a closed posting, an error page', () => {
  assert.equal(icimsStage({ ...IC, url: icPath('candidate'), heading: 'Thank You', text: 'Thank you for applying! Your application has been submitted.' }), 'submitted');
  assert.equal(icimsStage({ ...IC, url: icPath('job'), heading: 'Staff Software Engineer', apply: ['Apply for this job online'], text: 'You have already applied for this job.\nStaff Software Engineer' }), 'already-applied');
  assert.equal(icimsStage({ ...IC, url: icPath('job'), text: 'Sorry, this job is no longer accepting applications.' }), 'closed');
  assert.equal(icimsStage({ ...IC, text: 'The job you are trying to apply for has been filled.' }), 'closed');
  assert.equal(icimsStage({ ...IC, text: 'An error has occurred. Please try again later.' }), 'error');
  // A confirmation is never read off a page that still holds a form.
  assert.equal(icimsStage({ ...IC, url: icPath('candidate'), heading: 'Candidate Profile', file: true, inputs: 8, buttons: ['Next'], text: 'Candidate Profile\nThank you for your interest in Acme Corp!' }), 'profile');
});

test('icimsNav: Next or Continue on a profile, questions or EEO page; Submit only on the review page; import buttons (LinkedIn, Indeed, Dropbox, Google Drive), Back and Save for later are never taken; a Submit off the review page is held, not pressed', () => {
  assert.deepEqual(icimsNav(['Apply with LinkedIn', 'Apply with Indeed', 'Dropbox', 'Google Drive', 'Back', 'Next'], 'profile'), { review: false, submit: null, next: 'Next', held: null });
  assert.deepEqual(icimsNav(['Save for Later', 'Continue'], 'questions'), { review: false, submit: null, next: 'Continue', held: null });
  assert.deepEqual(icimsNav(['Back', 'Submit'], 'review'), { review: true, submit: 'Submit', next: null, held: null });
  assert.deepEqual(icimsNav(['Back', 'Submit Application'], 'review'), { review: true, submit: 'Submit Application', next: null, held: null });
  // The review page is never stepped past with a Next-like label: that press could be the submit.
  assert.deepEqual(icimsNav(['Back', 'Continue'], 'review'), { review: true, submit: null, next: null, held: null });
  assert.deepEqual(icimsNav(['Back', 'Submit'], 'eeo'), { review: false, submit: null, next: null, held: 'Submit' });
  assert.deepEqual(icimsNav([], 'profile'), { review: false, submit: null, next: null, held: null });
});

test('icimsCodeMail: only an iCIMS sender, dated after the code or link was requested, is read', () => {
  const since = Date.parse('2026-11-10T23:00:00Z');
  assert.equal(icimsCodeMail({ from: 'Acme Corp Careers <do-not-reply@talent.icims.example>', date: '2026-11-10T23:00:40Z' }, since), true);
  assert.equal(icimsCodeMail({ from: 'iCIMS <no-reply@icims.example>', date: '2026-11-10T23:02:00Z' }, since), true);
  assert.equal(icimsCodeMail({ from: 'iCIMS <no-reply@icims.example>', date: '2026-11-10T22:30:00Z' }, since), false);
  assert.equal(icimsCodeMail({ from: 'Walmart Careers <noreply@careers.walmart.com>', date: '2026-11-10T23:01:00Z' }, since), false);
  assert.equal(icimsCodeMail(null, since), false);
});

test('blockerIn: an hCaptcha frame known to be hidden is no blocker (iCIMS keeps an invisible hCaptcha on its portal pages); a shown one, or one whose visibility is unknown, still is', () => {
  const base = 'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html';
  assert.equal(blockerIn({ hasPassword: false, frames: [{ src: `${base}#frame=checkbox-invisible`, visible: false }, { src: `${base}#frame=challenge`, visible: false }] }), null);
  assert.equal(blockerIn({ hasPassword: false, frames: [{ src: `${base}#frame=checkbox-invisible`, visible: false }, { src: `${base}#frame=challenge`, visible: true }] }), 'captcha');
  assert.equal(blockerIn({ hasPassword: false, frames: [`${base}#frame=challenge`] }), 'captcha');
  assert.equal(blockerIn({ hasPassword: false, frames: [{ src: 'https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=normal', visible: true }] }), 'captcha');
});

// ---------- iCIMS profile page that also creates the login ----------
// After the login page, a portal can show one Candidate Profile form holding the resume upload,
// "Create a login" (Login, Password, Password (Re-enter)) and the profile fields; the runner once
// refused it as "a password inside a longer form".
test('icimsStage: a password and its confirmation inside the candidate profile form (a resume upload, a dozen fields) is the profile page that creates the login, not a sign-up page', () => {
  const profile = { ...IC, url: icPath('login'), heading: 'Staff Platform Engineer', email: true, passwords: 2, file: true, inputs: 12, buttons: ['My Computer', 'Google Drive', 'Dropbox', 'OneDrive', 'Next'], text: 'Candidate Profile\nResume\nCreate a login\nLogin*\nPassword*' };
  assert.equal(icimsStage(profile), 'account-profile');
  assert.equal(icimsStage({ ...profile, file: false, inputs: 16 }), 'account-profile');
  // A short sign-up form is still the account page.
  assert.equal(icimsStage({ ...IC, heading: 'Create Your Account', email: true, passwords: 2, inputs: 3, buttons: ['Create Account'] }), 'create-account');
});

test('icimsNav: "Submit Profile" moves a profile page on (some profile pages have no Next); a Submit off the profile and review pages is still held', () => {
  assert.deepEqual(icimsNav(['My Computer', 'Google Drive', 'Dropbox', 'OneDrive', 'Submit Profile'], 'account-profile'), { review: false, submit: null, next: 'Submit Profile', held: null });
  assert.deepEqual(icimsNav(['Submit Profile'], 'profile'), { review: false, submit: null, next: 'Submit Profile', held: null });
  assert.deepEqual(icimsNav(['Back', 'Next'], 'account-profile'), { review: false, submit: null, next: 'Next', held: null });
  assert.deepEqual(icimsNav(['Submit Profile'], 'eeo'), { review: false, submit: null, next: null, held: 'Submit Profile' });
});

test('planFill: an optional portfolio upload beside the CV slot is left empty, never asked ("Portfolio (if applicable)"); a required one is still asked', () => {
  const cvSlot = field({ key: 'f0', kind: 'file', label: 'Please upload your resume (Max size: 5 MB)' });
  const folio = field({ key: 'f1', kind: 'file', label: 'Portfolio (if applicable)', required: false });
  const p = planFill([cvSlot, folio], bank, ctx);
  assert.deepEqual(p.actions.map((a) => [a.key, a.source]), [['f0', 'cv']]);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(planFill([cvSlot, { ...folio, required: true }], bank, ctx).missing.map((m) => [m.key, m.reason]), [['f1', 'unlabeled-file']]);
});

const icBank = { ...bank, profile: { ...bank.profile, country: 'United States', state: 'Illinois' } };
const icProfile = [
  field({ key: 'f0', kind: 'file', id: 'PortalProfileFields.Resume_File', label: 'Please upload your resume (Max size: 5 MB)' }),
  field({ key: 'f1', id: 'PersonProfileFields.Login', label: 'Login' }),
  field({ key: 'f2', id: '-1_PersonProfileFields.PhoneNumber', label: 'Number' }),
  field({ key: 'f3', kind: 'select', id: '-1_PersonProfileFields.PhoneType', label: 'Type', options: ['', 'Mobile', 'Home', 'Work', 'Google Voice'] }),
  field({ key: 'f4', kind: 'select', id: '-1_PersonProfileFields.AddressState', label: 'State/Province', widget: 'icims', search: true, combobox: true }),
  field({ key: 'f5', kind: 'select', id: '-1_PersonProfileFields.AddressCountry', label: 'Country', widget: 'icims', search: true, combobox: true }),
  field({ key: 'f6', kind: 'select', id: 'rcf9553', label: 'Do you agree to receive automated text messages about your job application and job opportunities from Globex and understand that you can opt out at anytime?', widget: 'icims', options: ['Yes', 'No'] }),
  field({ key: 'f7', kind: 'select', id: 'rcf9339', label: 'Do you consent to the use of iCIMS Talent Cloud Artificial Intelligence (TCAI) to analyze your resume and profile for the purpose of matching your qualifications against current and future opportunities?', widget: 'icims', options: ['Yes', 'No'] }),
];

test('icimsPlan: the Login box takes the account email; the phone labelled "Number" is the phone; the generic "Type" selects are asked by what they type; Country is picked before State, whose list loads from it; the SMS and TCAI questions are the operator\'s consent, asked', () => {
  const p = icimsPlan(icProfile, icBank, ctx, { login: 'jordan@example.com' });
  assert.deepEqual(p.actions.map((a) => [a.key, a.action, a.value, a.source]), [
    ['f0', 'file', '/tmp/cv.pdf', 'cv'],
    ['f1', 'fill', 'jordan@example.com', 'account'],
    ['f2', 'fill', '(555) 555-0100', 'phone'],
    ['f5', 'pick', 'United States', 'country'],
    ['f4', 'pick', 'Illinois', 'state'],
  ]);
  assert.deepEqual(p.missing.map((m) => [m.key, m.label, m.reason]), [
    ['f3', 'Phone Type', 'no-answer'],
    ['f6', icProfile[6].label, 'consent'],
    ['f7', icProfile[7].label, 'consent'],
  ]);
});

test('icimsPlan: the operator\'s own answers win: a job answer to the TCAI question and a learned "Phone Type" fill them, and a job answer for the Login box replaces the account email', () => {
  const learned = { ...icBank, learned: [...icBank.learned, { label: 'phone type', answer: 'Mobile', source: 'test' }] };
  const p = icimsPlan(icProfile, learned, { ...ctx, jobAnswers: { [normLabel(icProfile[7].label)]: 'No', '#PersonProfileFields.Login': 'jexample' } }, { login: 'jordan@example.com' });
  const by = Object.fromEntries(p.actions.map((a) => [a.key, [a.value, a.source]]));
  assert.deepEqual(by.f3, ['Mobile', 'learned']);
  assert.deepEqual(by.f7, ['No', 'job']);
  assert.deepEqual(by.f1, ['jexample', 'job']);
  assert.deepEqual(p.missing.map((m) => m.key), ['f6']);
});

// A searchable School list can lack the applicant's school while the page has an "Other School" box:
// the list's Other option is picked and the name typed there. otherOption names that option.
test('otherOption: the list\'s Other entry ("*Other", "Other (please specify)"), never a school that merely contains the word', () => {
  assert.equal(otherOption(['*N/A', '*Other', 'Aalborg University']), '*Other');
  assert.equal(otherOption(['Other (please specify)', 'Otherland College']), 'Other (please specify)');
  assert.equal(otherOption(['Otherland College', 'Stanford University']), null);
  assert.equal(otherOption([]), null);
});

// Gem renders each radio option of one question as its own field ("Are you willing to work hybrid
// ...?" came as one field with options ["Yes"] and one with ["No"]). The field that holds the answer
// is picked; its sibling without that option is no error.
test('planFill: a radio question split into one field per option picks the matching field and marks the sibling covered, not missing', () => {
  const label = 'Are you willing to work hybrid (3 days a week) in our Springfield office? *';
  const fields = [
    { key: 'f10', kind: 'radio', label, required: true, options: ['Yes'], value: '' },
    { key: 'f11', kind: 'radio', label, required: true, options: ['No'], value: '' },
  ];
  const plan = planFill(fields, { ...bank, learned: [{ label: normLabel(label), answer: 'Yes', source: 'test' }] }, ctx);
  assert.deepEqual(plan.actions.map((a) => [a.key, a.value]), [['f10', 'Yes']]);
  assert.deepEqual(plan.missing, []);
  // The runner's last check flags any required field left empty: the sibling must be marked covered.
  assert.deepEqual(plan.covered, ['f11']);
  // An answer neither field lists is still asked on both.
  const none = planFill(fields, { ...bank, learned: [{ label: normLabel(label), answer: 'Maybe', source: 'test' }] }, ctx);
  assert.deepEqual(none.missing.map((m) => [m.key, m.reason]), [['f10', 'no-matching-option'], ['f11', 'no-matching-option']]);
  assert.deepEqual(none.covered, []);
});

// A company-site form can end with "Finish": config/apply.json submit_labels names that button for its
// channel. Elsewhere "Finish" is not trusted as a submit, and a Submit button still comes first.
test('submitLabel: a submit_labels entry names a final button not called Submit, matched whole in any letter case, on its own channel only', () => {
  const buttons = ['Add Education', 'Add Another Employer', 'Remove File', 'FINISH'];
  const labels = { 'site:careers.example.com': ['Finish'] };
  assert.equal(submitLabel(buttons, 'site:careers.example.com', labels), 'FINISH');
  assert.equal(submitLabel(buttons), undefined);
  assert.equal(submitLabel(buttons, 'greenhouse', labels), undefined);
  assert.equal(submitLabel(buttons, 'site:careers.example.com', {}), undefined);
  assert.equal(submitLabel(['Finish later', 'Back'], 'site:careers.example.com', labels), undefined, 'matched whole, never as a part');
  assert.equal(submitLabel(['Finish', 'Submit application'], 'site:careers.example.com', labels), 'Submit application');
});

test('confirmationIn: "Application received." at the start of a line confirms a company form\'s own submit; the words inside a sentence do not', () => {
  assert.equal(confirmationIn('Apply for this role\nSend us your application below; the hiring team reads every one.\nApplication received. The hiring team will review it directly.'), true);
  assert.equal(confirmationIn('Apply for this role\nSend us your application below; the hiring team reads every one.\nWhy this role? *\nSubmit application'), false);
  assert.equal(confirmationIn('We read every application received and reply within two weeks'), false);
});

// A bot check shown after Next (an iCIMS hCaptcha) left a page that did not move: not a stuck form.
test('afterStuck: a bot check that appears after Next waits for the operator when headed, else hands off; no challenge stays stuck', () => {
  assert.equal(afterStuck({ challenged: false, headed: true }), 'stuck');
  assert.equal(afterStuck({ challenged: true, headed: true }), 'wait');
  assert.equal(afterStuck({ challenged: true, headed: false }), 'manual');
  assert.equal(afterStuck({ challenged: true, headed: true, cleared: true }), 'retry');
  assert.equal(afterStuck({ challenged: true, headed: true, cleared: false }), 'manual');
});

test('settledAfterChallenge: after a solved bot check the step is retaken only once a labelled button is back (iCIMS shows a blank Next while it submits)', () => {
  assert.equal(settledAfterChallenge('Enter Your Information', { text: 'Enter Your Information', buttons: [] }), false);
  assert.equal(settledAfterChallenge('Enter Your Information', { text: 'Enter Your Information', buttons: ['Next'] }), true);
  // Text alone moves while the portal still spins: only a labelled button counts.
  assert.equal(settledAfterChallenge('Enter Your Information', { text: 'Enter Your Information hCaptcha', buttons: [''] }), false);
  assert.equal(settledAfterChallenge('Enter Your Information', { text: 'Profile: Contact details', buttons: ['Submit'] }), true);
  assert.equal(settledAfterChallenge('x', null), false);
});

test('classifyLabel: "Your Full Name" is the full name (it was once left empty)', () => {
  assert.equal(classifyLabel('Your Full Name'), 'full_name');
  assert.equal(classifyLabel('Your Legal Name'), 'full_name');
  assert.equal(classifyLabel('Full Name'), 'full_name');
  assert.equal(classifyLabel('Your name'), 'full_name');
});

test('pickOption and pickChoice: an option with zero-width characters still matches its words, and the option itself comes back', () => {
  const opt = '​​I have reviewed the Background Check Policy';
  assert.equal(pickOption([opt], 'I have reviewed the Background Check Policy'), opt);
  assert.equal(pickChoice([opt], 'I have reviewed the Background Check Policy'), opt);
  assert.equal(pickChoice(['​Yes - I live in the US', '​No'], 'Yes'), '​Yes - I live in the US');
});

test('listValues: an answer naming several values, split on "|"; one value stays one', () => {
  assert.deepEqual(listValues('Docker | Kubernetes'), ['Docker', 'Kubernetes']);
  assert.deepEqual(listValues(' A |  | B '), ['A', 'B']);
  assert.deepEqual(listValues('Computer Science'), ['Computer Science']);
  assert.deepEqual(listValues(''), []);
});

// Beside the resume and cover-letter uploads a form can offer an optional slot labelled just "Other". It is
// left empty, like an optional "Additional Attachments" slot, never asked.
test('planFill: an optional upload labelled just "Other" is left empty and not asked', () => {
  const fields = [
    { key: 'r', kind: 'file', label: 'Resume', required: true },
    { key: 'c', kind: 'file', label: 'Cover Letter', required: false },
    { key: 'o', kind: 'file', label: 'Other', required: false },
  ];
  const plan = planFill(fields, { profile: {}, facts: {}, learned: [] }, { cv: '/tmp/cv.pdf', coverPdf: '/tmp/letter.pdf' });
  assert.deepEqual(plan.actions.map((a) => [a.key, a.source]), [['r', 'cv'], ['c', 'cover']]);
  assert.deepEqual(plan.missing, []);
});

// Searched education lists (react-select v1): typed text is no value, so the runner searches the list and clicks
// the option that is the answer. listChoice names it: the same text, else the one option that says the same words
// without punctuation, "degree" or a plural s. Never a near guess: "Master of Science" is not "Master's Degree",
// and two loose matches are no choice.
const RS_SCHOOL = 'Example State University of Science, Technology and Arts';
test('listChoice: the option that is the answer, exact or loosely the same words, never a near guess', () => {
  const degrees = ["Bachelor's Degree", 'Master of Arts (MA)', 'Master of Science (MS)', "Master's Degree", 'Other'];
  assert.equal(listChoice(degrees, "Master's Degree"), "Master's Degree");
  assert.equal(listChoice(degrees, 'master\u2019s degree'), "Master's Degree");
  assert.equal(listChoice(['Bachelors', 'Masters', 'Doctorate'], "Master's Degree"), 'Masters');
  assert.equal(listChoice(["Master's", 'Masters Degree'], "Master's Degree"), null, 'two loose matches: ambiguous');
  assert.equal(listChoice(['Master of Science (MS)', 'Master of Arts (MA)'], "Master's Degree"), null);
  assert.equal(listChoice(['Example State University', RS_SCHOOL], RS_SCHOOL), RS_SCHOOL);
  assert.equal(listChoice(['Example State University'], RS_SCHOOL), null);
  assert.equal(listChoice(['Applied Mathematics', 'Computer Science'], 'Applied Linguistics'), null);
  assert.equal(listChoice([], 'Applied Linguistics'), null);
  assert.equal(listChoice(['Other'], ''), null);
});

// A University list can write a school as "<name> - <abbreviation> - <country>": the answer is the one option
// whose name segment says the same words.
test('listChoice: a "<name> - <abbreviation> - <country>" option is the answer when its name segment is, and only one is', () => {
  const unis = ['Northern Example State University - NESU - Freedonia', 'Example State University of Science Technology and Arts - ESUSTA - Freedonia', 'Example State University of Railway Engineering - ESURE - Freedonia'];
  assert.equal(listChoice(unis, RS_SCHOOL), 'Example State University of Science Technology and Arts - ESUSTA - Freedonia');
  assert.equal(listChoice(unis, 'Example State University'), null, 'Northern Example State University is another school');
  assert.equal(listChoice(['Example Polytechnic University - US', 'Example Polytechnic University - Online - US'], 'Example Polytechnic University'), null, 'two name matches: ambiguous');
  assert.equal(listChoice(['Example State University - Freedonia', 'Example State University Branch 1 - Freedonia'], 'Example State University'), 'Example State University - Freedonia');
});

// The searches typed into such a list: the whole answer first, then its first and last words (a possessive
// dropped), so a list that words the option a little differently still shows its near options.
test('listSearches: the whole answer, then short searches from its first and last words (3+ letters), so a miss shows the nearest options', () => {
  assert.deepEqual(listSearches(RS_SCHOOL), [RS_SCHOOL, 'Example', 'Arts']);
  assert.deepEqual(listSearches("Master's Degree"), ["Master's Degree", 'Master', 'Degree']);
  assert.deepEqual(listSearches('Applied Linguistics'), ['Applied Linguistics', 'Applied', 'Linguistics']);
  assert.deepEqual(listSearches('Other'), ['Other']);
  assert.deepEqual(listSearches('MS in CS'), ['MS in CS'], 'a first word under 3 letters is no search');
});

// The fields as collectForm reads a react-select v1 education block, and the job's answers (keys are normLabel).
const RS_JOB = { university: RS_SCHOOL, 'degree status': 'Graduated', 'field of study (max 2)': 'Applied Linguistics', 'honors: (max 2)': '', other: '' };
const rsBank = { profile: {}, facts: {}, eeo: 'decline', learned: [{ label: 'degree', answer: "Master's Degree", source: 'test' }] };
const rsField = (key, label, required, extra = {}) => ({ key, kind: 'select', label, required, options: [], value: '', combobox: true, widget: 'react-select', ...extra });
test('planFill: react-select lists take a pick of the answer; a blank optional list (Honors) and an unanswered one (award) are not touched', () => {
  const fields = [
    rsField('u', 'University* ?', true, { id: 'university-autocomplete-input-0' }),
    { key: 's', kind: 'select', label: 'Degree Status* ?', required: true, options: ['Select', 'Graduated', 'Incomplete'], value: '' },
    rsField('d', 'Degree* ?', true, { id: 'degree-autocomplete-field-0' }),
    rsField('f', 'Field of Study (Max 2)* ?', true),
    rsField('h', 'Honors: (Max 2) ?', false),
    rsField('a', 'Name of award/accomplishment', false),
  ];
  const plan = planFill(fields, rsBank, { jobAnswers: RS_JOB });
  assert.deepEqual(plan.actions.map((x) => [x.key, x.action, x.value, x.source]), [
    ['u', 'pick', RS_SCHOOL, 'job'],
    ['s', 'select', 'Graduated', 'job'],
    ['d', 'pick', "Master's Degree", 'learned'],
    ['f', 'pick', 'Applied Linguistics', 'job'],
  ]);
  assert.deepEqual(plan.missing, []);
  // An optional list the bank answers is picked as optional: a miss there leaves it blank.
  const opt = planFill([rsField('h', 'Honors: (Max 2) ?', false)], rsBank, { jobAnswers: { 'honors: (max 2)': 'Cum Laude' } });
  assert.deepEqual(opt.actions.map((x) => [x.key, x.action, x.optional]), [['h', 'pick', true]]);
});

test('planFill: a react-select list already showing the answer (or a loose match of it, or Other with the answer in its box) is not picked again; the Other box the pick typed into is not asked', () => {
  const fields = [
    rsField('u', 'University* ?', true, { value: 'Other', other_text: RS_SCHOOL }),
    { key: 'ub', kind: 'text', label: 'Other', required: true, options: [], value: RS_SCHOOL, other_for: true },
    rsField('d', 'Degree* ?', true, { value: 'Masters' }),
    rsField('f', 'Field of Study (Max 2)* ?', true, { value: 'Other', other_text: 'Applied Linguistics' }),
    { key: 'fb', kind: 'text', label: 'Other', required: true, options: [], value: 'Applied Linguistics', other_for: true },
  ];
  const plan = planFill(fields, rsBank, { jobAnswers: RS_JOB });
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.missing, []);
  // Other with an empty box is not the answer yet: picked again.
  const again = planFill([rsField('f', 'Field of Study (Max 2)* ?', true, { value: 'Other', other_text: '' })], rsBank, { jobAnswers: RS_JOB });
  assert.deepEqual(again.actions.map((x) => [x.key, x.action]), [['f', 'pick']]);
});

// A "Field of Study (Max 2)" list can take two values, stored in the job answers as "Computer Science |
// Mathematics". Such a list is one react-select per value, every row named by the same label (rs_group); a second
// row comes from the field's "Add Field of Study" button.
test('planFill: a two-value answer for a "(Max 2)" list is one pick on its first row with both values; its other rows are covered, not asked; rows already holding both values take no action', () => {
  const job = { ...RS_JOB, 'field of study (max 2)': 'Computer Science | Mathematics' };
  const row = (key, value = '') => rsField(key, 'Field of Study (Max 2)* ?', true, { rs_group: 'field-of-study-label-0', value });
  const one = planFill([row('f1')], rsBank, { jobAnswers: job });
  assert.deepEqual(one.actions.map((x) => [x.key, x.action, x.value, x.values]), [['f1', 'pick', 'Computer Science | Mathematics', ['Computer Science', 'Mathematics']]]);
  assert.deepEqual(one.missing, []);
  const two = planFill([row('f1'), row('f2')], rsBank, { jobAnswers: job });
  assert.deepEqual(two.actions.map((x) => [x.key, x.values]), [['f1', ['Computer Science', 'Mathematics']]]);
  assert.deepEqual(two.missing, []);
  assert.deepEqual(two.covered, ['f2']);
  const partly = planFill([row('f1', 'Computer Science')], rsBank, { jobAnswers: job });
  assert.deepEqual(partly.actions.map((x) => x.key), ['f1'], 'one of two values held: picked again');
  const done = planFill([row('f1', 'Computer Science'), row('f2', 'Mathematics')], rsBank, { jobAnswers: job });
  assert.deepEqual([done.actions, done.missing], [[], []]);
  // One value keeps the one-row path: no values list.
  const single = planFill([row('f1')], rsBank, { jobAnswers: RS_JOB });
  assert.deepEqual(single.actions.map((x) => [x.key, x.value, x.values]), [['f1', 'Applied Linguistics', undefined]]);
});

test('planFill: a checkbox group answered with several values is one action that ticks each of them; a value the group lacks asks it; a group already holding them is left alone', () => {
  const f = field({ key: 't', kind: 'radio', checkboxes: true, label: 'Please select all of the tools you have hands-on experience with?', options: ['Terraform', 'Ansible', 'Docker', 'Kubernetes', 'CircleCI', 'Jenkins'] });
  const jobAnswers = { [normLabel(f.label)]: 'Docker | Kubernetes | CircleCI | Terraform' };
  const p = planFill([f], bank, { ...ctx, jobAnswers });
  assert.deepEqual(p.actions.map((x) => [x.key, x.action, x.value, x.values]), [['t', 'radio', 'Docker | Kubernetes | CircleCI | Terraform', ['Docker', 'Kubernetes', 'CircleCI', 'Terraform']]]);
  assert.deepEqual(p.missing, []);
  // A value the group does not list is asked, never half-ticked.
  const bad = planFill([f], bank, { ...ctx, jobAnswers: { [normLabel(f.label)]: 'Docker | Chef' } });
  assert.deepEqual(bad.missing.map((m) => [m.key, m.reason]), [['t', 'no-matching-option']]);
  assert.deepEqual(bad.actions, []);
  // The collector reads a group's ticked boxes as "a | b": the same values in any order take no action.
  const held = planFill([{ ...f, value: 'Kubernetes | Docker' }], bank, { ...ctx, jobAnswers: { [normLabel(f.label)]: 'Docker | Kubernetes' } });
  assert.deepEqual([held.actions, held.missing], [[], []]);
});

test('COOKIE_DECLINE: a decline button, with an icon before its words and "cookies" after them, matches; no accept or settings button does', () => {
  for (const t of ['Reject all cookies', '× Reject all cookies', 'Decline', 'Reject all', 'Decline all', 'Only necessary', 'Use necessary cookies only', 'Reject']) assert.match(t, COOKIE_DECLINE, t);
  for (const t of ['Accept all cookies', '✓ Accept all cookies', 'Accept', 'Accept all', 'Cookie settings', 'You can change the optional cookie settings here if you wish.']) assert.doesNotMatch(t, COOKIE_DECLINE, t);
});

test('AI-applicant question: detected in its common wordings, never answered from the bank, never learned', () => {
  for (const q of ['Are you using an AI agent to apply for this job?', 'Is this application being submitted by a bot or automated tool?', 'Did you use AI to complete this application?',
    'Is an AI applying on your behalf?', 'Was artificial intelligence used to fill out this application?', 'Are you a human applicant or an automated agent submitting on behalf of a candidate?']) {
    assert.equal(isAiApplicantQuestion(q), true, q);
  }
  for (const q of ['Do you have experience building AI agents?', 'Years of experience with automated testing', 'How did you hear about us?', 'Describe an AI product you shipped', 'Are you willing to relocate?']) {
    assert.equal(isAiApplicantQuestion(q), false, q);
  }
  const label = 'Are you using an AI agent to apply for this job?';
  const learned = { ...bank, learned: [{ label: normLabel(label), answer: 'No', source: 'test' }] };
  const p = planFill([field({ key: 'ai', kind: 'radio', label, options: ['Yes', 'No'], required: true })], learned, ctx);
  assert.deepEqual(p.actions.filter((a) => a.key === 'ai'), [], 'nothing is filled for it, even with a learned answer');
  assert.deepEqual(p.missing.map((m) => [m.key, m.reason]), [['ai', 'ai-applicant-question']]);
  assert.throws(() => learnAnswer({ learned: [] }, label, 'No', 'user'), /AI-applicant/);
  const group = (k, l) => field({ key: k, kind: 'checkbox', label: l, group: 'ai_use', group_label: 'Was this application completed with AI?', required: true });
  const g = planFill([group('g1', 'Yes'), group('g2', 'No')], bank, ctx);
  assert.ok(g.missing.some((m) => m.reason === 'ai-applicant-question'), 'a checkbox group asking it is handed over too');
  assert.deepEqual(g.actions.filter((a) => a.action === 'check'), []);
});

test('AI-applicant question: a run that met one becomes a hand-off for the operator (exit 5), not a question', () => {
  const missing = [{ key: 'ai', label: 'Is an AI applying on your behalf?', kind: 'radio', options: ['Yes', 'No'], reason: 'ai-applicant-question' }];
  const [code, r] = aiApplicantHandoff([4, { outcome: 'needs_answers', channel: 'greenhouse', ats_url: 'https://boards.greenhouse.io/x', detail: missing, filled: [] }]);
  assert.equal(code, 5);
  assert.equal(r.outcome, 'manual');
  assert.equal(r.reason, 'ai-applicant-question');
  assert.equal(r.ats_url, 'https://boards.greenhouse.io/x');
  const other = [4, { outcome: 'needs_answers', detail: [{ key: 'x', reason: 'no-answer' }] }];
  assert.deepEqual(aiApplicantHandoff(other), other);
});

