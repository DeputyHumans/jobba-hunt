// Deterministic prefilter: approximates fit gates G1 (structure), G2 (location) and
// G3 (seniority) from card and detail text, so detail views and triage are spent only
// on plausible roles. drop = a gate fails. review = not enough data yet. The LLM
// triage (fit-profile.md) makes the real call on everything kept or in review.
// Dice jobs (source 'dice') take hands-on lane rules: senior hands-on titles pass, and G1 reads
// Dice's contract-type badges against preferences.engagement.accept.
//
// Inputs: config/prefilter.json (the regex lists) plus four preferences, passed to
// compilePrefilter so tests inject them: location.onsite_metros, engagement.accept,
// money.ic_rate_floor and money.ft_salary_floor.

import { diceStructure, cardTypes, engagementAccept } from './dice-extract.mjs';
import { belowIcFloor, belowFullTimeFloor } from './rate.mjs';
import { preferences, money } from './profile.mjs';

const rx = (list) => (list || []).map((s) => new RegExp(s, 'i'));
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

// opts (each defaults to the workspace preferences, read once here):
//   onsiteMetros  place-name regexes where an on-site or hybrid role is asked, not dropped
//                 (merged with prefilter.json onsite_metro_markers)
//   accept        engagement.accept (c2c, 1099, w2, full-time, contract, part-time)
//   icRateFloor, ftSalaryFloor   money floors; null turns the check off
export function compilePrefilter(cfg, opts = {}) {
  const prefs = ['onsiteMetros', 'accept'].some((k) => opts[k] === undefined) ? safe(() => preferences(), {}) : {};
  const m = ['icRateFloor', 'ftSalaryFloor'].some((k) => opts[k] === undefined) ? safe(() => money(), {}) : {};
  const metros = [...(cfg.onsite_metro_markers || []), ...(opts.onsiteMetros ?? prefs.location?.onsite_metros ?? [])];
  return {
    titleDrop: rx(cfg.title_drop),
    titleLeadership: rx(cfg.title_leadership),
    titleIc: rx(cfg.title_ic),
    titleIcRole: rx(cfg.title_ic_role),
    titleExec: rx(cfg.title_exec),
    icTitleDrop: rx(cfg.ic_title_drop),
    diceW2Title: rx(cfg.dice_w2_title),
    stackDrop: rx(cfg.stack_title_drop),
    stackKeep: rx(cfg.stack_title_keep),
    titleAi: rx(cfg.title_ai),
    scope: rx(cfg.scope_signals),
    fullTime: rx(cfg.full_time_markers),
    remote: rx(cfg.remote_markers),
    onsite: rx(cfg.onsite_markers),
    hybrid: rx(cfg.hybrid_markers),
    onsiteMetro: rx(metros),
    companyDrop: rx(cfg.company_drop),
    aggregators: (cfg.aggregators || []).map((s) => new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i')),
    // Query-probe labels (probe-metrics.mjs): the core title set and the strict structure words.
    probeCore: rx(cfg.probe_core_title?.length ? cfg.probe_core_title : cfg.title_exec),
    probeScope: rx(cfg.probe_strict_scope?.length ? cfg.probe_strict_scope : cfg.scope_signals),
    accept: opts.accept ?? engagementAccept(prefs),
    icRateFloor: opts.icRateFloor !== undefined ? opts.icRateFloor : (m.ic_rate_floor ?? null),
    ftSalaryFloor: opts.ftSalaryFloor !== undefined ? opts.ftSalaryFloor : (m.ft_salary_floor ?? null),
  };
}

const any = (res, text) => (res || []).some((r) => r.test(text || ''));

export function prefilterJob(job, P, { scopes = [] } = {}) {
  const reasons = [];
  const drops = [];
  const flags = [];
  const title = job.title || '';
  const d = job.detail || null;
  const dice = job.source === 'dice';
  const accepts = (t) => (P.accept || []).includes(t);

  if (!title) {
    reasons.push('card-unparsed');
  } else {
    if (any(P.titleDrop, title)) drops.push('title-excluded');
    if (dice) {
      if (any(P.icTitleDrop, title)) drops.push('outside-record');
      if (!any(P.titleLeadership, title) && !any(P.titleIc, title)) drops.push('not-senior');
    } else {
      // LinkedIn hands-on lane: a senior word AND an engineering noun, since LinkedIn carries
      // every profession. Platforms outside the record drop on any non-exec title:
      // "SharePoint Technical Architect" passes title_leadership on "architect" but is still an IC role.
      if (!any(P.titleLeadership, title) && (!any(P.titleIc, title) || !any(P.titleIcRole, title))) drops.push('not-senior');
      else if (!any(P.titleExec, title) && any(P.icTitleDrop, title)) drops.push('outside-record');
    }
    // An excluded stack (stack_title_drop) drops a non-exec title before any view, unless the title
    // also matches stack_title_keep (e.g. an AI title that names the stack: "AI Engineer (Python/X)").
    if (!any(P.titleExec, title) && any(P.stackDrop, title) && !any(P.stackKeep, title)) drops.push('stack-excluded');
  }

  // G2 location. Occasional travel is fine; an office is not, unless it sits in one of the
  // operator's on-site metros (location.onsite_metros, prefilter onsite_metro_markers): those
  // go to review as onsite-metro-ask, read from the card location. Hybrid elsewhere goes to
  // review too: only the description can say "occasional". A Dice card reads "Remote or Hybrid
  // in Chicago"; its job page badge (Remote, Hybrid, On-site) is the real answer once viewed.
  const loc = dice && d?.workplace ? d.workplace : [job.location || '', d?.workplace || ''].join(' ');
  const metro = any(P.onsiteMetro, job.location || '');
  if (!any(P.remote, loc)) {
    if (any(P.onsite, loc)) (metro ? reasons : drops).push(metro ? 'onsite-metro-ask' : 'onsite');
    else if (any(P.hybrid, loc)) reasons.push(metro ? 'onsite-metro-ask' : 'hybrid-check-travel');
    else reasons.push('location-unclear');
  }

  // Companies the operator excludes (company_drop), e.g. expert networks whose "CTO" listings
  // are writing gigs.
  if (any(P.companyDrop, job.company || '')) drops.push('company-excluded');

  // G1 structure, read against engagement.accept. A full-time or W2-only role that is accepted
  // goes to review with an "ask" reason, so triage looks at it; one outside accept drops.
  let fullTime = false;
  const fullTimeReason = () => (any(P.titleExec, title) ? 'full-time-ask' : 'full-time-ic-ask');
  const scopeInTitle = any(P.scope, title);
  if (dice) {
    // Many Dice recruiters put "W2 only" in the title while the badges just say Contract,
    // or list every contract type: the title wins.
    const g1 = any(P.diceW2Title, title) ? (accepts('w2') ? 'w2-only' : 'excluded')
      : diceStructure(d ? d.contract_types : cardTypes(job.card?.employment_type), P.accept);
    if (g1 === 'w2-only') reasons.push('w2-only');
    else if (g1 === 'full-time') { fullTime = true; reasons.push(fullTimeReason()); }
    else if (g1 === 'excluded') drops.push('structure-excluded');
    else if (g1 === 'unclear') reasons.push('contract-type-unconfirmed');
  } else if (!scopeInTitle) {
    if (d) {
      const scopeInText = any(P.scope, d.description_text);
      const et = d.employment_type || '';
      if (scopeInText || /^(contract|part-time|temporary)$/i.test(et)) { /* confirmed */ }
      else if (any(P.fullTime, et)) {
        fullTime = true;
        if (accepts('full-time')) reasons.push(fullTimeReason());
        else drops.push('full-time-excluded');
      } else reasons.push('scope-unconfirmed');
    } else if (scopes.length && scopes.every((s) => s === 'canary')) {
      // Hit only from a pure control canary (scope "canary"): plain full-time roles.
      // Dropped so they never use view budget; re-evaluated if a real query finds them.
      drops.push('canary-only');
    } else if (!scopes.includes('generic')) {
      // Generic queries ran with the contract/part-time job-type filter, so their hits
      // are already scoped. Fractional and semantic (AI search) hits need the description.
      reasons.push('scope-unconfirmed');
    }
  }

  // IC rate floor (money.ic_rate_floor): an IC title (no exec word: architects, principals and
  // fractional engineers count as IC) whose posted rate tops out under the floor. Dice cards
  // show pay before the view; LinkedIn only on the job page.
  if (title && !any(P.titleExec, title) && belowIcFloor(d?.comp_text, job.card?.pay_text, { floor: P.icRateFloor })) drops.push('rate-below-floor');
  // Full-time IC salary floor (money.ft_salary_floor), on the top of the posted range; rate.mjs.
  if (fullTime && title && !any(P.titleExec, title) && belowFullTimeFloor(d?.comp_text, job.card?.pay_text, { floor: P.ftSalaryFloor })) drops.push('salary-below-ft-floor');

  // On Dice nearly every poster is a staffing firm: the flag would mark everything.
  if (!dice && any(P.aggregators, job.company || '')) flags.push('aggregator');

  const verdict = drops.length ? 'drop' : reasons.length ? 'review' : 'keep';
  return { verdict, reasons: [...drops, ...reasons], flags };
}
