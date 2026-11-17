// The user's identity and standing preferences, from the workspace profile/ folder:
//   person.json       name, display name, file prefix, application email, phone, location, links
//   preferences.json  schedule, money floors, tiers, lanes, engagement, location, CV and tailoring
//                     options, brand, notifications (the single source for each of these)
//   answers.json      the application answer bank (profile, facts, eeo, learned)
// Every loader merges the workspace file over the shipped template, so a missing key falls back
// to a safe default instead of a crash.

import { join } from 'node:path';
import { PROFILE_DIR, TEMPLATES_DIR } from './paths.mjs';
import { deepMerge, readJsonFile } from './config.mjs';

const tpl = (name) => readJsonFile(join(TEMPLATES_DIR, 'profile', name), {});
const own = (name) => readJsonFile(join(PROFILE_DIR, name), {});
const load = (name) => deepMerge(tpl(name), own(name));

export const ANSWERS_PATH = join(PROFILE_DIR, 'answers.json');

export const person = () => load('person.json');
export const preferences = () => load('preferences.json');
export const answers = () => load('answers.json');

export const schedule = () => preferences().schedule;
export const tz = () => schedule().tz;

const slug = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The file-name prefix for every document the user sends: "<first>-<last>" unless set.
export function filePrefix(p = person()) {
  return slug(p.file_prefix || p.name) || 'candidate';
}
export const cvFileBase = (share, p) => `${filePrefix(p)}-cv-${share}`;
export const coverFileBase = (slugPart, p) => `${filePrefix(p)}-cover-letter-${slugPart}`;
// Matches a CV file name built by cvFileBase, for any prefix.
export const CV_FILE_RE = /^(.+?)-cv-([a-z0-9-]+)\.(pdf|docx|html)$/;

// The address applications use (forms, ATS accounts, privacy-guard allow-list).
// "+1 (555) 555-0100" from "(555) 555-0100" and an answer-bank country like "United States (+1)".
export function formatPhone(phone, country) {
  if (!phone) return null;
  const s = String(phone).trim();
  if (s.startsWith('+')) return s;
  const cc = String(country || '').match(/\(\+(\d+)\)/)?.[1];
  return cc ? `+${cc} ${s}` : s;
}
// The number a CV may show (person.json phone, else the answer bank's), or null. Whether a CV
// shows it is cv.mjs wantsPhone: the variant's contact.phone, else person.json show_phone_on_cv.
export function cvPhone(p = person(), a = answers()) {
  const country = a?.profile?.phone_country;
  return formatPhone(p?.phone, country) || formatPhone(a?.profile?.phone, country);
}

export const applicationEmail = (p = person()) => String(p.application_email || p.email || '').trim().toLowerCase();

// How skills and messages name the user: the display name, else "the operator".
export const operatorName = (p = person()) => p.display_name || p.name || 'the operator';

export const money = () => preferences().money || {};
export const tiers = () => preferences().tiers || { a: 80, b: 65 };
