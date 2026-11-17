// The company an application counts against, for the per-company application limit
// (config/apply.json companies.limit, default 1: one application per company). Agencies count as
// their named end client only: an agency role with no named client has no company limit, but
// the same agency role posted again under a new id is still a duplicate.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PIPELINE_DIR } from './paths.mjs';
import { loadConfig } from './config.mjs';

// "Globex Global Tech" and "Globex", "Initech Group" and "Initech", "Hooli AI" and "Hooli" are
// one company: punctuation goes, a leading "the" goes, then trailing corporate words, never the
// first word.
const CORP_SUFFIX = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'group', 'groups', 'global', 'tech', 'technology', 'technologies', 'solutions', 'talent', 'plc', 'gmbh', 'holdings', 'ai', 'labs', 'systems']);

const words = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

function baseKey(c) {
  const w = words(c);
  if (w.length > 1 && w[0] === 'the') w.shift();
  while (w.length > 1 && CORP_SUFFIX.has(w.at(-1))) w.pop();
  return w.join(' ');
}

// aliases (config/apply.json companies.aliases): brand and legal names of one company,
// e.g. { "Initrode": "Initech" }.
export function companyKey(c, aliases = {}) {
  const k = baseKey(c);
  for (const [from, to] of Object.entries(aliases || {})) if (baseKey(from) === k) return baseKey(to);
  return k;
}

const titleKey = (t) => words(t).join(' ');

// { key, agency, agencyTitle }: key is the company the application counts against, or null for an
// agency posting that names no client. A model-recorded end_client (triage) always wins; the
// model's via_agency flag or the config/apply.json companies.agencies list marks a recruiter or staffing poster.
export function applicationKey(job, { agencies = [], aliases = {} } = {}) {
  const own = companyKey(job?.company, aliases);
  const client = job?.triage?.end_client;
  if (client) return { key: companyKey(client, aliases) || null, agency: own || null, agencyTitle: null };
  if (job?.triage?.via_agency === true || agencies.some((a) => companyKey(a, aliases) === own)) return { key: null, agency: own, agencyTitle: `${own}|${titleKey(job?.title)}` };
  return { key: own || null, agency: null, agencyTitle: null };
}

// Applications made outside the job state (recruiter lists, email roles) live only as opportunity
// files. A file counts once the application went out: stage applied or later, or an applied_on date.
const SENT_STAGES = new Set(['applied', 'screening', 'nda', 'proposal', 'negotiating', 'won', 'lost']);
const front = (md) => String(md).match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
const fm = (md, k) => (front(md).match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'))?.[1] || '').replace(/\s+#.*$/, '').trim().replace(/^"(.*)"$/, '$1');
export function opportunityCompanies(files = [], aliases = {}) {
  return files.flatMap(({ file, md }) => {
    const company = fm(md, 'company');
    const stage = fm(md, 'stage');
    if (!company || !(SENT_STAGES.has(stage) || /^\d{4}-\d{2}-\d{2}/.test(fm(md, 'applied_on')))) return [];
    return [{ id: file, title: fm(md, 'role') || file, company, key: companyKey(company, aliases), status: `opportunity:${stage}`, job_id: fm(md, 'job_id') || null }];
  });
}

// What the callers pass to sameCompanyRoles: config/apply.json companies {limit, agencies,
// aliases}, plus the opportunity files' sent applications.
export function loadCompanyOpts({ cfg = loadConfig('apply.json', { required: false }).companies || {}, dir = join(PIPELINE_DIR, 'opportunities') } = {}) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((file) => ({ file, md: readFileSync(join(dir, file), 'utf8') })) : [];
  const aliases = cfg.aliases || {};
  return { limit: cfg.limit === undefined ? 1 : cfg.limit, agencies: cfg.agencies || [], aliases, external: opportunityCompanies(files, aliases) };
}
