import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderIndexHtml, renderAnalysisHtml, pageViolations, checkRoles, tierLabel, dayLabel, untilLabel, resolveLinks, dimsFrom, DIMS, DEFAULT_WEIGHTS,
} from '../scripts/lib/recruiter-pages.mjs';

const assets = { css: '', wordmark: 'Jordan Example', tiers: { a: 80, b: 65 }, zone: 'America/Chicago' };
const page = { date: '2026-10-28', source: { label: 'Example list', url: 'https://lists.example/x' }, never_show: ['Sam'] };
const role = (n, score, dims, priority) => ({
  title: `Role ${n} <b>`, company: `Co ${n}`, url: `https://jobs.example/${n}`, where: 'Remote (US)', comp: '$1–2K', score, dims, priority, why: 'fits', consider: 'gap', cv: `cv-${n}`,
  cvUrl: `https://bikeshed.now/d/cv-${n}?k=KEY${n}`, cvTitle: `CV ${n}`, coverage: { tailored: 70, generic: 40 },
  requirements: [{ text: 'Led teams', status: 'met', note: 'yes', claims: ['C03'] }, { text: 'Docs', status: 'partial', note: 'some', claims: ['C21'] }, { text: 'Insurance', status: 'gap', note: 'no', claims: [] }],
});
const roles = [role(1, 93, { mandate: 5, domain: 5, stage: 4, stack: 5, signal: 4 }, 'Recommended'), role(2, 66, { mandate: 3, domain: 4, stage: 2, stack: 3, signal: 5 }, 'Optional')];
const index = renderIndexHtml(page, roles, { ...assets, linksUntil: '2026-11-04T19:12:53Z', analysisUrl: 'https://bikeshed.now/d/analysis' });
const analysis = renderAnalysisHtml(page, roles, { ...assets, indexUrl: 'https://bikeshed.now/d/index' });

test('index lists the roles in the given order, each with posting, score, comments and its CV link', () => {
  assert.ok(index.indexOf('Role 1') < index.indexOf('Role 2'));
  assert.match(index, /<span class="rank">01<\/span>[\s\S]*<span class="rank">02<\/span>/);
  for (const r of roles) {
    assert.ok(index.includes(`href="${r.url}"`), 'posting link');
    assert.ok(index.includes(`href="${r.cvUrl}"`), 'tailored CV link, the share link as given');
    assert.ok(index.includes(`${r.score}<small>/100</small>`));
  }
  assert.equal((index.match(/class="label">Why it fits</g) || []).length, 2);
  assert.equal((index.match(/class="label">Consider</g) || []).length, 2);
  assert.match(index, /open until <b>4 Nov 2026<\/b>/);
  assert.ok(index.includes('href="https://bikeshed.now/d/analysis"'), 'links the analysis');
});

test('analysis shows the score breakdown, every requirement with its status, and CV coverage', () => {
  assert.ok(analysis.indexOf('Role 1') < analysis.indexOf('Role 2'));
  assert.match(analysis, /Mandate<\/span>[\s\S]*?35<small>\/35<\/small>/);
  assert.match(analysis, /Posting quality<\/span>[\s\S]*?12<small>\/15<\/small>/);
  assert.equal((analysis.match(/<li class="req st-/g) || []).length, 6);
  assert.match(analysis, /1 met · 1 partial · 1 gap/);
  assert.match(analysis, /70%<\/span> tailored CV/);
  assert.match(analysis, /weighted: mandate 35, domain 20, stage 20, stack 10, posting quality 15\. <b>80\+<\/b> strong fit, <b>65\+<\/b> good fit/);
  assert.ok(analysis.includes('href="https://bikeshed.now/d/index"'), 'links the index');
  assert.ok(!/\bC\d{2}\b/.test(analysis), 'claim IDs stay in the source, never on the page');
  assert.ok(!analysis.includes('?k='), 'no share links on the analysis');
});

test('dimension scores must add up to the fit score, statuses must be known', () => {
  assert.deepEqual(checkRoles(roles), []);
  assert.match(checkRoles([{ ...roles[0], score: 90 }]).join(), /dimensions give 93, score says 90/);
  assert.match(checkRoles([{ ...roles[0], requirements: [{ status: 'maybe' }] }]).join(), /unknown status maybe/);
});

test('weights come from config (preferences.recruiter_weights) with the generic defaults; they must sum to 100', () => {
  assert.deepEqual(DEFAULT_WEIGHTS, { mandate: 35, domain: 20, stage: 20, stack: 10, signal: 15 });
  assert.deepEqual(dimsFrom(undefined), DIMS);
  const dims = dimsFrom({ mandate: 30, domain: 25 });
  assert.deepEqual(dims.map(([k, , w]) => [k, w]), [['mandate', 30], ['domain', 25], ['stage', 20], ['stack', 10], ['signal', 15]]);
  const r = { ...roles[0], score: Math.round(5 / 5 * 30 + 5 / 5 * 25 + 4 / 5 * 20 + 5 / 5 * 10 + 4 / 5 * 15) };
  assert.deepEqual(checkRoles([r], dims), []);
  assert.match(checkRoles([r], dimsFrom({ mandate: 50 })).join(), /weights sum to 115, not 100/);
  assert.match(renderAnalysisHtml(page, [r], { ...assets, dims }), /weighted: mandate 30, domain 25, stage 20/);
});

test('tiers follow preferences.tiers; priorities carry their badge', () => {
  assert.equal(tierLabel(80), 'Strong fit');
  assert.equal(tierLabel(79), 'Good fit');
  assert.equal(tierLabel(65), 'Good fit');
  assert.equal(tierLabel(64), 'Partial fit');
  assert.equal(tierLabel(75, { a: 75, b: 60 }), 'Strong fit');
  assert.match(renderIndexHtml(page, roles, { ...assets, tiers: { a: 75, b: 60 } }), /<b>75\+<\/b> strong, <b>60\+<\/b> good/);
  assert.match(index, /class="badge recommended">Recommended/);
  assert.match(index, /class="badge optional">Optional/);
  assert.equal(dayLabel('2026-10-28'), '28 Oct 2026');
});

test('link expiry reads in the user\'s time zone (preferences.schedule.tz)', () => {
  assert.equal(untilLabel('2026-11-05T05:59:59.999Z', 'America/Chicago'), '4 Nov 2026', 'end of 4 Nov in Chicago, not 5 Nov');
  assert.equal(untilLabel('2026-11-05T05:59:59.999Z', 'UTC'), '5 Nov 2026');
  assert.equal(untilLabel('2026-11-05T05:59:59.999Z'), '4 Nov 2026', 'the default zone is the fixture profile\'s (America/Chicago)');
});

test('neutral brand: a text wordmark, no mark unless one is given, the accent colour from preferences', () => {
  assert.match(index, /<span class="wordmark"><span class="wordmark-name"><span>Jordan Example<\/span><\/span><\/span>/);
  assert.match(index, /<footer class="foot"><span>Jordan Example<\/span>/);
  assert.doesNotMatch(index, /<svg/);
  const withMark = renderIndexHtml(page, roles, { ...assets, accent: '#2F5D8A', mark: { viewBox: '-5 -5 34 34', frame: { x: 3, y: 3, size: 18, strokeWidth: 2 }, seal: { x: 4, y: 4, size: 7 } } });
  assert.match(withMark, /<svg viewBox="-5 -5 34 34"/);
  assert.match(withMark, /:root\{--blue:#2F5D8A\}<\/style>/);
  assert.doesNotMatch(renderIndexHtml(page, roles, { ...assets, accent: 'red;}body{display:none' }), /display:none/, 'only a hex colour reaches the CSS');
});

test('both pages escape text, carry no script, no process talk and no em dash', () => {
  for (const html of [index, analysis]) {
    assert.ok(html.includes('&lt;b&gt;') && !html.includes('Role 1 <b>'), 'title text is escaped');
    assert.ok(!/<script/i.test(html));
    assert.ok(!/interested|submit|recruiter|apply/i.test(html.replace(/<style>[\s\S]*?<\/style>/, '')));
    assert.ok(!/—/.test(html));
  }
  assert.match(index, /<span class="nowrap">&lt;b&gt;&#x2009;<span class="arr">&#x2197;<\/span><\/span>/, 'the arrow wraps with the last word');
});

test('guard refuses a never-show name, another email, a phone number or a script', () => {
  assert.deepEqual(pageViolations(index, page.never_show), []);
  assert.deepEqual(pageViolations(analysis, page.never_show), []);
  assert.deepEqual(pageViolations('<p>From Sam Recruiter</p>', ['Sam']), ['name Sam']);
  assert.deepEqual(pageViolations('<p>Samantha</p>', ['Sam']), [], 'whole words only');
  assert.deepEqual(pageViolations('<p>sam@staffco.example</p>'), ['email sam@staffco.example']);
  assert.deepEqual(pageViolations('<p>jordan@example.com</p>'), [], 'the default allow-list is the profile\'s application email');
  assert.deepEqual(pageViolations('<p>jordan@example.com</p>', [], ['other@example.com']), ['email jordan@example.com']);
  assert.deepEqual(pageViolations('<p>555 555 0100</p>'), ['phone number']);
  assert.deepEqual(pageViolations('<script>1</script>'), ['script']);
});

test('links: share links while open, member links after; the analysis links the index only where its reader can open it', () => {
  const docs = { 'cv-1': { url: 'https://b/d/cv-1' }, index: { url: 'https://b/d/index' }, analysis: { url: 'https://b/d/analysis' } };
  const share = { expires: '2026-11-04T19:12:53Z', links: { 'cv-1': 'https://b/d/cv-1?k=K' }, pages: { analysis: 'https://b/d/analysis?k=A' } };
  const now = Date.parse('2026-10-28T20:00:00Z');
  const open = resolveLinks([{ cv: 'cv-1' }], { docs, share, now });
  assert.equal(open.cvUrls['cv-1'], 'https://b/d/cv-1?k=K');
  assert.equal(open.analysisUrl, 'https://b/d/analysis?k=A', 'the index links the shared analysis');
  assert.equal(open.indexUrl, null, 'a shared analysis never links a members-only index');
  assert.equal(open.until, '2026-11-04T19:12:53Z');
  const both = resolveLinks([{ cv: 'cv-1' }], { docs, share: { ...share, pages: { ...share.pages, index: 'https://b/d/index?k=I' } }, now });
  assert.equal(both.indexUrl, 'https://b/d/index?k=I');
  const after = resolveLinks([{ cv: 'cv-1' }], { docs, share, now: Date.parse('2026-11-05T00:00:00Z') });
  assert.deepEqual([after.cvUrls['cv-1'], after.analysisUrl, after.indexUrl, after.until], ['https://b/d/cv-1', 'https://b/d/analysis', 'https://b/d/index', null]);
  assert.equal(resolveLinks([{ cv: 'cv-2' }], { docs }).cvUrls['cv-2'], null, 'a CV with no link stays null, so the build refuses');
});
