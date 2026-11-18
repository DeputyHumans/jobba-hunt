// Application forms: pure functions, no browser. The runner (apply-job.mjs) snapshots a
// form into fields {key, kind, label, required, options, value}; planFill turns them into
// actions from the answer bank (workspace profile/answers.json) and lists every required
// question it cannot answer. It never guesses: an unknown required question stops the
// application (needs_answers) and goes to the operator.
// User-specific values (EEO answers, the home country behind the US-only helpers) come from the
// bank planFill is given; the standalone helpers default to answers() from the workspace, read on
// each call, so tests and callers can pass their own.

import { answers, CV_FILE_RE } from './profile.mjs';

export function normLabel(label) {
  // "(Required)" in brackets goes with its brackets: dropping the word alone left "address line 1 ( )".
  return (label || '').toLowerCase().replace(/\*/g, ' ').replace(/\(\s*required\s*\)/g, ' ').replace(/\brequired\b/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[\s?.:!]+$/, '');
}

// Strict on purpose: "years of experience with <a technology>" is a skill claim only the operator
// can answer, so only the plain total-experience question maps to the years_total fact.
const YEARS_TOTAL = /^(how many (total )?years of (total |overall )?(work |professional )?experience (do you have|have you)( in total)?|(total )?years of (work |professional )?experience)$/;
const RULES = [
  ['eeo', /\b(gender|sex|race|racial|ethnicity|ethnic|hispanic|latino|latina|veterans?|disability|disabled|sexual orientation|transgender|pronouns?)\b/],
  // Polarity matters: "have authorization to work here without visa sponsorship" wants Yes, "will
  // you require sponsorship" wants No. The first is work authorization; only require/need wording
  // is the sponsorship fact, and any other sponsor wording is asked.
  ['work_authorization', /authori[sz](ed|ation)\b.{0,80}\bwithout (requiring |needing |the need for )?(a |any )?(visa |employer )?sponsorship/],
  ['sponsorship', /\b(requir|need)\w*\b.{0,60}\bsponsor|\bsponsor\w*\b.{0,40}\b(requir|need)/],
  ['work_authorization', /(authori[sz]ed|eligible|legally (able|permitted|entitled)).{0,40}\bwork\b|work authori[sz]ation|right to work/],
  // A message box on an application form is the intro note; a "text message" opt-in is not.
  ['cover_letter', /cover letter|additional information|anything else (you'?d|you would) like|^message$|write your message|message to (the )?(hiring|recruit)|^(additional )?comments?$/],
  // An extension is never the phone number (a "Phone Extension" box once took it), and a "Phone
  // Code" select is the country calling code.
  ['phone_extension', /\bphone ext(ension)?\b|^ext(ension)?\b/],
  ['phone_country', /country code|phone code|dial(l)?ing code/],
  ['phone', /\b(phone|mobile)\b/],
  ['email', /e-?mail/],
  ['first_name', /^(legal )?(first|given) name/],
  ['last_name', /^(legal )?(last name|surname|family name)/],
  // "Your Full Name" is the full name too (it was once left empty).
  ['full_name', /^(your )?(full |legal )?name$/],
  ['linkedin', /linkedin/],
  ['website', /\b(website|portfolio|personal site)\b/],
  ['state', /^(state|state\/province|province|state or province|state \/ province)$/],
  ['zip', /^(zip|zip code|postal code|postcode|zip\/postal code)$|\b(zip|postal) code of your (current|home|permanent)|^what is your (zip|postal) code/],
  ['country', /^(country|country of residence|place of residence|current country)$/],
  ['street_address', /^(address|street address|address line 1|street)$/],
  ['city', /^(city|location|current location|current city)\b/],
  ['rate_hourly', /\bhourly\b|per hour|\/ ?hr\b/],
  ['rate_annual', /\b(salary|compensation)\b|desired pay|expected pay/],
  // "Start date month/year" is a section date (Greenhouse education), not availability.
  ['start_date', /start date(?! (month|year))|earliest start|when can you start|available to start|availability to start|notice period|when (are|would) you (be )?available/],
  ['relocation', /relocat/],
  ['remote', /(comfortable|open to|willing to) (work(ing)? )?remote|remote (work|setting|role|position)/],
  // "How did you find out?" inside a story question is not the referral source.
  ['how_heard', /how did you (first )?hear|how did you (first )?(find|learn) (out )?about (us|this|the|our)/],
];

export function classifyLabel(label) {
  const l = normLabel(label);
  // Workday's "Phone Device Type" (Mobile, Home, Work) is not the number.
  if (/\b(phone )?device type\b|\bphone type\b/.test(l)) return null;
  // A conditional follow-up ("If you answered yes to the question above, describe...") is not the
  // question it follows: asked, never answered from the bank (a bank "No" once filled a box that
  // wanted "N/A").
  if (/^if you (answered|selected|chose)\b/.test(l)) return null;
  // "Are you based in X, or open to relocating?" asks where the applicant lives first: the
  // relocation fact is not its answer. Asked, or job-scoped.
  if (/relocat/.test(l) && /\b(currently )?(based|located|living|live|reside|residing)\b/.test(l)) return null;
  // A referral question wants the referrer's details, never the applicant's own ("...referred you
  // for this role? If so, please include their email here" once got the applicant's email).
  if (/\breferr(ed|er|al)\b/.test(l)) return null;
  if (YEARS_TOTAL.test(l)) return 'years_total';
  for (const [key, re] of RULES) if (re.test(l)) return key;
  return null;
}

const PLACEHOLDER = /^(select( an)? option|select\.*|choose\.*|--+|please select)$/i;
const DECLINE = /decline|prefer not|don.?t wish|do not wish|(don.?t|do not) want to (answer|disclose|say)|not to (answer|disclose|say|self)|choose not/i;

// EEO self-identification. The bank's eeo is { gender, race, hispanic, veteran, disability }, each
// "decline" (the default) or the answer the user chose: a short word ("Male", "Female", "Yes", "No",
// "White") or an option's own text. A category the bank has no key for (sexual orientation,
// transgender, pronouns) is declined. A plain string eeo ("decline") applies to every category.
export function eeoAnswer(eeo, cat) {
  if (!cat) return 'decline';
  const v = typeof eeo === 'string' ? eeo : eeo && typeof eeo === 'object' ? eeo[cat] : null;
  const s = String(v ?? '').trim();
  return !s || /^decline$/i.test(s) ? 'decline' : s;
}
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Words that name the same option ("Man" for "Male").
const EEO_SYNONYMS = { male: ['male', 'man'], female: ['female', 'woman'], white: ['white', 'caucasian'] };
// What Yes and No pick, per category: the option wording differs ("I am not a protected veteran",
// "No, I do not have a disability"). A veteran "No" never takes "I identify as a veteran, just not a
// protected veteran": that person is a veteran.
const EEO_YES_NO = {
  hispanic: { yes: [/^yes\b/i, /^(?!.*\bnot\b).*\b(hispanic|latin[oax])/i], no: [/^no\b/i, /not hispanic/i] },
  veteran: {
    yes: [/^yes\b/i, /^(?!.*\bnot\b).*\bidentify as\b.*\bveteran/i, /^i am a (protected )?veteran\b/i],
    no: [/\bnot a veteran\b/i, /^(?!.*identify as a veteran).*\bnot\b[^.]*\bveteran/i, /^no\b/i],
  },
  disability: { yes: [/^yes\b/i, /^(?!.*\b(not|don.?t)\b).*\bhave (a|had a) disability/i], no: [/do(n.t| not) have a disability/i, /^no\b/i] },
};
// The option patterns an answer picks, most specific first: the option's own text, then the
// category's Yes/No wording, then an option that starts with the answer (or a synonym) as a whole
// word, so "Male" never lands on "Female".
function eeoMatchers(cat, answer) {
  const a = String(answer).trim();
  const key = a.toLowerCase();
  const yn = /^(yes|no)$/.test(key) ? EEO_YES_NO[cat]?.[key] || [] : [];
  const words = EEO_SYNONYMS[key] || [key];
  return [new RegExp(`^\\s*${reEsc(a)}\\s*$`, 'i'), ...yn, ...words.map((w) => new RegExp(`^\\W*${reEsc(w)}(?![\\w-])`, 'i'))];
}
// What to type into an EEO typeahead so its list holds the wanted option; eeoPick then chooses among
// what is listed (typing "Mal" also lists "Female"). A decline types "decline".
const EEO_PROBE_YES_NO = { veteran: { no: 'not', yes: 'veteran' } };
export function eeoProbe(cat, eeo = answers().eeo) {
  const want = eeoAnswer(eeo, cat);
  if (want === 'decline') return 'decline';
  const key = want.toLowerCase();
  if (EEO_PROBE_YES_NO[cat]?.[key]) return EEO_PROBE_YES_NO[cat][key];
  if (/^(yes|no)$/.test(key)) return want;
  return (want.split(/[^A-Za-z]+/).find((w) => w.length >= 3) || want).slice(0, 3);
}
export function eeoCategory(label) {
  const l = String(label || '').toLowerCase();
  if (/sexual orientation|transgender|pronoun/.test(l)) return null;
  if (/hispanic|latin[oa]|latinx/.test(l) && !/\brace\b/.test(l)) return 'hispanic';
  // "Ethnicity" alone is the US Hispanic or Latino question.
  if (/\bethnicity\b/.test(l) && !/\brace\b/.test(l)) return 'hispanic';
  if (/veteran/.test(l)) return 'veteran';
  if (/disab/.test(l)) return 'disability';
  if (/\brace\b|racial|ethnic/.test(l)) return 'race';
  if (/gender|\bsex\b/.test(l)) return 'gender';
  return null;
}
// The option an EEO question takes: the bank's answer for its category, else the decline option.
// An answer no option matches falls back to the decline option too.
export function eeoPick(options, label, eeo = answers().eeo) {
  const opts = (options || []).filter((o) => o && !PLACEHOLDER.test(o.trim()));
  // Paycor names both its gender and race groups "Gender, Ethnicity/Race": gender options decide.
  const genderOpts = opts.some((o) => /^(male|female|man|woman)\b/i.test(o.trim()));
  // An "Ethnicity" group that lists races is the race question: every option there says
  // "(Not Hispanic ...)", so the Hispanic rule would take the first one.
  const raceOpts = opts.some((o) => /^white\b/i.test(o.trim())) && opts.some((o) => /^(asian|black)\b/i.test(o.trim()));
  const cat = genderOpts ? 'gender' : raceOpts ? 'race' : eeoCategory(label);
  const want = eeoAnswer(eeo, cat);
  if (want !== 'decline') for (const re of eeoMatchers(cat, want)) { const o = opts.find((x) => re.test(x.trim())); if (o) return o; }
  return opts.find((o) => DECLINE.test(o)) || null;
}

// Zero-width characters in an option's text (an Ashby option drawn as "​​I have reviewed the
// ... Policy") are not part of its words. The original option is still returned, so the runner finds it.
const ZW = /[​-‍﻿]/g;
const optKey = (o) => String(o).replace(ZW, '').trim().toLowerCase();

export function pickOption(options, answer) {
  const opts = (options || []).filter((o) => o && !PLACEHOLDER.test(o.replace(ZW, '').trim()));
  if (answer === 'decline') return opts.find((o) => DECLINE.test(o)) || null;
  const a = optKey(answer);
  const exact = opts.find((o) => optKey(o) === a);
  if (exact) return exact;
  // Several options that all start with the answer ("Yes - ... Canada", "Yes - ... USA") are
  // ambiguous: the field is asked, never filled with the first one.
  const prefixed = opts.filter((o) => { const t = optKey(o); return t.startsWith(`${a} `) || t.startsWith(`${a},`) || t.startsWith(`${a} (`); });
  return prefixed.length === 1 ? prefixed[0] : null;
}

const nonEmpty = (v) => (v == null || String(v).trim() === '' ? null : String(v));

function answerFor(field, bank, ctx) {
  const n = normLabel(field.label);
  // Job-scoped answers (data/applications/<id>/answers.json) beat everything: what the operator said
  // for this one application (an SMS consent, a start date, a salary left blank).
  // By element id first ("#<id>"): repeated sections (Paylocity work history) share their labels.
  const byId = field.id ? `#${field.id}` : null;
  if (ctx.jobAnswers && byId && Object.prototype.hasOwnProperty.call(ctx.jobAnswers, byId)) return { answer: nonEmpty(ctx.jobAnswers[byId]), source: 'job', blank: !nonEmpty(ctx.jobAnswers[byId]) };
  if (ctx.jobAnswers && Object.prototype.hasOwnProperty.call(ctx.jobAnswers, n)) return { answer: nonEmpty(ctx.jobAnswers[n]), source: 'job', blank: !nonEmpty(ctx.jobAnswers[n]) };
  const learned = (bank.learned || []).find((l) => l.label === n);
  if (learned && nonEmpty(learned.answer)) return { answer: String(learned.answer), source: 'learned' };
  const key = classifyLabel(field.label);
  if (!key) return { answer: null, source: null };
  if (key === 'cover_letter') return { answer: nonEmpty(ctx.coverNote), source: 'cover-note' };
  if (key === 'phone_extension') return { answer: null, source: key, blank: true };
  if (key === 'eeo') return { answer: eeoAnswer(bank.eeo, eeoCategory(field.label)), source: 'eeo' };
  // A box labelled just "City" takes the city alone; the bank's city is a full location string for
  // typeaheads ("Springfield, Illinois, United States").
  if (key === 'city' && /^city$/.test(normLabel(field.label)) && field.kind !== 'select') {
    const v = nonEmpty(bank.profile?.city);
    return { answer: v ? String(v).split(',')[0].trim() : null, source: 'city' };
  }
  return { answer: nonEmpty(bank.profile?.[key] ?? bank.facts?.[key]), source: key };
}

const NUMERIC_LABEL = /how many|number of years/i;
const digits = (v) => String(v || '').replace(/\D/g, '');
// A prefilled value that already says the same thing is left alone (no retyping).
const sameValue = (cur, want, key) => {
  if (!nonEmpty(cur)) return false;
  if (key === 'phone') return digits(cur) !== '' && digits(cur) === digits(want);
  return String(cur).trim().toLowerCase() === String(want).trim().toLowerCase();
};

// A typeahead answer with no matching suggestion may take the first one only when the answer
// is a place (city, country, zip): any other answer, a Yes/No above all, must match an option
// or the runner stops (Greenhouse 2026 react-select questions).
export function typeaheadFallback(source) {
  return /^(city|country|zip)$/.test(source || '');
}

// Run records (result.json, the runner's printout) never carry the phone, date of birth or
// street address: those stay in the answer bank, which is never committed or published.
export function maskPrivate(filled) {
  return (filled || []).map((x) => (['phone', 'street_address', 'dob', 'date_of_birth'].includes(x.source) || /\b(date of birth|birth ?date|dob)\b/i.test(x.label || '')
    ? { ...x, value: '[masked]' } : x));
}

// An open question worth a written answer: free text that asks about the person's work or
// motivation, not a name, contact, link, pay, demographic, referral, date or place field.
const NOT_OPEN = /salary|compensation|\bpay\b|\brate\b|pronoun|\bname\b|phone|e-?mail|address|website|\burl\b|\blink|linkedin|github|portfolio|twitter|referr|\brefer|hear about|\bsource\b|gender|\brace\b|veteran|disab|ethnic|hispanic|sexual|\bdate\b|notice|visa|sponsor|authori[sz]|relocat|location|\bcity\b|\bzip\b|country|\bstate\b|employer|school|degree|\bgpa\b|how many years|years of/i;
export function openQuestion(f) {
  if (!['textarea', 'text'].includes(f.kind)) return false;
  const label = String(f.label || '').trim();
  if (!label || NOT_OPEN.test(label)) return false;
  const asks = /\?\s*\*?\s*$/.test(label) || /^(what|why|how|describe|tell|share|explain|anything|is there|briefly|please (describe|tell|share|explain))\b/i.test(label);
  return f.kind === 'textarea' ? asks || label.split(/\s+/).length >= 4 : asks;
}

// US-only form conventions (state codes, a leading +1, MM/DD/YYYY) apply when the bank's country,
// answers().profile.country, is the United States; any other country's values pass through unchanged.
const isUS = (country) => /^(us|usa|u\.s\.(a\.)?|united states( of america)?)$/i.test(String(country || '').trim());
const homeCountry = () => answers().profile?.country || '';
// Today (or ctx.today, "YYYY-MM-DD", for tests) as a form date: MM/DD/YYYY for a US applicant,
// otherwise ISO YYYY-MM-DD.
function todayDate(today, country) {
  const d = today ? new Date(`${today}T12:00:00`) : new Date();
  const [y, m, day] = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')];
  return isUS(country) ? `${m}/${day}/${y}` : `${y}-${m}-${day}`;
}
// Today in a date widget's own section order ("MM/DD/YYYY", "MM/YYYY", "YYYY"): Workday addresses its
// date sections by name (Month, Day, Year), whatever the applicant's country.
function todayIn(format, today) {
  const d = today ? new Date(`${today}T12:00:00`) : new Date();
  const part = { MM: String(d.getMonth() + 1).padStart(2, '0'), DD: String(d.getDate()).padStart(2, '0'), YYYY: String(d.getFullYear()) };
  return String(format || 'MM/DD/YYYY').split('/').map((p) => part[p] ?? p).join('/');
}

// A question asking whether an AI, a bot or an agent is applying (or filled the form) on someone's
// behalf is the operator's alone: the runner never answers it, not even from a learned answer, never
// learns one for it, and hands the role over (aiApplicantHandoff). A false positive costs a hand-off,
// never a wrong answer. "AI" or "agent" in an ordinary question ("experience building AI agents",
// "why apply for this AI role") is not one.
const AI_ACTOR = String.raw`(?:ai|a\.i\.|artificial intelligence|bots?|agents?|automat\w*|llms?|chatgpt|gpt)`;
const AI_APPLIES = [
  // the actor does the applying: "an AI agent to apply", "AI applying", "artificial intelligence used to fill"
  new RegExp(String.raw`\b${AI_ACTOR}\b(?:\s+[\w'’-]+){0,2}?\s+(?:to\s+)?(?:apply|applying|submit\w*|complet\w*|fill\w*)\b`, 'i'),
  // the application is done by the actor: "submitted by a bot", "completed with AI"
  new RegExp(String.raw`\b(?:appl\w*|submit\w*|complet\w*|fill\w*)\b(?:\s+[\w'’-]+){0,3}?\s+(?:by|with|using|via|through)\s+(?:an?\s+|the\s+)?${AI_ACTOR}\b`, 'i'),
];
const AI_ON_BEHALF = new RegExp(String.raw`\b${AI_ACTOR}\b[\s\S]*\bbehalf\b|\bbehalf\b[\s\S]*\b${AI_ACTOR}\b`, 'i');
export const isAiApplicantQuestion = (label) => {
  const s = String(label || '');
  return AI_APPLIES.some((re) => re.test(s)) || AI_ON_BEHALF.test(s);
};
// A run stopped on an AI-applicant question is a hand-off (exit 5, outcome manual), not an open
// question: the operator submits that role by hand.
export function aiApplicantHandoff([code, result]) {
  const q = Array.isArray(result?.detail) ? result.detail.filter((m) => m?.reason === 'ai-applicant-question') : [];
  if (result?.outcome !== 'needs_answers' || !q.length) return [code, result];
  return [5, { ...result, outcome: 'manual', reason: 'ai-applicant-question', detail: `the form asks whether an AI applies (${q.map((m) => `"${m.label}"`).join(', ')}): the operator submits this role by hand`, questions: result.detail }];
}

export function planFill(fields, bank, ctx) {
  const actions = [];
  const missing = [];
  // Fields answered through a sibling (a radio question split into one field per option): the runner's
  // last check must not flag them as unanswered.
  const covered = [];
  const miss = (f, reason) => missing.push({ key: f.key, label: f.label, kind: f.kind, options: f.options || [], reason });
  const hasPhoneCode = (fields || []).some((g) => classifyLabel(g.label) === 'phone_country');
  const country = bank?.profile?.country || '';
  // File inputs: the cover letter input gets the approved cover letter PDF (or nothing), the
  // resume input the CV. An unlabeled input gets the CV only when it is the form's only file
  // input; otherwise it is asked, never guessed (a guess once put the CV in a cover slot).
  const files = fields.filter((f) => f.kind === 'file');
  for (const f of fields) {
    if (f.kind === 'checkbox' && /\bfollow\b/i.test(f.label)) { actions.push({ key: f.key, action: 'uncheck', value: null, source: 'never-follow' }); continue; }
    if (f.kind === 'file') {
      // An optional autofill upload beside the real Resume field is skipped: its parse could
      // overwrite typed answers (Ashby).
      if (/autofill/i.test(f.label) && files.some((o) => o !== f && /resume|\bcv\b/i.test(o.label) && !/autofill/i.test(o.label))) continue;
      // Accents dropped first: Rippling titles its CV slot "Résumé".
      const fl = String(f.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (/cover/i.test(fl)) {
        if (ctx.coverPdf) actions.push({ key: f.key, action: 'file', value: ctx.coverPdf, source: 'cover' });
        // No letter PDF: the approved intro note goes in as a file when the slot takes .txt
        // (Greenhouse 2026 boards accept .pdf,.doc,.docx,.txt,.rtf).
        else if (ctx.coverNoteFile && (!f.accept || /\.txt\b/i.test(f.accept))) actions.push({ key: f.key, action: 'file', value: ctx.coverNoteFile, source: 'cover-note' });
        else if (f.required) miss(f, 'cover-letter-file');
        continue;
      }
      if (/resume|\bcv\b|curriculum/i.test(fl) || files.length === 1) { actions.push({ key: f.key, action: 'file', value: ctx.cv, source: 'cv' }); continue; }
      // An "Additional Attachments" slot takes the approved letter; without one, an optional slot
      // is left empty rather than asked. An optional portfolio or work-sample slot is left empty
      // ("Portfolio (if applicable)").
      if (!f.required && /portfolio|work samples?|writing samples?/i.test(fl)) continue;
      // An optional slot labelled just "Other" (beside Resume and Cover Letter) is left empty.
      if (!f.required && /^\W*other\W*$/i.test(fl.trim())) continue;
      if (/\badditional\b.*\battach|\bother\b.*\battach|supporting doc/i.test(fl)) {
        if (ctx.coverPdf) { actions.push({ key: f.key, action: 'file', value: ctx.coverPdf, source: 'cover' }); continue; }
        if (!f.required) continue;
      }
      miss(f, 'unlabeled-file');
      continue;
    }
    // The free-text box a list's Other entry brought, which the pick typed the answer into: its own
    // label ("Other") is no question.
    if (f.other_for && nonEmpty(f.value)) continue;
    if (isAiApplicantQuestion(f.label)) { miss(f, 'ai-applicant-question'); continue; }
    const got = answerFor(f, bank, ctx);
    const { source, blank } = got;
    // A form with its own country-code field takes the national number as digits ("(555) ..."
    // failed as "Not a valid phone number"); for a US applicant a leading 1 is dropped. A non-US
    // number passes through as the bank holds it.
    const answer = source === 'phone' && hasPhoneCode && isUS(country) && f.kind !== 'select' && got.answer
      ? ((d) => (d.length === 11 && d.startsWith('1') ? d.slice(1) : d))(digits(got.answer))
      : got.answer;
    if (blank) { if (f.required) miss(f, 'job-blank-required'); continue; }
    // A repeated section about someone else's place (an employer, a school) never takes the
    // applicant's own address, city, zip or country (Paylocity work history). The same holds for
    // the applicant's availability: a job's Start Date is not "when can you start" (every
    // work-history Start Date once became "Immediately"). Phenom names its entries experienceData[n] and
    // educationData[n] (every employer's Location once got the applicant's city).
    if (['street_address', 'city', 'state', 'zip', 'country', 'start_date'].includes(source) && /work-?history|education|employer|school|experience/i.test(f.id || '')) { if (f.required) miss(f, 'section-field'); continue; }
    // Consent in any form (SMS, texts, terms) is the operator's: only a job or learned answer fills
    // it (an SMS consent dropdown once took the phone number because its label says "phone").
    if (!['job', 'learned'].includes(source) && /\bconsent\b|permission to text|\bsms\b|text messages?\b/i.test(f.label)) { miss(f, 'consent'); continue; }
    // Accepting a privacy policy or terms is the operator's consent: asked once, then learned, never
    // ticked or skipped on its own (an unmarked box can still block Send).
    if (f.kind === 'checkbox' && answer == null && /\b(accept|agree|consent)\b.{0,60}\b(privacy|terms|policy|data processing)\b/i.test(f.label)) { miss(f, 'consent'); continue; }
    // A status question (citizen, green card, EAD, H-1B codes) is not the yes/no work
    // authorization answer: it is asked ("Yes" once went into a "Select 1-4" field).
    if (source === 'work_authorization' && /\b(citizen|green card|ead|h-?1b)\b/i.test(f.label) && !(f.options || []).some((o) => /^yes$/i.test(o))) {
      if (!nonEmpty(f.value) || f.required) miss(f, 'status-question');
      continue;
    }
    if (answer == null) {
      // A value LinkedIn prefilled from an earlier application is not an answer the operator gave:
      // a screening question with no bank answer is asked, never passed through (a review page
      // once showed "<a cloud stack>: 3", a stack the applicant does not claim).
      if (nonEmpty(f.value) && (NUMERIC_LABEL.test(f.label) || /\?\s*\*?\s*$/.test(f.label))) miss(f, 'prefilled-unvetted');
      else if (!nonEmpty(f.value) && f.required) miss(f, 'no-answer');
      // An optional open question is answered too, lean and grounded in the claim bank, never left
      // blank. The run stops so the answer can be drafted.
      else if (!nonEmpty(f.value) && openQuestion(f)) miss(f, 'optional-text');
      continue;
    }
    if (f.kind === 'select' || f.kind === 'radio') {
      // A dropdown that lists its options only when opened (react-widgets on Paylocity; an
      // input-less menu on Rippling): the runner opens it and picks the answer then. An EEO
      // answer carries its label, so the option is chosen by eeoPick once the list is read.
      if (f.widget && !(f.options || []).length) {
        // A react-select v1 list also holds the answer when it shows its loose match ("Masters"), or
        // its Other entry with the answer in the box beside it.
        const rs = f.widget === 'react-select';
        // Several values ("Computer Science | Mathematics") for a list drawn as one row per value (a
        // "Field of Study (Max 2)" list, rows sharing rs_group): one pick on the first row carries them
        // all and adds the rows it needs. The other rows are covered by it. Held when the rows show
        // exactly those values.
        const many = rs ? listValues(answer) : [];
        if (many.length > 1) {
          const rows = f.rs_group ? fields.filter((g) => g.widget === 'react-select' && g.rs_group === f.rs_group) : [f];
          if (rows[0] !== f) { covered.push(f.key); continue; }
          const shown = rows.map((g) => g.value).filter((v) => nonEmpty(v));
          const holds = shown.length === many.length && many.every((v) => shown.some((x) => sameChoice(x, v, country) || !!listChoice([x], v)));
          if (!holds) actions.push({ key: f.key, action: 'pick', value: answer, values: many, source, ...(f.required ? {} : { optional: true }) });
          continue;
        }
        const held = sameChoice(f.value, answer, country) || (rs && (!!listChoice(f.value ? [f.value] : [], answer)
          || (!!otherOption([f.value]) && sameValue(f.other_text, answer))));
        if (!held) actions.push({ key: f.key, action: 'pick', value: answer, source, ...(source === 'eeo' ? { eeo: f.label } : {}), ...(rs && !f.required ? { optional: true } : {}) });
        continue;
      }
      // A checkbox group answered with several values ("Docker | Kubernetes"): one action that ticks
      // exactly those. A value the group does not list asks the field, nothing is half-ticked.
      const several = f.kind === 'radio' && f.checkboxes && source !== 'eeo' ? listValues(answer) : [];
      if (several.length > 1) {
        const picks = several.map((v) => pickChoice(f.options, v, country));
        if (picks.some((x) => !x)) { if (f.required) miss(f, 'no-matching-option'); continue; }
        const shown = listValues(f.value);
        if (shown.length === picks.length && picks.every((x) => shown.includes(x))) continue;
        actions.push({ key: f.key, action: 'radio', value: picks.join(' | '), values: picks, source });
        continue;
      }
      const opt = source === 'eeo' ? eeoPick(f.options, f.label, bank.eeo ?? 'decline')
        : pickChoice(f.options, answer, country);
      // Some forms (Gem) render each radio option of one question as its own field: the sibling with
      // the same label that holds the answer is picked, so this one is no error.
      const sibling = !opt && f.kind === 'radio' && source !== 'eeo' && fields.some((g) => g !== f && g.kind === 'radio' && normLabel(g.label) === normLabel(f.label) && pickChoice(g.options, answer, country));
      if (!opt && sibling) { covered.push(f.key); continue; }
      if (!opt) { if (f.required) miss(f, 'no-matching-option'); continue; }
      if (sameValue(f.value, opt, source)) continue;
      // A dropdown widget whose options the runner read by opening it (Rippling menus) takes a pick.
      actions.push({ key: f.key, action: f.widget ? 'pick' : f.kind, value: opt, source });
      continue;
    }
    if (f.kind === 'checkbox') {
      actions.push({ key: f.key, action: /^(yes|true|on|1)$/i.test(answer) ? 'check' : 'uncheck', value: null, source });
      continue;
    }
    if (source === 'eeo') {
      const cat = eeoCategory(f.label);
      const want = eeoAnswer(bank.eeo, cat);
      const value = want === 'decline' ? 'decline' : f.combobox ? eeoProbe(cat, bank.eeo) : want;
      actions.push({ key: f.key, action: 'fill', value, source, ...(f.combobox ? { eeo: f.label } : {}) });
      continue;
    }
    // A date picker (Ashby react-datepicker: "Immediately" typed into it left it empty) takes a
    // date: "Immediately" (ASAP, now) becomes today. Any other answer must be a date.
    if (f.kind === 'date') {
      const v = /^(immediately|asap|now|right away)$/i.test(answer.trim()) ? todayDate(ctx.today, country) : answer.trim();
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(v)) { if (f.required) miss(f, 'not-a-date'); continue; }
      if (sameValue(f.value, v, source)) continue;
      actions.push({ key: f.key, action: 'fill', value: v, source, date: true });
      continue;
    }
    // "Immediately" asked as a count of days or weeks is 0 ("Notice period in days?" got the word
    // and LinkedIn answered "Invalid input").
    if (source === 'start_date' && /\b(days?|weeks?)\b/i.test(f.label) && /^(immediately|asap|now|right away)$/i.test(answer.trim())) {
      if (!sameValue(f.value, '0', source)) actions.push({ key: f.key, action: 'fill', value: '0', source });
      continue;
    }
    const numeric = f.kind === 'number' || NUMERIC_LABEL.test(f.label);
    const value = numeric ? (answer.match(/\d+(\.\d+)?/) || [null])[0] : answer;
    if (value == null) { if (f.required) miss(f, 'not-numeric'); continue; }
    const typed = f.combobox ? comboValue(value) : value;
    if (sameValue(f.value, typed, source)) continue;
    actions.push({ key: f.key, action: 'fill', value: typed, source, ...(f.required ? {} : { optional: true }) });
  }
  // Checkboxes sharing a name are one question (Greenhouse "Location Preference *": every box
  // carries required="", and the boxes left unticked beside the chosen one stopped the run). A
  // required group is answered by any box ticked or planned ticked. Else it is asked once, by its
  // label, unless a job or learned answer to that label names a box (a bank fact never does:
  // "Location" is a city).
  const groups = new Map();
  for (const f of fields) if (f.kind === 'checkbox' && f.group) groups.set(f.group, [...(groups.get(f.group) || []), f]);
  for (const boxes of groups.values()) {
    if (boxes.length < 2) continue;
    const keys = new Set(boxes.map((b) => b.key));
    const at = missing.findIndex((m) => keys.has(m.key) && m.reason === 'no-answer');
    for (let i = missing.length - 1; i >= 0; i--) if (keys.has(missing[i].key) && missing[i].reason === 'no-answer') missing.splice(i, 1);
    const planned = (b, action) => actions.some((a) => a.key === b.key && a.action === action);
    if (!boxes.some((b) => b.required) || boxes.some((b) => planned(b, 'check') || (nonEmpty(b.value) && !planned(b, 'uncheck')))) continue;
    const q = { ...boxes[0], id: '', kind: 'radio', label: boxes[0].group_label || boxes[0].group, options: boxes.map((b) => b.label) };
    if (isAiApplicantQuestion(q.label)) { missing.push({ key: q.key, label: q.label, kind: 'checkbox', options: q.options, reason: 'ai-applicant-question' }); continue; }
    const got = answerFor(q, bank, ctx);
    const own = ['job', 'learned'].includes(got.source) && got.answer;
    const box = own ? boxes.find((b) => b.label === pickChoice(q.options, got.answer, country)) : null;
    if (box) { actions.push({ key: box.key, action: 'check', value: null, source: got.source }); continue; }
    const m = { key: q.key, label: q.label, kind: 'checkbox', options: q.options, reason: own ? 'no-matching-option' : 'no-answer' };
    if (at >= 0) missing.splice(Math.min(at, missing.length), 0, m); else missing.push(m);
  }
  return { actions, missing, covered };
}

// Resume picker: a radio group of earlier uploads. Status none (no picker on this step),
// ok (the approved CV is selected), select (listed, not selected), missing (not listed:
// the upload failed, so stop rather than send an old resume).
const DOC = /\.(pdf|docx?)\b|\bresume\b|\bcv\b/i;
export function resumeChoice(fields, cvName) {
  const base = String(cvName || '').toLowerCase().replace(/\.(pdf|docx?)$/, '');
  const radios = fields.filter((f) => f.kind === 'radio');
  // A Yes/No question that mentions the resume ("all information ... in my resume is truthful")
  // is a question, not a list of uploads.
  const yesNo = (f) => f.options.length > 0 && f.options.every((o) => /^(yes|no)$/i.test(String(o).trim()));
  const group = radios.find((f) => f.options.some((o) => o.toLowerCase().includes(base)))
    || radios.find((f) => !yesNo(f) && (/resume|cv/i.test(f.label) || f.options.some((o) => DOC.test(o))));
  if (!group) return { status: 'none' };
  const option = group.options.find((o) => o.toLowerCase().includes(base));
  if (!option) return { status: 'missing', key: group.key };
  return { status: group.value === option ? 'ok' : 'select', key: group.key, option };
}

// Hard guard run right before Submit: a ticked Follow box means stop. Following a company is
// never done (a standing rule), and Easy Apply ticks it by default.
export function followBoxesChecked(fields) {
  return fields.filter((f) => f.kind === 'checkbox' && /\bfollow\b/i.test(f.label) && nonEmpty(f.value));
}

// The same guard for Dice: a ticked follow, subscribe, newsletter, job-alert or marketing
// opt-in is unticked once, and a submit never happens while one stays ticked.
export function optInBoxesChecked(fields) {
  return fields.filter((f) => f.kind === 'checkbox' && /\bfollow\b|subscribe|newsletter|marketing|job alerts?|similar jobs|email me|text me|sms/i.test(f.label) && nonEmpty(f.value));
}

export function detectAts(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (/(^|\.)greenhouse\.io$/.test(host)) return 'greenhouse';
  if (host === 'jobs.lever.co') return 'lever';
  if (host === 'jobs.ashbyhq.com') return 'ashby';
  if (/myworkdayjobs\.com$|(^|\.)workday\.com$/.test(host)) return 'workday';
  // Appcast hosts the apply form itself for many staffing firms.
  if (host === 'apply.appcast.io') return 'appcast';
  // Paylocity's hosted careers pages: a guest application form.
  if (host === 'recruiting.paylocity.com') return 'paylocity';
  // Paycor Recruiting (Newton): a guest flow, EEO notice and self-ID screens, then the form.
  if (host === 'recruitingbypaycor.com') return 'paycor';
  // Workable's hosted boards: the job page links to its guest form at /apply/.
  if (host === 'apply.workable.com') return 'workable';
  // Rippling ATS: one host for every employer's board.
  if (host === 'ats.rippling.com') return 'rippling';
  // Walmart's own careers site (Walmart, Sam's Club and VIZIO roles): its Next.js app holds the
  // whole application, no Workday behind it.
  if (host === 'careers.walmart.com') return 'walmart';
  // iCIMS: every employer portal is a subdomain; the marketing site is not one.
  if (/(^|\.)icims\.com$/.test(host) && !/^(www\.)?icims\.com$/.test(host)) return 'icims';
  return null;
}

// Rippling's job page applies through a button that routes to <board>/jobs/<uuid>/apply in the
// page, query kept (its Next.js bundle). An apply URL, or anything else, stays as is.
export function ripplingApplyUrl(url) {
  try {
    const u = new URL(url);
    if (!/^\/[^/]+\/jobs\/[0-9a-f-]{36}\/?$/i.test(u.pathname)) return url;
    u.pathname = `${u.pathname.replace(/\/$/, '')}/apply`;
    return u.toString();
  } catch { return url; }
}

// Paylocity lists a job on /Recruiting/Jobs/Details/<id>; its form is /Recruiting/Jobs/Apply/<id>.
export function paylocityApplyUrl(url) {
  return String(url).replace(/\/Recruiting\/Jobs\/Details\/(\d+)/i, '/Recruiting/Jobs/Apply/$1');
}

// Paylocity work history: the resume parser decides the entries and their order, so per-entry
// answers are keyed by the company name each entry shows, then mapped to that entry's address field
// ids. Entries to delete come back highest index first, so deleting one never shifts the next.
const WH_COMPANY = /^workHistory\.companyName\.(\d+)$/;
export function entryAnswers(fields, byEntry) {
  const out = {};
  if (!byEntry) return out;
  for (const f of fields || []) {
    const m = WH_COMPANY.exec(f.id || '');
    const answers = m && byEntry[String(f.value || '').trim()];
    if (answers) for (const [k, v] of Object.entries(answers)) out[`#public-candidate-work-history-address-${m[1]}-${k}`] = v;
  }
  return out;
}
// What a look-again after a fill fills: actions not done yet, plus the ones the last fill skipped
// because their element had re-rendered (`skipped`, by tag). Refilling the whole plan sent the CV
// twice (each Paylocity upload re-parses the resume and dropped work-history entries), then timed
// out on a date field already filled. A file already uploaded never goes again.
export function rescanActions(actions, { done, tag, skipped = new Set() }) {
  return (actions || []).filter((x) => !(x.action === 'file' && done.has(`file:${x.value}`)) && (!done.has(tag(x)) || skipped.has(tag(x))));
}
// A resume parse fills the form in the background (Paylocity: a fill made before it landed was
// wiped, and only one of the parsed work-history entries existed yet). Settled = the same fields
// with the same values on the last three looks.
const fingerprint = (snap) => (snap?.fields || []).map((f) => `${f.id || f.label}=${f.value ?? ''}`).join('\n');
// `ready` (optional) must also hold on the last look: a form still before the parse has started is
// not settled (three matching looks can come before any work history exists).
export function formSettled(snaps, { ready } = {}) {
  if (!snaps || snaps.length < 3) return false;
  if (ready && !ready(snaps.at(-1))) return false;
  const last = snaps.slice(-3).map(fingerprint);
  return last.every((x) => x === last[0]);
}
// A file goes up once per run (a page that re-rendered after Next looked like a new step, and the
// CV went up again at the next steps, each upload starting a new parse).
export function notUploaded(actions, uploaded) {
  return (actions || []).filter((x) => !(x.action === 'file' && uploaded.has(x.value)));
}
export function entriesNotKept(fields, keep) {
  const ok = new Set((keep || []).map((n) => n.trim()));
  if (!ok.size) return [];
  return (fields || []).map((f) => [WH_COMPANY.exec(f.id || ''), String(f.value || '').trim()]).filter(([m, v]) => m && !ok.has(v)).map(([m]) => Number(m[1])).sort((a, b) => b - a);
}
export function entriesToRemove(fields, names) {
  const drop = new Set((names || []).map((n) => n.trim()));
  return (fields || []).map((f) => [WH_COMPANY.exec(f.id || ''), String(f.value || '').trim()]).filter(([m, v]) => m && drop.has(v)).map(([m]) => Number(m[1])).sort((a, b) => b - a);
}

// Paylocity's State select lists names ("California") but shows the picked one as its code ("CA").
// Any other choice must read back as the answer itself.
const US_STATES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' };

// Country names that select lists spell differently (one Paylocity list says "RUSSIAN FEDERATION",
// another "Russia").
const COUNTRY_ALIASES = {
  'russian federation': ['Russia'], russia: ['Russian Federation'],
  // Phenom lists "United States of America" and "United States of America (+1)".
  'united states': ['United States of America', 'USA'], 'united states (+1)': ['United States of America (+1)', 'USA (+1)'],
  'united kingdom': ['UK', 'Great Britain'], uk: ['United Kingdom'],
};

// The texts to try in a select, in order: the answer, then (US applicant only) a US state's code
// (Paylocity's State list is labelled "CA"; "California" found no results), then country aliases.
export function choiceAliases(answer, country = homeCountry()) {
  const key = String(answer || '').trim().toLowerCase();
  const code = isUS(country) ? US_STATES[key] : null;
  return [answer, ...(code ? [code] : []), ...(COUNTRY_ALIASES[key] || [])];
}

// The option an answer picks: an exact match on the answer or any alias first, then pickOption's
// prefix match ("United States" must pick "United States of America", never "United States Minor
// Outlying Islands", which a prefix match on the answer alone would take).
export function pickChoice(options, answer, country = homeCountry()) {
  const aliases = choiceAliases(answer, country);
  const al = aliases.map((x) => optKey(x));
  const opts = (options || []).filter((o) => o && !PLACEHOLDER.test(o.replace(ZW, '').trim()));
  return opts.find((o) => al.includes(optKey(o))) || aliases.map((x) => pickOption(options, x)).find(Boolean) || null;
}

export function sameChoice(shown, answer, country = homeCountry()) {
  const s = String(shown || '').trim().toLowerCase();
  const a = String(answer || '').trim().toLowerCase();
  if (!s) return false;
  return choiceAliases(a, country).some((x) => String(x).toLowerCase() === s);
}

// After Submit, read the page until `done(text)` holds or the tries run out; returns the last text.
// A fixed wait caught Dice's Submit spinner before its confirmation rendered.
export async function pollText(read, done, { tries = 6, waitMs = 5000 } = {}) {
  let text = '';
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, waitMs));
    text = await read();
    if (done(text)) break;
  }
  return text;
}

// A careers page that embeds Greenhouse by script (gh_jid in the URL, the board name in the
// script's ?for=) resolves to Greenhouse's embed form. Not the board's job page: a board with a
// custom careers domain redirects that back to the employer's page.
export function greenhouseFromGhJid(url, scriptSrcs = []) {
  let jid = null;
  try { jid = new URL(url).searchParams.get('gh_jid'); } catch { return null; }
  if (!jid || !/^\d+$/.test(jid)) return null;
  for (const src of scriptSrcs) {
    try {
      const u = new URL(src);
      if (/(^|\.)greenhouse\.io$/.test(u.hostname) && u.searchParams.get('for')) return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(u.searchParams.get('for'))}&token=${jid}`;
    } catch { /* not a URL */ }
  }
  return null;
}

// A careers page that carries Ashby's job id (?ashby_jid=<uuid>) but no form of its own (its
// /careers can redirect elsewhere): the Ashby application under the company's slug.
// The slug is the company name lowercased with suffixes and punctuation dropped; a wrong slug
// lands on an Ashby 404 with no form, and the run stops there.
export function ashbyFromJid(url, company) {
  let jid = null;
  try { jid = new URL(url).searchParams.get('ashby_jid'); } catch { return null; }
  if (!jid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jid)) return null;
  const slug = String(company || '').toLowerCase().replace(/\b(inc|llc|ltd|corp|co|gmbh)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
  if (!slug) return null;
  return `https://jobs.ashbyhq.com/${slug}/${jid}/application`;
}

// Greenhouse's email security code: after Submit the page asks for an 8-character code it mailed
// to the applicant. Reading it from the applicant's inbox is allowed; the mail is only read, never
// opened through a link.
export const codeRequestIn = (text) => /verification code was sent to|enter the \d+-character code/i.test(text || '');
// A mailed code that did not read back from the boxes, described without quoting either string
// (codes are never recorded): the two lengths, the 1-based positions that differ, and whether the
// difference is letter case only.
export function codeMismatch(want, got) {
  const a = String(want || ''), b = String(got || '');
  if (a === b) return null;
  const at = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) at.push(i + 1);
  return { want: a.length, got: b.length, at, caseOnly: a.length === b.length && a.toLowerCase() === b.toLowerCase() };
}

export function securityCodeIn(mailText) {
  const m = /security code field on your application:\s*([A-Za-z0-9]{6,10})\b/i.exec(mailText || '');
  return m ? m[1] : null;
}

// Paycor embedded on an employer's page posts Apply back to the parent site named in parentUrl.
// Without it, the job page is Paycor's own guest flow.
export function paycorStandaloneUrl(url) {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('parentUrl')) return url;
    u.searchParams.delete('parentUrl');
    return u.toString();
  } catch { return url; }
}

// Rippling parses an uploaded résumé and merges what it read over the form's values (its bundle),
// so a value typed before the parse lands can be overwritten. Its notices say where the parse is:
// 'parsing', 'done', or null (no notice).
export function resumeParseState(text) {
  const t = String(text || '');
  if (/r[ée]sum[ée] parsing was successful/i.test(t)) return 'done';
  if (/parsing the r[ée]sum[ée]/i.test(t)) return 'parsing';
  // Walmart (its bundle): "Uploading Resume..." then "Parsing Resume...", gone when done.
  if (/(uploading|parsing) r[ée]sum[ée]\.\.\./i.test(t)) return 'parsing';
  return null;
}

// The company-site URL the job's last run reached (its result.json `ats_url`; the run's dir is
// state's application.attempts[-1].dir). A re-run starts there and spends no LinkedIn page load to
// find it again. Only the last attempt counts, and a LinkedIn or Dice page is no start.
// `readResult(dir)` returns that run's parsed result.json, or throws.
export function recordedAtsUrl(application, readResult) {
  const last = (application?.attempts || []).at(-1);
  if (!last?.dir) return null;
  let url = null;
  try { url = readResult(last.dir)?.ats_url || null; } catch { return null; }
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || /(^|\.)(linkedin|dice)\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

// A company site with its own application form is a channel per host, "site:<host>": dry runs
// always, real submits only once the operator verifies that host.
export function siteChannel(url) {
  try { return `site:${new URL(url).hostname.toLowerCase().replace(/^www\./, '')}`; } catch { return null; }
}

// The button that moves an ATS form to its next page (Paylocity says "Next Step").
export const NEXT_STEP = /^(continue|next|next step|review|save (and|&) continue)$/i;
// The final button of a one-page form. Gem offers "Apply and save", which makes a Gem account, and
// "Apply without saving": only the second is ever pressed.
const SUBMIT_EXACT = /^(submit|submit application|apply|send application|apply without saving)$/i;
// A button label read from innerText can carry CSS text-transform (an Ashby board shows "SUBMIT
// APPLICATION" for an accessible name "Submit Application"), so the role lookup matches the whole
// name in any letter case.
export function buttonNameRe(name) {
  const esc = String(name || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`^\\s*${esc}\\s*$`, 'i');
}

// A site whose final button is not called Submit ("Finish") names it in config/apply.json
// submit_labels: { "<channel>": ["<exact button text>", ...] }, added once that channel's own page
// confirmed it. `labels` is that map. A label is matched whole, in any letter case, and only for its
// own channel, and only when no Submit button is shown.
export function submitLabel(buttons, channel = null, labels = {}) {
  const list = (buttons || []).filter((b) => !/\bapply and save\b/i.test(b));
  const own = channel && labels && Object.prototype.hasOwnProperty.call(labels, channel) ? labels[channel] : null;
  const wants = (Array.isArray(own) ? own : own ? [own] : []).map((w) => String(w || '').trim()).filter(Boolean);
  return list.find((b) => SUBMIT_EXACT.test(b)) || list.find((b) => /submit/i.test(b))
    || (wants.length ? list.find((b) => wants.some((w) => buttonNameRe(w).test(b))) : undefined);
}

// A page is a job application only when it asks who you are: a name field or a CV upload.
// A lone email box is a talent-network or job-alert signup (the runner once filled "Join our
// talent network" and called the dry run complete).
export function applicationForm(fields) {
  const list = fields || [];
  const named = list.some((f) => /\b(first|last|full|legal|given|family)\s*name\b|^name\*?$/i.test(String(f.label || '').trim()));
  const upload = list.some((f) => f.kind === 'file');
  return named || upload;
}

// "Application received." counts only at the start of a line (a company form's own confirmation), so
// a job page's "every application received" does not.
export function confirmationIn(text) {
  return /application (was )?sent|your application (was|has been) (successfully )?(submitted|received)|application submitted|thank(s| you) for applying|thank you for taking the time to apply|your application for [^\n]{1,160}? has been (successfully )?(submitted|received)|we('ve| have) received your application|you('ve| have) (successfully )?applied|successfully applied|your application is on its way|thank(s| you) for submitting|thank(s| you) for your application|view more jobs at [^\n]+\s+back to job post|(^|\n)\s*application received[.!]/i.test(text || '');
}

// Bot checks on company sites and job-ad redirectors (appcast "Verification Required ... Slide
// right to secure your access"), plus the common CAPTCHA widgets. The runner never solves one: in
// a headed run it waits for the operator to solve it.
export function challengeIn({ text = '', title = '', frames = [] } = {}) {
  // A "This site is protected by reCAPTCHA" footer is a notice, not a challenge (the runner once
  // waited 10 minutes for a check that was never shown). iCIMS shows "Protected by hCaptcha
  // Privacy | Terms" on its login page.
  const t = `${title}\n${text}`.slice(0, 4000).replace(/(this (site|page|form) is )?protected by (re|h)captcha[^.\n]*\.?/gi, ' ');
  if (/verification required|verify (that )?you are (a )?human|are you a robot|slide (right )?to (secure|verify|continue)|press (&|and) hold|unusual (activity|traffic)|just a moment|attention required|captcha/i.test(t)) return true;
  // Invisible reCAPTCHA always keeps a hidden bframe next to its size=invisible anchor: not a
  // challenge on its own (Ashby).
  // Frames come as URLs, or as { src, visible } from a page snapshot. A frame known to be hidden is
  // not a challenge: Lever keeps hCaptcha's checkbox-invisible and challenge frames hidden on every
  // form (two 10-minute waits on a plain form).
  // A bframe known to be visible is the image challenge itself, invisible anchor or not (Ashby:
  // "Select all images with crosswalks" over the form after Submit).
  const shown = frames.map((f) => (typeof f === 'string' ? { src: f } : f || {}))
    .filter((f) => f.visible !== false && !/hcaptcha\.com.*frame=checkbox-invisible/i.test(f.src || ''));
  const invisible = frames.some((f) => { const src = typeof f === 'string' ? f : f?.src; return /recaptcha/i.test(src || '') && /size=invisible/i.test(src || ''); });
  return shown.some(({ src = '', visible }) => /hcaptcha\.com|challenges\.cloudflare\.com|turnstile|captcha-delivery\.com|px-captcha|perimeterx/i.test(src) || ((visible === true || !invisible) && /recaptcha\/.*\/bframe/i.test(src)));
}

// Job-ad redirectors and click trackers between a job board and the employer's site.
// apply.appcast.io is a form site (detectAts 'appcast'), not a redirect.
export const REDIRECT_HOST = /(^click\.appcast\.io|(^|\.)(clickcast\.cloud|joveo\.com|jobadx\.com|recruitics\.com))$/i;

// Pre-submit blockers that hand the application to the operator. Invisible reCAPTCHA (Greenhouse
// loads it on most forms) is not a blocker; a visible challenge is.
// Frames come as URLs, or as { src, visible } (the iCIMS form loop): a frame known to be hidden is
// no blocker, so iCIMS's invisible hCaptcha does not stop every page.
export function blockerIn({ hasPassword, frames }) {
  if (hasPassword) return 'account-required';
  const srcs = (frames || []).map((f) => (typeof f === 'string' ? f : f?.src || ''));
  const invisible = srcs.some((src) => /recaptcha/i.test(src) && /size=invisible/i.test(src));
  for (const src of (frames || []).filter((f) => typeof f === 'string' || f?.visible !== false).map((f) => (typeof f === 'string' ? f : f?.src || ''))) {
    if (/hcaptcha\.com|challenges\.cloudflare\.com|turnstile/i.test(src)) return 'captcha';
    if (/recaptcha/i.test(src) && (/size=normal/i.test(src) || (!invisible && /\/bframe/i.test(src)))) return 'captcha';
  }
  return null;
}

export function validateAnswers(bank) {
  const empty = [];
  for (const section of ['profile', 'facts']) {
    for (const [k, v] of Object.entries(bank?.[section] || {})) if (k[0] !== '_' && !nonEmpty(v)) empty.push(`${section}.${k}`);
  }
  return { empty };
}

export function learnAnswer(bank, label, answer, source) {
  if (isAiApplicantQuestion(label)) throw new Error('an AI-applicant question is never learned: the operator submits that role by hand');
  const n = normLabel(label);
  bank.learned = (bank.learned || []).filter((l) => l.label !== n);
  bank.learned.push({ label: n, answer: String(answer), source });
  return bank;
}

// What a Submit came to, when the page shows no confirmation (a form that stayed with "School is
// required." was once reported submit-unverified, though nothing was sent). Required-field errors
// on a form still there mean the site refused it before sending.
// A bot check over the form after Submit holds it unsent: a headed run waits for the operator
// ('wait', cleared still null); headless, or not cleared in time, is 'manual'.
export function afterSubmit({ confirmed, errors = [], formStill = false, challenged = false, headed = false, cleared = null }) {
  if (confirmed) return 'submitted';
  if (challenged && !cleared) return headed && cleared === null ? 'wait' : 'manual';
  if (formStill && errors.length) return 'rejected';
  return 'unverified';
}

// The page did not move after Next. A bot check shown over it (an iCIMS hCaptcha after Next) is not a
// stuck form: a headed run waits for the operator, then takes the step again; headless or unsolved,
// the role goes to the user by hand. Nothing was sent either way.
export function afterStuck({ challenged = false, headed = false, cleared = null }) {
  if (!challenged) return 'stuck';
  if (cleared === true) return 'retry';
  return headed && cleared === null ? 'wait' : 'manual';
}

// After a solved bot check the site may still be submitting the step (iCIMS: the Next button goes
// blank while the page text already changed). Retake the step only once a labelled button is back.
export function settledAfterChallenge(beforeText, snap) {
  if (!snap) return false;
  return (snap.buttons || []).some((b) => String(b).trim());
}

// Which typeahead suggestion an answer picks: exact text first (case-insensitive), then the first
// that contains it. A substring match alone put "Other" on "Christian Brothers University"
// (Greenhouse school list). -1 when none fits.
export function typeaheadIndex(texts, value) {
  const want = String(value || '').trim().toLowerCase();
  const t = (texts || []).map((x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase());
  const exact = t.indexOf(want);
  return exact >= 0 ? exact : t.findIndex((x) => x.includes(want));
}

// The reason line for a step that did not advance, shared by the Easy Apply and company-site paths
// (the Easy Apply path once referenced site-only variables and crashed).
export function stuckReason({ clickErr = null, failed = [] } = {}) {
  return ['stuck', clickErr ? `Next click: ${clickErr}` : null, failed.length ? `failed requests: ${[...new Set(failed)].slice(0, 6).join(', ')}` : null].filter(Boolean).join('; ');
}

// Page alerts after Next (watchDialogs, apply-click.mjs) as needs_answers entries: Phenom answers a refused Next with
// window.alert() ("Resume Import is mandatory, ..."), which Playwright would dismiss unseen. The message is the label,
// so the run says why the page did not move. One entry per distinct message.
export function alertDetail(alerts) {
  const seen = new Set();
  const out = [];
  for (const a of alerts || []) {
    const m = String(a?.message || '').replace(/\s+/g, ' ').trim();
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push({ key: null, label: m, kind: 'alert', options: [], reason: 'alert: the page answered Next with this message (dismissed)' });
  }
  return out;
}

// A combobox holds an option, not a sentence ("Yes, 25 years." typed into a Yes/No react-select
// filtered the list to nothing and nothing was picked).
// An answer that opens with "Yes," or "No." types only that word. Anything else is typed as
// written, and a sentence with no matching option then stops the run (comboOutcome).
export function comboValue(answer) {
  const m = String(answer ?? '').match(/^\s*(yes|no)\s*[,.;:!]/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : String(answer ?? '');
}

// What the runner does after typing into a combobox: 'pick' the matching option, take the 'first'
// suggestion (places only), 'keep-typed' (a street address), 'skip' (a lenient EEO probe), or 'fail'.
// No match is a failure even when typing filtered the list to nothing (that case used to pass
// silently and the site refused the form).
export function comboOutcome({ matched, visible = 0, fallback = false, freeAddress = false, lenient = false, optional = false }) {
  if (matched) return 'pick';
  if (freeAddress) return 'keep-typed';
  if (fallback && visible > 0) return 'first';
  if (lenient) return 'skip';
  // An optional typeahead with no matching option is cleared and left blank (an optional
  // Greenhouse "School" list may not list the applicant's school). A required one still stops.
  if (optional) return 'clear';
  return 'fail';
}

// ---------- Workday (myworkdayjobs.com) ----------
// Which step a Workday page is on, from workdayPage() (apply-dom.mjs): 'job' (the posting, Apply),
// 'start' (the "Start Your Application" dialog), 'auth-choice' (Apple / Google / email buttons),
// 'create-account', 'sign-in', 'verify-email', 'wizard' (a progress-bar step), 'review', 'submitted',
// 'already-applied', 'closed' (the posting is gone), or 'loading' (nothing recognizable yet).
const WD_VERIFY = /verif(y|ication)(?! new password)[^.]{0,80}\b(email|e-mail|account)\b|\b(email|account)[^.]{0,40}\bnot (yet )?(been )?verified|check your (email|inbox)|activate your account/i;
// Workday's own error page (seen right after sign-in): "Something went wrong. Please refresh the
// page and then try again." and "Error Code: VPS|<id>", drawn under the progress bar in place of the
// step's form. The runner reloads it once per run and goes on from the step it lands on; seen again
// after that reload, the run stops. Returns {code (the part before "|", "?" when none shows), reload,
// detail when it stops}, or null on any other page. `reloads`: reloads this run already made.
export function workdayError(p, reloads = 0) {
  const text = String(p?.text || '');
  if (!/something went wrong/i.test(text) || !/refresh the page|error code/i.test(text)) return null;
  const m = /error code:?\s*([a-z0-9]+)/i.exec(text);
  const code = m ? m[1].toUpperCase() : '?';
  return reloads < 1 ? { code, reload: true } : { code, reload: false, detail: `Workday error page (${code}) after one reload` };
}
export function workdayStage(p) {
  const ids = new Set(p?.ids || []);
  const text = String(p?.text || '');
  if (/(already|previously) applied (for|to) this (job|position|posting)|you('ve| have) already applied/i.test(text)) return 'already-applied';
  if (/application (was |has been )?submitted|thank you for applying|your application has been received/i.test(text) && !ids.has('progressBar')) return 'submitted';
  // A removed posting (the job page answers "The page you are looking for doesn't exist.").
  if (/the page you are looking for (doesn.t|does not) exist|(job|posting|position) is no longer (available|accepting applications)|no longer accepting applications/i.test(text) && !ids.has('progressBar')) return 'closed';
  if (workdayError(p)) return 'error';
  if ((p?.startOptions || []).length) return 'start';
  // The account form says "Verify New Password": it is the form, not a verification notice.
  if (ids.has('verifyPassword')) return 'create-account';
  if (ids.has('signInContent') && WD_VERIFY.test(text)) return 'verify-email';
  if (ids.has('signInSubmitButton') || (ids.has('email') && ids.has('password'))) return 'sign-in';
  if (ids.has('SignInWithEmailButton')) return 'auth-choice';
  if (WD_VERIFY.test(text) && !p?.step) return 'verify-email';
  if (p?.step && !/create account|sign in/i.test(p.step.label)) return /^review\b/i.test(p.step.label) ? 'review' : 'wizard';
  if (ids.has('adventureButton')) return 'job';
  return 'loading';
}

// The start dialog's option the runner takes: Apply Manually only. Autofill with Resume parses the CV
// into work-history entries no one vetted; Use My Last Application reuses another application's
// answers; Apply with LinkedIn or SEEK hands the profile to a third party.
export function workdayStartChoice(options) {
  return (options || []).includes('applyManually') ? 'applyManually' : null;
}

// The account-verification link in a Workday mail: the first URL on the tenant's own host whose path
// activates or verifies. Opening exactly this link is allowed; every other link stays shut.
export function workdayVerifyLink(mailText, host) {
  for (const m of String(mailText || '').replace(/&amp;/g, '&').matchAll(/https:\/\/[^\s"'<>)\]]+/g)) {
    try {
      const u = new URL(m[0]);
      if (u.hostname.toLowerCase() === String(host).toLowerCase() && /\/(activate|verify|verification|confirm)/i.test(u.pathname)) return u.toString();
    } catch { /* not a URL */ }
  }
  return null;
}

// Work history for Workday's My Experience: the approved CV variant's roles, as the CV shows them
// (its title choice, the company, its context line), with MM/YYYY dates; "Present" is the current
// role. Year-only earlier roles stay in the uploaded CV: a month would be invented. With no variant,
// the main roles are the first `count` role keys of master.json (or `roleKeys` when given).
// Education comes from master.json, the degree split from its field ("Master's Degree, Physics").
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const monthYear = (s) => {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(String(s || '').trim());
  return m && MONTHS[m[1].toLowerCase()] ? `${MONTHS[m[1].toLowerCase()]}/${m[2]}` : null;
};
// Client roles worked through an employer (a role with "via": "<key>" in master.employers, shown on
// the CV as "Client (via Employer)") are one job on a form: the employer's name and its own dates,
// the first client role's title, and each client's context line ("Client: context") as the
// description. A variant's practice section is an entry too, after the experience.
export function workdayHistory(master, variant, { roleKeys = null, count = 3 } = {}) {
  const roles = master?.roles || {};
  const main = roleKeys || Object.keys(roles).slice(0, count);
  const exp = variant?.experience?.length ? variant.experience : main.filter((k) => roles[k]).map((role) => ({ role }));
  const entries = [...exp, ...(variant?.practice ? [variant.practice] : [])];
  const work = [];
  const merged = new Map();
  for (const e of entries) {
    const r = roles[e.role];
    if (!r) continue;
    const ctx = r.contexts?.[e.context || 'default']?.text || null;
    const emp = r.via ? master?.employers?.[r.via] : null;
    const clientLine = ctx ? `${r.company}: ${ctx}` : r.company;
    if (emp && merged.has(r.via)) {
      const seen = merged.get(r.via);
      seen.description = [seen.description, clientLine].filter(Boolean).join(' ');
      continue;
    }
    const [a, b] = String((emp || r).dates || '').split(/\s*[–—-]\s*/);
    const from = monthYear(a);
    const current = /^present$/i.test(String(b || '').trim());
    const to = current ? null : monthYear(b);
    if (!from || (!current && !to)) continue;
    const item = { title: (e.title && r.titles?.[e.title]?.text) || r.title, company: emp ? emp.name : r.company, from, to, current, description: emp ? clientLine : ctx };
    if (emp) merged.set(r.via, item);
    work.push(item);
  }
  const education = (master?.education || []).map((ed) => {
    const [degree, ...field] = String(ed.degree || '').split(/,\s*/);
    return { school: ed.school, degree, field: field.join(', ') || null, from: null, to: ed.year ? String(ed.year) : null };
  });
  return { work, education };
}
// The CV variant behind an approved CV file (<file prefix>-cv-<share>.pdf, cvFileBase in profile.mjs).
export function variantForCv(cvPath, variants) {
  const m = CV_FILE_RE.exec(String(cvPath || '').split(/[\\/]/).pop());
  return m ? (variants || []).find((v) => v.share && v.share === m[2]) || null : null;
}

// "Have you previously worked for <Company>?": No when nothing the operator's claims hold
// (employers, clients, CV text) names the company; any mention is asked, never answered.
export function previousWorkerAnswer(company, known) {
  const core = String(company || '').toLowerCase().replace(/[.,()]/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|group|holdings|the|gmbh|sa|ag)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (core.length < 3) return null;
  return String(known || '').toLowerCase().includes(core) ? null : 'No';
}

// Which entries to add on My Experience: one per work-history role and per degree the page lacks.
export function workdayAdds(sections, history) {
  const out = [];
  for (const s of sections || []) {
    const want = /work (experience|history)/i.test(s.name) ? (history?.work || []).length : /^education/i.test(s.name) ? (history?.education || []).length : 0;
    for (let i = s.entries; i < want; i++) out.push(s.name);
  }
  return out;
}

// A Workday page's plan. Entry fields (workExperience-<n>--<part>, education-<n>--<part>) are
// answered from the CV history by entry order; every other field goes through planFill, with two
// derived answers: "previously worked for <Company>?" (previousWorkerAnswer) and the disability
// form's date signed (today, in the widget's section order). A month/year or month/day/year date
// section is filled with action 'wd-date'.
const WD_PREVIOUS = /\b(previously|ever|formerly) (worked|been employed)\b|\bformer (employee|worker)\b|\bworked (for|at) .{1,80} before\b/i;
function entryValue(section, part, src) {
  const p = part.toLowerCase();
  if (section === 'workExperience') {
    if (p === 'jobtitle') return src.title;
    if (p === 'companyname' || p === 'company') return src.company;
    if (p === 'currentlyworkhere') return src.current ? 'Yes' : 'No';
    if (p === 'startdate') return src.from;
    if (p === 'enddate') return src.current ? null : src.to;
    if (p === 'roledescription') return { optionalOnly: src.description };
    return undefined;
  }
  if (section === 'education') {
    if (p === 'schoolname' || p === 'school') return src.school;
    if (p === 'degree') return src.degree;
    if (p === 'fieldofstudy') return src.field || undefined;
    if (p === 'lastyearattended') return src.to || undefined;
    if (p === 'firstyearattended') return src.from || undefined;
    return undefined;
  }
  return undefined;
}
export function workdayPlan(fields, bank, ctx, { history = { work: [], education: [] }, company = '', known = '' } = {}) {
  const country = bank?.profile?.country || '';
  const actions = [];
  const missing = [];
  const miss = (f, reason, label = f.label) => missing.push({ key: f.key, label, kind: f.kind, options: f.options || [], reason });
  const rest = [];
  for (const f of fields || []) {
    if (!f.entry) { rest.push(f); continue; }
    const { section, index, part } = f.entry;
    const src = section === 'workExperience' ? history.work?.[index] : section === 'education' ? history.education?.[index] : null;
    const where = `${section === 'workExperience' ? 'Work Experience' : section === 'education' ? 'Education' : section} ${index + 1}: ${f.label}`;
    const job = ctx.jobAnswers && Object.prototype.hasOwnProperty.call(ctx.jobAnswers, normLabel(where)) ? nonEmpty(ctx.jobAnswers[normLabel(where)]) : undefined;
    let want = job !== undefined ? job : src ? entryValue(section, f.entry.part, src) : undefined;
    // A role description is written only when the form requires one: the CV's context line.
    if (want && typeof want === 'object') want = f.required ? want.optionalOnly : null;
    if (want === null) continue;
    if (want === undefined) { if (f.required && !nonEmpty(f.value)) miss(f, 'no-answer', where); continue; }
    if (f.kind === 'checkbox') {
      const on = /^(yes|true|on|1)$/i.test(want);
      if (!!nonEmpty(f.value) !== on) actions.push({ key: f.key, action: on ? 'check' : 'uncheck', value: null, source: 'cv' });
      continue;
    }
    if (f.widget === 'wd-date') { if (f.value !== want) actions.push({ key: f.key, action: 'wd-date', value: want, source: 'cv' }); continue; }
    if (f.kind === 'select') {
      if ((f.options || []).length) {
        const opt = pickChoice(f.options, want, country);
        if (!opt) { if (f.required) miss(f, 'no-matching-option', where); continue; }
        if (!sameValue(f.value, opt)) actions.push({ key: f.key, action: 'pick', value: opt, source: 'cv' });
      } else if (!sameChoice(f.value, want, country)) actions.push({ key: f.key, action: 'pick', value: want, source: 'cv', ...(f.required ? {} : { optional: true }) });
      continue;
    }
    if (!sameValue(f.value, want)) actions.push({ key: f.key, action: 'fill', value: want, source: 'cv' });
  }
  // Derived answers, by element id; the operator's own job answers still win.
  const derived = {};
  for (const f of rest) {
    if (!f.id) continue;
    if (f.kind === 'radio' && (/candidateIsPreviousWorker/i.test(f.id) || WD_PREVIOUS.test(f.label))) {
      const a = previousWorkerAnswer(company, known);
      if (a && !(bank.learned || []).some((l) => l.label === normLabel(f.label))) derived[`#${f.id}`] = a;
    }
    if (f.widget === 'wd-date' && (/dateSignedOn/i.test(f.id) || /^date$/i.test(f.label))) derived[`#${f.id}`] = todayIn(f.format, ctx.today);
  }
  // The disability form's boxes ("Please check one of the boxes below") are the disability question.
  const asked = rest.map((f) => (f.kind === 'radio' && !/disab/i.test(f.label) && (/disabilityStatus/i.test(f.id || '') || (f.options || []).some((o) => /have a disability/i.test(o))) ? { ...f, label: `Disability status: ${f.label}` } : f));
  const p = planFill(asked, bank, { ...ctx, jobAnswers: { ...derived, ...(ctx.jobAnswers || {}) } });
  for (const a of p.actions) {
    const f = asked.find((g) => g.key === a.key);
    const own = f?.id && derived[`#${f.id}`] !== undefined && !(ctx.jobAnswers && Object.prototype.hasOwnProperty.call(ctx.jobAnswers, `#${f.id}`));
    const b = own ? { ...a, source: 'derived' } : a;
    actions.push(f?.widget === 'wd-date' ? { ...b, action: 'wd-date', date: undefined } : b);
  }
  for (const m of p.missing) missing.push({ ...m, label: fields.find((g) => g.key === m.key)?.label ?? m.label });
  return { actions, missing };
}

// ---------- Walmart (careers.walmart.com, channel walmart) ----------
// One Next.js app serves Walmart, Sam's Club and VIZIO roles. The job page's "Apply now" routes in
// the page to /jobs/apply. Without a session that is /jobs/contact-details: an email box and the
// site terms box, then a six-digit code mailed to that address (no password), then the questionnaire
// pages and a review page whose primary button submits (its bundles).
// Which step a page is on, from walmartPage() (apply-dom.mjs): 'job', 'contact', 'otp',
// 'questionnaire', 'submitted', 'already-applied', 'error', or 'loading'.
export function walmartStage(p) {
  const text = String(p?.text || '');
  let path = '';
  try { path = new URL(p?.url || '').pathname; } catch { /* keep empty */ }
  if (/\/jobs\/submitted\b/.test(path) || /application submitted!/i.test(text)) return 'submitted';
  if (/\/login-error\b/.test(path)) return 'error';
  if (/this renewal has already been submitted/i.test(text)) return 'already-applied';
  if ((p?.otp || 0) >= 6) return 'otp';
  if (p?.email && ((p.consent || []).length || /\/contact-details\b/.test(path))) return 'contact';
  if (p?.form) return 'questionnaire';
  if (/something went wrong|there was an error occurred while submitting|no questionnaire available/i.test(text)) return 'error';
  const apply = p?.apply || [];
  if (apply.some((b) => /^applied$/i.test(String(b.label).trim()))) return 'already-applied';
  if (apply.some((b) => /^apply now$/i.test(String(b.label).trim()) && !b.disabled)) return 'job';
  return 'loading';
}

// The button a questionnaire page moves on with. The questionnaire's actions are server-defined
// buttons with no test id (primary first, then Back); the review page (its "Edit" links per section)
// is the only place the primary button submits, so a Next-like label there is never pressed, and a
// label outside the known ones is no step at all: the run stops and lists them. Import buttons
// (LinkedIn, Indeed) and "Use my last application" are never taken. `jobs` is the cart's count when
// the review says "You are applying to <n>": a submit sends every job in it.
const WM_NEVER = /linkedin|indeed|last application|^back$|^previous$|^go back$|^cancel$|^exit$|save (and|&) exit|draft|^edit$|read more|hide more|show more|^remove\b|^replace\b|^add\b|upload|^help$|^close$/i;
export function walmartNav(buttons, text = '') {
  const list = (buttons || []).map((b) => String(b || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const t = String(text || '');
  const review = list.some((b) => /^edit$/i.test(b)) || /you are applying to \d|your selected positions|review your application/i.test(t);
  const usable = list.filter((b) => !WM_NEVER.test(b));
  const submit = review ? usable.find((b) => /submit/i.test(b)) || null : null;
  const next = review ? null : usable.find((b) => /^(next|continue|save (and|&) continue|next step|start( application)?|get started)$/i.test(b)) || null;
  const m = /you are applying to (\d+)/i.exec(t);
  return { review, submit, next, jobs: m ? Number(m[1]) : null };
}

// The six-digit code in Walmart's sign-in mail ("OTP_VERIFICATION_CODE_SENT"), only beside "code" or
// "passcode" wording, so an address, a zip or a date in the footer is never taken.
export function walmartOtpCode(mailText) {
  // CSS rules go first: Walmart's mail opens with font URLs full of six-digit runs.
  let t = String(mailText || '');
  for (let prev = ''; prev !== t;) { prev = t; t = t.replace(/[^{}]*\{[^{}]*\}/g, ' '); }
  // The code follows the word, maybe after other text with short numbers: "the below provided OTP.
  // This is valid for 5 minutes. 123456". The last such pair wins.
  let found = null;
  for (const m of t.matchAll(/\b(?:code|passcode|pin|otp|one-time password)\b/gi)) {
    const near = /(?<![\d./-])(\d{6})(?![\d%]|[./-]\d)/.exec(t.slice(m.index + m[0].length, m.index + m[0].length + 120));
    if (near) found = near[1];
  }
  if (found) return found;
  const before = /(?:^|[^\d-])(\d{6})\b[^0-9]{0,40}?\b(?:code|passcode)\b/i.exec(t);
  return before ? before[1] : null;
}

// Whether a mail (gws headers) is the Walmart code mail to read: a Walmart or Sam's Club sender, dated
// no earlier than a minute before the code was requested. Every other mail stays unopened.
export function walmartCodeMail(h, since) {
  if (!h) return false;
  if (!/walmart|samsclub|wal-mart/i.test(String(h.from || ''))) return false;
  const at = Date.parse(h.date);
  return !Number.isNaN(at) && at >= since - 60_000;
}

// ---------- iCIMS (*.icims.com, channel icims) ----------
// Every employer is its own portal host (careers-<tenant>.icims.com, us-careers-<tenant>.icims.com). The
// career site draws the portal in iframe#icims_content_iframe (src ...&in_iframe=1); loaded on its own,
// that URL bounces back to the outer page, so the runner drives the form inside the
// frame. Steps: the job page ("Apply for this job online"), "Enter Your Information" (an email box and a
// privacy box, then Next), an account or emailed verification when the portal asks, then the candidate
// profile, questions and EEO pages and a review.
// Which of the page's child frames ({name, url}) holds the portal: the one named icims_content_iframe,
// else one on an iCIMS host showing a /jobs/ page; -1 when none does.
export function icimsFrameIndex(frames) {
  const list = frames || [];
  const named = list.findIndex((f) => f?.name === 'icims_content_iframe');
  if (named >= 0) return named;
  return list.findIndex((f) => {
    try { const u = new URL(f?.url || ''); return detectAts(u.toString()) === 'icims' && /^\/jobs\//i.test(u.pathname); } catch { return false; }
  });
}

// Which step a page is on, from icimsPage() (apply-dom.mjs): 'job', 'login', 'sign-in',
// 'create-account', 'verify-code', 'verify-email', 'account-profile' (the profile form that also
// creates the login), 'profile', 'questions', 'eeo', 'review',
// 'submitted', 'already-applied', 'closed', 'error', or 'loading'. The application pages go by their
// heading or the URL's last path segment, never by body text: a profile intro can say "equal opportunity".
const IC_ALREADY = /you( have|'ve) already applied|already (submitted|applied)( an| your)? application|you have previously applied/i;
const IC_CLOSED = /no longer (accepting applications|available|open)|(job|position|posting|requisition) (has been|is) (filled|closed)|has been filled/i;
const IC_REVIEW = /^review\b|\breview (your|and|&) /i;
const IC_EEO = /self[- ]identification|equal (employment )?opportunity|\beeo\b|diversity|voluntary/i;
const IC_VERIFY = /check your (email|inbox)|verify your (email|account)|confirm your email|we (sent|emailed) you an? (link|email)/i;
export function icimsStage(p) {
  const text = String(p?.text || '');
  const heading = String(p?.heading || '').trim();
  let seg = '';
  try { seg = new URL(p?.url || '').pathname.split('/').filter(Boolean).pop() || ''; } catch { /* keep empty */ }
  const inputs = p?.inputs || 0;
  const form = inputs > 0 || !!p?.file;
  if (IC_ALREADY.test(text)) return 'already-applied';
  if (!form && (confirmationIn(text) || /application (is )?complete/i.test(text))) return 'submitted';
  if (!form && IC_CLOSED.test(text)) return 'closed';
  if ((p?.code || 0) > 0) return 'verify-code';
  // "Create a login" inside the candidate profile form (the resume upload, Login, Password,
  // Password (Re-enter) and a dozen profile fields on one page): the profile page that
  // also creates the account. A short form with just the passwords is the sign-up page.
  if ((p?.passwords || 0) >= 2 && (p?.file || inputs > p.passwords + (p.consent || []).length + 3)) return 'account-profile';
  if ((p?.passwords || 0) >= 2) return 'create-account';
  if ((p?.passwords || 0) === 1) return 'sign-in';
  if (p?.email && !p?.file && inputs <= 1 + (p.consent || []).length) return 'login';
  if (IC_REVIEW.test(heading) || /please review your application/i.test(text) || /^review$/i.test(seg)) return 'review';
  if (form) {
    if (IC_EEO.test(heading) || /^eeo$/i.test(seg)) return 'eeo';
    if (/question/i.test(heading) || /question/i.test(seg)) return 'questions';
    return 'profile';
  }
  if (IC_VERIFY.test(text)) return 'verify-email';
  if ((p?.apply || []).length) return 'job';
  if (/an (unexpected )?error (has )?occurred|something went wrong|page (cannot|could not) be (found|displayed)/i.test(text)) return 'error';
  return 'loading';
}

// The button an application page moves on with: Next or Continue on a profile, questions or EEO page,
// Submit only on the review page. A Submit anywhere else is held (the run stops and shows it): that
// press could send the application from a page not known to be the last. Import buttons (LinkedIn,
// Indeed, cloud drives), Back and Save for Later are never taken.
const IC_NEVER = /linkedin|indeed|dropbox|google drive|onedrive|last application|^back$|^previous$|^cancel$|save (for|and) later|^save$|^edit\b|^remove\b|^delete\b|^close$|^help$/i;
export function icimsNav(buttons, stage) {
  const usable = (buttons || []).map((b) => String(b || '').replace(/\s+/g, ' ').trim()).filter((b) => b && !IC_NEVER.test(b));
  const review = stage === 'review';
  const submit = review ? usable.find((b) => /submit/i.test(b)) || null : null;
  // A profile page can save with "Submit Profile": it submits the profile, not the application.
  const step = /profile/.test(stage || '') ? /^(next|continue|save (and|&) continue|next step|proceed|submit profile)$/i : /^(next|continue|save (and|&) continue|next step|proceed)$/i;
  const next = review ? null : usable.find((b) => step.test(b)) || null;
  const held = !review && !next ? usable.find((b) => /submit|finish/i.test(b)) || null : null;
  return { review, submit, next, held };
}

// Whether a mail (gws headers) is the iCIMS verification mail to read: an iCIMS sender, dated no earlier
// than a minute before the code or link was requested. Every other mail stays unopened.
export function icimsCodeMail(h, since) {
  if (!h || !/icims/i.test(String(h.from || ''))) return false;
  const at = Date.parse(h.date);
  return !Number.isNaN(at) && at >= since - 60_000;
}

// The plan for an iCIMS form page: planFill with what iCIMS field ids say that labels do not.
// The Login box of "Create a login" takes the account email (`login`, source 'account') unless a
// job answer names one for it; the phone is labelled just "Number" and its kind and the address
// kind just "Type", so those three are named by their id. A State/Province list loads only once
// its Country is chosen, so a Country pick goes right before the State pick. Consent questions
// (SMS, AI analysis) stay the operator's: planFill asks them unless the job or the bank holds an
// answer.
const IC_NAMES = [[/(^|[._])PersonProfileFields\.PhoneNumber$/, 'Phone Number'], [/(^|[._])PersonProfileFields\.PhoneType$/, 'Phone Type'], [/(^|[._])PersonProfileFields\.AddressType$/, 'Address Type']];
const IC_LOGIN = /(^|[._])PersonProfileFields\.Login$/;
export function icimsPlan(fields, bank, ctx, { login = null } = {}) {
  const named = (fields || []).map((f) => { const n = IC_NAMES.find(([re]) => re.test(f.id || '')); return n ? { ...f, label: n[1] } : f; });
  const box = named.find((f) => IC_LOGIN.test(f.id || ''));
  const own = box && ctx.jobAnswers && Object.prototype.hasOwnProperty.call(ctx.jobAnswers, `#${box.id}`);
  const derived = box && login && !own ? { [`#${box.id}`]: login } : {};
  const p = planFill(named, bank, { ...ctx, jobAnswers: { ...(ctx.jobAnswers || {}), ...derived } });
  const actions = p.actions.map((a) => (box && a.key === box.key && !own ? { ...a, source: 'account' } : a));
  const st = actions.findIndex((a) => a.source === 'state');
  const co = actions.findIndex((a) => a.source === 'country');
  if (st >= 0 && co > st) actions.splice(st, 0, actions.splice(co, 1)[0]);
  return { actions, missing: p.missing };
}

// The Other entry of a searchable iCIMS list ("*Other", "Other (please specify)"), or null. Used when
// the answer is not in the list and the page has an "Other <field>" box for it (a School list).
export function otherOption(texts) {
  return (texts || []).find((t) => /^\W*other\b(?!\w)/i.test(String(t).trim()) && !/^\W*other\w/i.test(String(t).trim())) || null;
}

// ---------- Searched lists (react-select v1) ----------
// The option of a searched list that is the answer: the same text (case, spacing, accents and curly
// apostrophes ignored), else the one option that says the same words once punctuation, the word "degree"
// and a plural s are dropped ("Master's Degree" is "Masters"). Two such options, or none, is no choice:
// never a near guess such as "Master of Science" for "Master's Degree".
const listNorm = (t) => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const listWords = (t) => listNorm(t).replace(/[^a-z0-9 ]+/g, '').split(' ').filter(Boolean)
  .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).filter((w) => w !== 'degree').join(' ');
// A list that writes a school as "<name> - <abbreviation> - <country>" ("Example State University of
// Science Technology and Arts - ESU - Freedonia") holds the answer in the one option whose name segment,
// before the first " - ", says the same words.
export function listChoice(texts, answer) {
  const want = listNorm(answer);
  if (!want) return null;
  const opts = (texts || []).filter((t) => listNorm(t));
  const exact = opts.find((t) => listNorm(t) === want);
  if (exact) return exact;
  const one = (pick) => { const hit = opts.filter((t) => { const w = listWords(pick(t)); return w && w === listWords(answer); }); return hit.length === 1 ? hit[0] : null; };
  return one((t) => t) || (/ - /.test(answer) ? null : one((t) => String(t).split(' - ')[0]));
}

// What the runner types into such a list: the whole answer, then short searches, its first and its last
// word with a possessive dropped (3+ letters), so a list that words the option a little differently still
// shows it, and a miss shows the nearest options ("Applied Linguistics": "Linguistics",
// "Psycholinguistics").
export function listSearches(answer) {
  const whole = String(answer || '').trim();
  const word = (w) => (w || '').replace(/['\u2019]s$/i, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const words = whole.split(/[\s,]+/).filter(Boolean);
  const out = [whole];
  for (const w of [word(words[0]), word(words.at(-1))]) if (w.length >= 3 && !out.includes(w)) out.push(w);
  return out;
}

// The values of an answer that names several, split on "|" ("Docker | Kubernetes" for a checkbox
// group that takes more than one, "Computer Science | Mathematics" for a list drawn as one row per
// value). One value stays one.
export function listValues(answer) {
  return String(answer || '').split('|').map((v) => v.trim()).filter(Boolean);
}

// ---------- Cookie banners ----------
// The decline button of a cookie banner: declining shares nothing, so it needs no consent; "Accept" is
// never pressed. A banner can put an icon before the words and "cookies" after them ("× Reject all
// cookies").
export const COOKIE_DECLINE = /^\W*(decline all|reject all|decline|reject|only necessary|necessary only|use necessary cookies only)( cookies)?\W*$/i;

// ---------- Phenom apply flows ----------
// Phenom's apply flow is one page: a stepper (li[atm-id] per step, the current one aria-current="step"), a
// react-jsonschema-form per step and Next, which saves the step. A typical flow: My information, My experience,
// Application questions, Additional application questions, Voluntary Disclosures, Review. Which stage a page is on,
// from phenomPage() (apply-dom.mjs): 'my-information', 'my-experience', 'questions', 'disclosures', 'self-identify',
// 'review', 'step' (a step id not seen yet), 'submitted', 'already-applied', 'closed', or 'loading'.
const PH_STAGE = {
  personalInformation: 'my-information',
  workAndEducation: 'my-experience',
  jobSpecificQuestions: 'questions',
  applicationQuestionnaire: 'questions',
  supplementaryQuestions: 'questions',
  voluntaryInformation: 'disclosures',
  disabilityInformation: 'self-identify',
  applicationReview: 'review',
};
export function phenomStage(p) {
  if (!p) return 'loading';
  const text = String(p.text || '');
  let path = '';
  try { path = new URL(p.url || '').pathname; } catch { /* keep empty */ }
  if (/already applied|have applied (for|to) this (job|position)/i.test(text)) return 'already-applied';
  if (/job has expired|either does not exist or is no longer open|no longer accepting applications/i.test(text)) return 'closed';
  // The thank-you page (the schema's atsSpecificData.tankyouMessage): "Your application is processing. ..."; the flow
  // routes to .../applythankyou (postSubmitUrl).
  if (!p.step && (/\/applythankyou\b/i.test(path) || /your application is processing|successfully applied|thank you for applying/i.test(text))) return 'submitted';
  if (p.loading || !p.step) return 'loading';
  return PH_STAGE[p.step] || 'step';
}

// The button a Phenom step moves on with: Next before Review, Submit only on Review. A Submit on any other step is
// held (the run stops and shows it). The résumé upload, Apply With LinkedIn, the cloud drives, the stepper's step tabs
// ("Review" among them), Previous and Save and Exit are never taken.
const PH_NEVER = /linkedin|indeed|dropbox|microsoft online|onedrive|google drive|upload resume|^previous$|^back$|save (and|&) exit|^edit$|^remove\b|^delete\b|^cancel$|^close$|^x$|cookie/i;
export function phenomNav(buttons, stage) {
  const usable = (buttons || []).map((b) => String(b || '').replace(/\s+/g, ' ').trim()).filter((b) => b && !PH_NEVER.test(b));
  const review = stage === 'review';
  const submit = review ? usable.find((b) => /^submit( (my |your )?application)?$/i.test(b)) || null : null;
  const next = review ? null : usable.find((b) => /^(next|continue|save (and|&) continue)$/i.test(b)) || null;
  const held = !review && !next ? usable.find((b) => /submit|finish/i.test(b)) || null : null;
  return { review, submit, next, held };
}

// The repeated entries a Phenom step shows (experienceData[n], educationData[n]), named by what the CV parse wrote:
// "title @ company" for work, the school for education. entriesLost: the ones a fill made disappear (a run once lost
// the second parsed work entry while filling the step), so the run stops instead of moving on with a history the
// user did not give.
const ENTRY_KEYS = { experienceData: ['title', 'companyName'], educationData: ['schoolName'] };
function entryNames(fields) {
  const by = new Map();
  for (const f of fields || []) {
    const m = /^(experienceData|educationData)\[(\d+)\]\.(\w+)$/.exec(f.id || '');
    if (!m || !ENTRY_KEYS[m[1]].includes(m[3])) continue;
    const k = `${m[1]}[${m[2]}]`;
    by.set(k, { ...(by.get(k) || {}), [m[3]]: String(f.value || '').replace(/\s+/g, ' ').trim() });
  }
  return [...by.entries()].map(([k, e]) => ENTRY_KEYS[k.split('[')[0]].map((p) => e[p] || '').join(' @ ')).filter((n) => n.replace(/[\s@]/g, ''));
}
export function entriesLost(before, after) {
  const left = entryNames(after);
  const lost = [];
  for (const n of entryNames(before)) {
    const i = left.indexOf(n);
    if (i >= 0) left.splice(i, 1); else lost.push(n);
  }
  return lost;
}

// A file name that fits an upload slot's limit (Phenom: "The length of file name should be less than or equal to 50
// characters", its schema's file-name size limit, refused a 55-character cover letter name). Whole words go from the
// end, and a dangling "and", "of" or "the" with them, until the name fits; the extension stays. A name that fits is
// kept as it is.
export function uploadName(name, max = 50) {
  const s = String(name || '');
  if (s.length <= max) return s;
  const dot = s.lastIndexOf('.');
  const ext = dot > 0 ? s.slice(dot) : '';
  const words = (dot > 0 ? s.slice(0, dot) : s).split(/[-_\s]+/).filter(Boolean);
  const STOP = /^(and|of|the|for|at|in|a|an|to|&)$/i;
  const fit = () => `${words.join('-')}${ext}`;
  while (words.length > 1 && (fit().length > max || STOP.test(words.at(-1)))) words.pop();
  return fit().length <= max ? fit() : `${words.join('-').slice(0, Math.max(1, max - ext.length))}${ext}`;
}
