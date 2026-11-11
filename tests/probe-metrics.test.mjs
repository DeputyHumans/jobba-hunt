import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePrefilter } from '../scripts/lib/prefilter.mjs';
import { probeMetrics, containment, withUniquePlausible, pickViewIds, relevantIds } from '../scripts/lib/probe-metrics.mjs';

const TPL = JSON.parse(readFileSync(new URL('../templates/workspace/config/prefilter.json', import.meta.url), 'utf8'));
// The operator's core title set for probes (prefilter.json probe_core_title), injected here: a
// tech-leadership set that leaves out CIO and plain Director titles.
const CORE = [
  '\\bcto\\b',
  'chief (technology|technical|ai) officer',
  '\\b(vp|vice president|svp|evp)\\b.{0,20}\\b(engineering|technology|software|ai|platform)\\b',
  'head of (engineering|technology|ai|software|platform)',
  '\\bengineering (lead|leader)\\b',
  '\\btechnical (advisor|adviser|co-?founder|partner|lead)\\b',
];
const P = compilePrefilter({ ...TPL, probe_core_title: CORE }, { onsiteMetros: [], accept: ['c2c', 'contract', 'part-time'], icRateFloor: null, ftSalaryFloor: null });
const card = (job_id, title, location = 'United States (Remote)') => ({ job_id, title, company: 'Acme Corp', location });

const a = {
  id: 'A1', result_count: 157,
  cards: [
    card('1', 'Fractional CTO'),
    card('2', 'Chief Information Officer'),
    card('3', 'Senior Software Engineer'),
    card('4', 'Director of DevOps', 'Austin, TX (On-site)'),
  ],
};
const b = { id: 'A2', result_count: 2, cards: [card('1', 'Fractional CTO'), card('5', 'Interim CTO')] };

test('probe metrics: counts, truncation and title/location shares', () => {
  const m = probeMetrics(a, P);
  assert.equal(m.ids, 4);
  assert.equal(m.truncated, true, '157 in the header, 4 collected');
  assert.equal(m.remote_pct, 75);
  assert.equal(m.lead_pct, 75, 'Senior Software Engineer is not leadership');
  assert.equal(m.scope_pct, 25, 'only the Fractional CTO title carries a scope signal');
  assert.equal(m.plausible_pct, 50, 'lead AND remote: ids 1 and 2');
  assert.deepEqual(m.plausible_ids, ['1', '2']);
  assert.equal(probeMetrics(b, P).truncated, false);
});

test('fit = core tech-leadership title AND a strict scope word; core = the title alone', () => {
  const cards = [
    card('1', 'Fractional CTO'),
    card('2', 'Chief Information Officer'),
    card('3', 'Digital Consulting Director, Oracle Technical'),
    card('4', 'VP of Engineering'),
    card('5', 'Head of AI (Contract)'),
    card('6', 'Technical Advisor, Part-Time'),
    card('7', 'Director of DevOps'),
    card('8', 'Interim Chief Technology Officer'),
    card('9', 'Fractional CTO_Remote_US Healthtech'),
  ];
  const m = probeMetrics({ id: 'F', result_count: 8, cards }, P);
  assert.deepEqual(m.fit_ids, ['1', '5', '6', '8', '9'], 'consulting-director and CIO are not fit; "CTO_Remote" still counts');
  assert.equal(m.core_pct, 67, 'CTO, VP Eng, Head of AI, Technical Advisor, Interim CTO, CTO_Remote: 6 of 9');
  assert.equal(m.fit_pct, 56);
});

test('truncation falls back to a full page when the header count is missing', () => {
  const cards = Array.from({ length: 25 }, (_, i) => card(String(100 + i), 'CTO'));
  assert.equal(probeMetrics({ id: 'X', result_count: null, cards }, P).truncated, true);
  assert.equal(probeMetrics({ id: 'Y', result_count: null, cards: cards.slice(0, 24) }, P).truncated, false);
});

test('containment is the share of a row probe IDs also found by the column probe', () => {
  const c = containment([a, b]);
  assert.equal(c.A1.A2, 25, '1 of A1 4 ids is in A2');
  assert.equal(c.A2.A1, 50, '1 of A2 2 ids is in A1');
  assert.equal(c.A1.A1, 100);
});

test('unique plausible / unique fit = IDs no other probe returned at all', () => {
  const rows = withUniquePlausible([a, b], P);
  assert.deepEqual(rows.find((r) => r.id === 'A1').unique_plausible_ids, ['2']);
  assert.deepEqual(rows.find((r) => r.id === 'A2').unique_plausible_ids, ['5']);
  assert.deepEqual(rows.find((r) => r.id === 'A1').unique_fit_ids, []);
  assert.deepEqual(rows.find((r) => r.id === 'A2').unique_fit_ids, ['5']);
});

test('view sampling skips already-sampled IDs and honours the where filter', () => {
  const taken = new Set(['1']);
  assert.deepEqual(pickViewIds(a.cards, { n: 2, where: 'any' }, P, taken), ['2', '3']);
  assert.deepEqual(pickViewIds(a.cards, { n: 2, where: 'non-remote' }, P, new Set()), ['4']);
  assert.deepEqual(pickViewIds(a.cards, { n: 3, where: 'lead' }, P, taken), ['2', '4']);
});

// Contract or part-time counts as fractional; the title need not say so.
test('relevant: every core card of a contract/part-time-filtered probe counts', () => {
  const p = { id: 'G', query: { job_type: 'contract-part-time' }, cards: [card('1', 'Chief Technology Officer'), card('2', 'Director of IT')] };
  assert.deepEqual(relevantIds(p, {}, { P }), ['1']);
  assert.throws(() => relevantIds(p, {}), /compiled prefilter/);
});

test('relevant in an unfiltered probe: title word, or a view showing contract/part-time structure', () => {
  const p = { id: 'U', query: {}, cards: [
    card('1', 'Fractional CTO'),
    card('2', 'CTO'),
    card('3', 'Chief Technology Officer'),
    card('4', 'CTO'),
    card('5', 'VP Engineering'),
  ] };
  const views = {
    2: { employment_type: 'Contract', description_text: '' },
    3: { employment_type: 'Full-time', description_text: "We're hiring a fractional CTO who owns product and engineering." },
    4: { employment_type: 'Full-time', description_text: 'Trade perpetual futures contracts on our exchange. Remote | Full-Time.' },
  };
  assert.deepEqual(relevantIds(p, views, { P }), ['1', '2', '3'], 'Full-time tag with "futures contracts" is not structure; no view means unknown');
});

test('relevant honours a company exclusion (expert-network gigs titled CTO)', () => {
  const p = { id: 'E', query: { job_type: 'contract-part-time' }, cards: [{ ...card('1', 'CTO / Head of AI at Banks'), company: 'Umbrella Labs' }, card('2', 'CTO')] };
  assert.deepEqual(relevantIds(p, {}, { excludeCompany: /umbrella/i, P }), ['2']);
});

test('without probe_core_title the core set is title_exec, and labelCard reads the same sets', async () => {
  const { labelCard } = await import('../scripts/lib/probe-metrics.mjs');
  const plain = compilePrefilter(TPL, { onsiteMetros: [], accept: ['contract'], icRateFloor: null, ftSalaryFloor: null });
  assert.equal(labelCard(card('1', 'Director of DevOps'), plain), 'core', 'title_exec counts any director');
  assert.equal(labelCard(card('1', 'Director of DevOps'), P), 'noise');
  assert.equal(labelCard(card('2', 'Interim CTO_Remote'), P), 'fit');
  assert.equal(labelCard(card('3', 'VP of Engineering'), P), 'core');
});
