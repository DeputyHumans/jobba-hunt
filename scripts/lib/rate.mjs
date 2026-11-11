// Posted pay, parsed once for the tracker's comp chart and for the money floors.
//
// The floors come from preferences.money (ic_rate_floor, ft_salary_floor, ft_salary_target); null
// turns a check off. Every check takes an optional trailing options object ({ floor } or
// { floor, target }) so callers and tests can pass the values instead.
//   ic_rate_floor     a hands-on role whose posted rate tops out under it is dropped. Leadership comp
//                     is never scored, no rate stated has no effect, and form fields still get the
//                     answer-bank rate.
//   ft_salary_floor   a full-time IC role whose posted pay tops out under it is rejected
//   ft_salary_target  from the floor up to the target, the role reaches the operator flagged
//                     "below target". Contracts keep the hourly floor; leadership has no floor.

import { money } from './profile.mjs';

const moneyKey = (k) => { try { const v = money()[k]; return v == null ? null : Number(v); } catch { return null; } };
export const icRateFloor = () => moneyKey('ic_rate_floor');
export const ftSalaryFloor = () => moneyKey('ft_salary_floor');
export const ftSalaryTarget = () => moneyKey('ft_salary_target');

// (...texts, opts?): a trailing plain object is the options, everything before it is pay text.
const isOpts = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
function split(args) {
  return isOpts(args[args.length - 1]) ? [args.slice(0, -1), args[args.length - 1]] : [args, {}];
}

const HOURS = { hour: 1, day: 8, year: 2080 };

// open: the top figure carries a "+" ("$90+/hr"), so the posting states no ceiling.
export function parseComp(text) {
  if (!text) return null;
  // A figure labelled equity, bonus or stock just before it is not pay ("Base Salary: $337,500;
  // Equity: $396,000; Bonus: $135,000" is a $337,500 salary). The label is read from the text
  // since the previous figure, so "$200K + equity" keeps its $200K.
  const all = [...String(text).matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?([kK])?(\s?\+)?/g)];
  const hits = all.filter((m, i) => {
    const from = i ? all[i - 1].index + all[i - 1][0].length : 0;
    return !/\b(equity|bonus|stock|rsus?|options|commission)\b[^$]*$/i.test(String(text).slice(from, m.index));
  }).map((m) => ({ n: Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1), plus: !!m[3] }));
  if (!hits.length) return null;
  const nums = hits.map((h) => h.n);
  const t = String(text).toLowerCase();
  const unit = /\/\s?h(ou)?r|per hour|hourly/.test(t) ? 'hour' : /per day|\/\s?day|day rate|daily/.test(t) ? 'day'
    : /\/\s?y(ea)?r|per year|annual|salary/.test(t) ? 'year' : Math.max(...nums) < 1000 ? 'hour' : 'year';
  const max = Math.max(...nums);
  return { unit, min: Math.min(...nums), max, ...(hits.some((h) => h.n === max && h.plus) ? { open: true } : {}) };
}

// The top of the posted range in $/hour (a day is 8 h, a year 2,080 h), or null when no figure.
export function hourlyMax(text) {
  const c = parseComp(text);
  return c ? Math.round(c.max / HOURS[c.unit]) : null;
}

// { hourly, floor } when the posted rate tops out under the floor, else null. An open-ended
// top ("$90+/hr") has no ceiling, so it passes like an unstated rate.
export function belowIcFloor(...args) {
  const [texts, { floor = icRateFloor() }] = split(args);
  if (floor == null) return null;
  for (const t of texts) {
    const c = parseComp(t);
    if (!c) continue;
    if (c.open) return null;
    const h = hourlyMax(t);
    return h < floor ? { hourly: h, floor } : null;
  }
  return null;
}

// The top of the first posted pay figure in $/year, or null (no figure, or an open-ended top).
function annualTop(texts) {
  for (const t of texts) {
    const c = parseComp(t);
    if (!c) continue;
    return c.open ? null : Math.round(c.max * (2080 / HOURS[c.unit]));
  }
  return null;
}

// { annual, floor } when the posted pay tops out under the floor (an hour is 1/2,080 of a year,
// a day 1/260), else null. An open-ended top ("$300K+") states no ceiling, so it passes.
export function belowFullTimeFloor(...args) {
  const [texts, { floor = ftSalaryFloor() }] = split(args);
  if (floor == null) return null;
  const annual = annualTop(texts);
  return annual != null && annual < floor ? { annual, floor } : null;
}

// { annual, target } when the posted pay tops out at or above the floor but under the target.
export function belowFullTimeTarget(...args) {
  const [texts, { floor = ftSalaryFloor(), target = ftSalaryTarget() }] = split(args);
  if (target == null) return null;
  const annual = annualTop(texts);
  return annual != null && annual >= (floor ?? 0) && annual < target ? { annual, target } : null;
}
