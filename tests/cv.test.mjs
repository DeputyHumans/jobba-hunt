import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  claimIdsFromBank, validateVariant, assemble, renderHtml, modelText, lintText,
  coverage, checkExtracted, rankForJd, checkPageSplit, variantPool, bodySegments, repeatedPhrases,
  sourceRefRe, cvPerson, inlineFonts, paperOf, sheetCss, pageRuleCss, pdfFooterTemplate, displayText, PAPER,
} from '../scripts/lib/cv.mjs';

const FIX = new URL('./fixtures/workspace/', import.meta.url);
const master = {
  source_ref_prefixes: ['CV'],
  nobreak: ['SOC 2', 'PCI DSS', '2 billion'],
  person: { name: 'Jordan Example', location: 'Springfield, IL', workplace: 'Remote (US)', email: 'jordan@example.com', linkedin: 'linkedin.com/in/jordan-example', claims: ['C01'] },
  bullets: {
    'acme-scale': { text: 'Grew engineering from 12 to 45 engineers across six teams.', claims: ['C03'] },
    'acme-ai': { text: 'Introduced AI-assisted code review with human approval on every merge.', claims: ['C06'] },
    'globex-mig': { text: 'Moved 140 services from on-premises hosting to AWS and Kubernetes.', claims: ['C09'] },
  },
  roles: {
    acme: { title: 'Head of Engineering', company: 'Acme Corp', dates: 'Mar 2023 – Present', claims: ['C02'], contexts: { default: { text: 'B2B workflow software.', claims: ['C02'] } } },
    globex: { title: 'Director of Engineering', company: 'Globex', dates: 'Jan 2019 – Feb 2023', claims: ['C08'], contexts: { default: { text: 'Online marketplace.', claims: ['C08'] } },
      subheads: { platform: { label: 'Platform and reliability', dates: '2019 – 2023' } } },
    soylent: { title: 'Software Engineer', company: 'Soylent Systems', dates: '2008 – 2010', claims: ['C18'], line: { text: 'Supply chain web applications.', claims: ['C18'] } },
  },
  education: [{ degree: 'B.S. Computer Science', school: 'Example State University', year: '2008', claims: ['C19'] }],
  languages: { text: 'English (native), Spanish (professional)', claims: ['C35'] },
};
const variant = {
  slug: 'head-of-engineering', share: 'head-of-engineering', target_title: 'Head of Engineering',
  headline: 'Head of Engineering · Scaling Teams and Delivery',
  summary: { text: 'Engineering leader with 17 years in software.', claims: ['C01'] },
  highlights: [{ label: 'Scaling', text: 'grew a team of 12 into six teams.', claims: ['C03'] }],
  skills: [{ label: 'Platform', terms: ['AWS', 'PostgreSQL'], claims: ['C09'] }, { label: 'Leadership', terms: ['hiring plans'], claims: ['CV:22'] }],
  experience: [
    { role: 'acme', context: 'default', items: ['acme-scale', 'acme-ai'] },
    { role: 'globex', context: 'default', items: [{ sub: 'platform' }, 'globex-mig'] },
  ],
  earlier: ['soylent'],
  target_keywords: ['head of engineering', 'hiring', 'AWS', 'Postgres|PostgreSQL', 'Rust'],
  honest_gaps: ['Rust'],
};
const ids = new Set(['C01', 'C02', 'C03', 'C06', 'C08', 'C09', 'C18', 'C19', 'C35']);

test('claim IDs are read from the claim-bank table rows', () => {
  const md = '| ID | Claim |\n|---|---|\n| C01 | 17 years |\n| C34 | open source |\nnot a row C99\n';
  assert.deepEqual([...claimIdsFromBank(md)], ['C01', 'C34']);
  const bank = claimIdsFromBank(readFileSync(new URL('collateral/claim-bank.md', FIX), 'utf8'));
  assert.ok(bank.has('C01') && bank.has('C35'), 'the fixture bank holds the persona\'s claims');
  assert.ok(bank.size >= 25 && bank.size <= 40);
});

test('a retired claim row keeps its ID reserved but is no longer valid provenance', () => {
  const md = '| C19 | degree |\n| C20 | **Retired (fictional): kept reserved.** |\n';
  assert.deepEqual([...claimIdsFromBank(md)], ['C19']);
  const bank = claimIdsFromBank(readFileSync(new URL('collateral/claim-bank.md', FIX), 'utf8'));
  assert.equal(bank.has('C20'), false, 'C20 is retired in the fixture bank');
});

test('a valid variant passes validation', () => {
  assert.deepEqual(validateVariant(master, variant, ids), []);
});

test('the fixture collateral validates: every variant cites only known claims', () => {
  const m = JSON.parse(readFileSync(new URL('collateral/cv/master.json', FIX), 'utf8'));
  const bank = claimIdsFromBank(readFileSync(new URL('collateral/claim-bank.md', FIX), 'utf8'));
  for (const slug of ['head-of-engineering', 'platform-director']) {
    const v = JSON.parse(readFileSync(new URL(`collateral/cv/variants/${slug}.json`, FIX), 'utf8'));
    assert.deepEqual(validateVariant(m, v, bank), [], slug);
  }
});

test('validation names unknown bullets, roles, sub-heads and claim IDs', () => {
  const bad = structuredClone(variant);
  bad.experience[0].items.push('ghost');
  bad.experience.push({ role: 'nope', context: 'default', items: [] });
  bad.experience[1].items.unshift({ sub: 'missing' });
  bad.highlights[0].claims = ['C99'];
  bad.skills[0].claims = [];
  const errs = validateVariant(master, bad, ids).join('\n');
  for (const s of ['ghost', 'nope', 'missing', 'C99', 'Platform']) assert.match(errs, new RegExp(s));
});

test('a role title key picks a title from the master list; no key keeps the master title', () => {
  const m = structuredClone(master);
  m.roles.acme.titles = { vp: { text: 'Head of Engineering (VP level)', claims: ['C02'] } };
  const keyed = structuredClone(variant);
  keyed.experience[0].title = 'vp';
  assert.deepEqual(validateVariant(m, keyed, ids), []);
  assert.equal(assemble(m, keyed).roles[0].title, 'Head of Engineering (VP level)');
  assert.equal(assemble(m, variant).roles[0].title, 'Head of Engineering');
  keyed.experience[0].title = 'cto';
  assert.match(validateVariant(m, keyed, ids).join('\n'), /unknown title cto/);
});

test('repetition check: a 5-word phrase said twice in one CV is reported once per pair of places', () => {
  const segs = [
    ['summary', 'Still writes design docs most weeks for the teams.'],
    ['highlight "A"', 'A: still writes design docs most weeks, in Go; still writes design docs most weeks.'],
    ['acme bullet 1', 'Writes design docs.'],
  ];
  const r = repeatedPhrases(segs);
  assert.equal(r.length, 1, 'one finding for the phrase, naming both places');
  assert.equal(r[0].phrase, 'still writes design docs most');
  assert.deepEqual(r[0].where, ['summary', 'highlight "A"']);
  assert.deepEqual(repeatedPhrases([['x', 'led a team of four; led a team of four']]).map((f) => f.where), [['x']], 'a repeat inside one sentence counts too');
  assert.deepEqual(repeatedPhrases([['x', 'ships code most weeks'], ['y', 'ships code most days']]), [], 'four shared words are not a repeat');
  const m = assemble(master, variant);
  assert.ok(bodySegments(m).every(([, t]) => !t.includes('Jordan Example')), 'header lines are left out');
});

test('source line references count as provenance only for the configured prefixes', () => {
  assert.deepEqual(validateVariant(master, { ...variant, skills: [{ label: 'X', terms: ['a'], claims: ['CV:72-74'] }] }, ids), []);
  const noPrefix = { ...master, source_ref_prefixes: undefined };
  assert.match(validateVariant(noPrefix, variant, ids).join('\n'), /unknown claim CV:22/, 'no prefixes configured: no source reference is provenance');
  assert.equal(sourceRefRe([]), null);
  assert.equal(sourceRefRe(['CV', 'LI']).test('LI:3'), true);
  assert.equal(sourceRefRe(['CV']).test('XX:3'), false);
  assert.equal(sourceRefRe(['C.*']), null, 'a prefix is a plain word, never a pattern');
});

test('rendered HTML is one reading column: no tables, no nested lists, title before dates', () => {
  const html = renderHtml(assemble(master, variant), 'body{}');
  assert.doesNotMatch(html, /<table|<img|<svg/i);
  assert.doesNotMatch(html, /<li>(?:(?!<\/li>)[^])*<ul/i, 'no <ul> inside an open <li>');
  assert.match('<ul><li>a<ul><li>b</li></ul></li></ul>', /<li>(?:(?!<\/li>)[^])*<ul/i, 'the nesting check itself detects nesting');
  const t = html.indexOf('Head of Engineering</span><span class="role-sep">');
  const d = html.indexOf('Mar 2023 – Present');
  assert.ok(t > 0 && d > t, 'role title precedes its dates in the DOM');
  for (const h of ['Summary', 'Career Highlights', 'Skills', 'Experience', 'Education']) assert.match(html, new RegExp(`<h2>${h}</h2>`));
  assert.doesNotMatch(html, /Languages|English \(native\)/, 'no Languages section');
  assert.match(html, /jordan@example\.com/);
  // A real bullet glyph in the text layer marks where each item starts (text extractors and ATS
  // parsers merge same-indent items into one paragraph otherwise).
  for (const li of html.match(/<ul class="bul">[^]*?<\/ul>/g).join('').match(/<li>[^]*?<\/li>/g)) assert.match(li, /^<li><span class="b">• <\/span>/);
});

test('typography: curly quotes and apostrophes, no-break spaces in the master.json nobreak phrases, emphasised target title', () => {
  const v2 = structuredClone(variant);
  v2.summary.text = 'One team\'s "move fast" rule for a 2 billion event pipeline, SOC 2 and PCI DSS controls.';
  const html = renderHtml(assemble(master, v2), '');
  assert.match(html, /team’s “move fast”/);
  assert.match(html, /2 billion/);
  assert.match(html, /SOC 2/);
  assert.match(html, /PCI DSS/);
  assert.doesNotMatch(renderHtml(assemble({ ...master, nobreak: [] }, v2), ''), /SOC 2/, 'no nobreak list: plain spaces');
  const v3 = structuredClone(variant); v3.summary.text = 'Led three teams of 10–25 engineers through the 2020–21 migration.';
  const h3 = renderHtml(assemble(master, v3), '');
  assert.match(h3, /<span class="nb">10–25<\/span> engineers .*<span class="nb">2020–21<\/span>/, 'numeric ranges never break at the dash');
  assert.doesNotMatch(h3, /⁠/, 'no invisible characters reach the text layer');
  assert.match(html, /<span class="ht">Head of Engineering<\/span>/);
  for (const attr of html.match(/content="[^"]*"/g)) assert.doesNotMatch(attr, /[‘’“”]/, 'attributes keep plain quotes');
  assert.equal(displayText('SOC 2 "ready"', ['SOC 2']), 'SOC 2 “ready”', 'the docx copy gets the same display text');
});

test('extracted-text check treats curly and straight quotes as equal', () => {
  const model = assemble(master, { ...variant, earlier: [] });
  model.roles[1].title = "Director of Engineering's";
  const text = ['Jordan Example', 'jordan@example.com', 'SUMMARY', 'CAREER HIGHLIGHTS', 'SKILLS', 'Platform: x', 'Leadership: y', 'EXPERIENCE',
    'Head of Engineering · Acme Corp', 'Mar 2023 - Present', 'Director of Engineering’s · Globex', 'Jan 2019 - Feb 2023', 'EDUCATION'].join('\n');
  assert.deepEqual(checkExtracted(text, model), []);
});

test('extracted-text check looks for roles only after the EXPERIENCE heading', () => {
  const model = assemble(master, variant);
  const text = [
    'Jordan Example', 'jordan@example.com', 'SUMMARY', 'Head of Engineering · Acme Corp, and before that Globex.',
    'CAREER HIGHLIGHTS', 'SKILLS', 'Platform: AWS, PostgreSQL', 'Leadership: hiring plans', 'EXPERIENCE',
    'Head of Engineering · Acme Corp Mar 2023 – Present',
    'Director of Engineering · Globex Jan 2019 – Feb 2023', 'Software Engineer · Soylent Systems · 2008 - 2010. Supply chain web applications.',
    'EDUCATION',
  ].join('\n');
  assert.deepEqual(checkExtracted(text, model), []);
});

test('lint catches the fixture never-claim patterns and sentence rules', () => {
  const rules = JSON.parse(readFileSync(new URL('collateral/cv/never-claim.json', FIX), 'utf8'));
  const hits = (t) => lintText(t, rules).map((h) => h.id);
  assert.ok(hits('Call me at (555) 555-0199.').includes('phone'));
  assert.ok(hits('Contact jordan@oldmail.example').includes('old-email'));
  assert.ok(hits('Led 500+ engineers across regions.').includes('team-inflation'));
  assert.ok(hits('The model reached 94% accuracy.').includes('accuracy-pct'));
  assert.ok(hits('Former CTO at Globex.').includes('cto-title'));
  assert.ok(hits('Shipped an LLM feature to every customer.').includes('ai-human-check'));
  assert.deepEqual(hits('Shipped an LLM feature with an evaluation set built before launch.'), [], 'an AI claim that names its check passes');
  assert.deepEqual(hits('Led 60 engineers through a move of 140 services to AWS.'), []);
});

test('earlier roles render as one paragraph each with inline dates; sub-heads group with their bullets', () => {
  const html = renderHtml(assemble(master, variant), '');
  assert.match(html, /<p class="role early"><span class="role-title">Software Engineer<\/span><span class="role-sep"> · <\/span><span class="role-company">Soylent Systems<\/span><span class="role-sep"> · <\/span><span class="early-dates">2008 – 2010<\/span><span class="early-line">\. Supply chain web applications\.<\/span><\/p>/);
  assert.match(html, /<div class="sub-group"><div class="sub-head"><span>Platform and reliability<\/span>[^]*?<\/ul><\/div>/);
});

test('coverage matches keyword alternatives, case- and hyphen-insensitive', () => {
  const c = coverage('Head of Engineering. Hiring, AWS and PostgreSQL.', variant.target_keywords);
  assert.deepEqual(c.missing, ['Rust']);
  assert.equal(c.pct, 80);
});

test('coverage tolerates plurals: "roadmap" matches "roadmaps", "startup" matches "startups"', () => {
  const c = coverage('Owns product roadmaps for startups.', ['roadmap', 'startup', 'roadmapping tool']);
  assert.deepEqual(c.matched, ['roadmap', 'startup']);
});

test('extracted-text check: name first, headings in order, each title followed by its dates', () => {
  const model = assemble(master, variant);
  const good = [
    'Jordan Example', 'Head of Engineering · Scaling Teams and Delivery', 'Springfield, IL · Remote (US) · jordan@example.com · linkedin.com/in/jordan-example',
    'SUMMARY', 'Engineering leader with 17 years in software.', 'CAREER HIGHLIGHTS', 'Scaling: grew a team of 12 into six teams.',
    'SKILLS', 'Platform: AWS, PostgreSQL', 'Leadership: hiring plans',
    'EXPERIENCE', 'Head of Engineering · Acme Corp', 'Mar 2023 - Present', 'B2B workflow software.',
    'Director of Engineering · Globex', 'Jan 2019 - Feb 2023', 'Software Engineer · Soylent Systems · 2008 - 2010. Supply chain web applications.',
    'EDUCATION', 'B.S. Computer Science',
  ].join('\n');
  assert.deepEqual(checkExtracted(good, model), []);
  const swapped = good.replace('SKILLS', 'XSKILLS').replace('Mar 2023 - Present\n', '');
  const errs = checkExtracted(swapped, model).join('\n');
  assert.match(errs, /SKILLS/);
  assert.match(errs, /Head of Engineering/);
});

test('JD match ranks the CV that covers more of the JD vocabulary first', () => {
  const a = { slug: 'a', text: 'head of engineering hands-on TypeScript Postgres', keywords: ['head of engineering', 'hands-on', 'TypeScript', 'Postgres'] };
  const b = { slug: 'b', text: 'head of engineering stakeholder management delivery management', keywords: ['stakeholder management', 'delivery management'] };
  const jd = 'We need a hands-on head of engineering, TypeScript and Postgres, shipping fast.';
  const r = rankForJd(jd, [b, a]);
  assert.equal(r[0].slug, 'a');
  assert.equal(r[0].pct, 100);
  assert.deepEqual(r[1].missing.sort(), ['Postgres', 'TypeScript', 'hands-on'].sort());
});

test('modelText flattens everything a recruiter reads, for lint and coverage', () => {
  const t = modelText(assemble(master, variant));
  for (const s of ['Engineering leader with 17 years', 'AI-assisted code review', 'hiring plans', 'Supply chain web applications.']) assert.ok(t.includes(s), s);
});

test('page split check: a role broken across pages keeps at least 2 bullets on each side', () => {
  const model = assemble(master, variant);
  const head = 'Head of Engineering · Acme Corp Mar 2023 – Present';
  const p1 = (n) => ['EXPERIENCE', head, 'B2B workflow software.', ...Array.from({ length: n }, (_, i) => `• bullet ${i}`), 'Jordan Example · Head of Engineering · jordan@example.com 1 / 2'].join('\n');
  const p2 = (n) => [...Array.from({ length: n }, (_, i) => `• more ${i}`), 'Director of Engineering · Globex Jan 2019 – Feb 2023'].join('\n');
  assert.deepEqual(checkPageSplit(p1(2), p2(2), model), []);
  assert.match(checkPageSplit(p1(1), p2(3), model).join(), /Head of Engineering.*1 bullet.*page 1/);
  assert.match(checkPageSplit(p1(3), p2(1), model).join(), /1 bullet.*page 2/);
  assert.deepEqual(checkPageSplit(p1(1), 'Director of Engineering · Globex Jan 2019 – Feb 2023', model), [], 'a clean break between roles is fine');
});

test('variantPool: targeted CVs join the standard pool; a candidate joins alone; slugs never collide', () => {
  const std = [{ slug: 'head-of-engineering' }, { slug: 'platform-director' }];
  const extra = [{ slug: 'list-a-vp' }, { slug: 'list-a-director' }];
  assert.deepEqual(variantPool(std, extra).map((v) => v.slug), ['head-of-engineering', 'platform-director', 'list-a-vp', 'list-a-director']);
  assert.deepEqual(variantPool(std, extra, 'list-a-director').map((v) => v.slug), ['head-of-engineering', 'platform-director', 'list-a-director']);
  assert.deepEqual(variantPool(std, [], 'head-of-engineering').map((v) => v.slug), ['head-of-engineering', 'platform-director'], 'a standard candidate leaves the pool as it is');
  assert.throws(() => variantPool(std, [{ slug: 'head-of-engineering' }]), /duplicate CV slug head-of-engineering/);
});

test('cvPerson: the profile identity, with master.json person fields over it where set', () => {
  const profile = { name: 'Jordan Example', email: 'jordan@example.com', application_email: 'Jobs@Example.com', location: { display: 'Springfield, IL' }, workplace: 'Remote (US)', links: { linkedin: 'https://www.linkedin.com/in/jordan-example/' } };
  assert.deepEqual(cvPerson(profile, { claims: ['C01'] }), { name: 'Jordan Example', location: 'Springfield, IL', workplace: 'Remote (US)', email: 'Jobs@Example.com', linkedin: 'linkedin.com/in/jordan-example', claims: ['C01'] });
  assert.equal(cvPerson(profile, { workplace: 'Hybrid (Springfield)', location: '' }).workplace, 'Hybrid (Springfield)');
  assert.equal(cvPerson(profile, { location: '' }).location, 'Springfield, IL', 'an empty master field does not blank the profile value');
  assert.equal(cvPerson({ location: { city: 'Springfield', region: 'IL' } }).location, 'Springfield, IL');
});

test('paper: letter by default, a4 on request; the sheet size reaches the CSS and @page', () => {
  assert.equal(paperOf().name, 'letter');
  assert.equal(paperOf('A4').name, 'a4');
  assert.equal(paperOf('legal').name, 'letter', 'an unknown size falls back to letter');
  assert.deepEqual(PAPER.letter.pt, [612, 792]);
  assert.match(sheetCss(paperOf('a4')), /--sheet-w: 210mm; --sheet-h: 297mm/);
  assert.equal(pageRuleCss(paperOf('a4')), '@page { size: A4; margin: 0; }');
  assert.equal(pageRuleCss(), '@page { size: letter; margin: 0; }');
});

test('inlineFonts turns every font url() into a data: URI and fails on a missing file', () => {
  const css = '@font-face { src: url("../fonts/a.woff2") format("woff2"); } @font-face { src: url(b.ttf); } .x { background: url(img.png); }';
  const out = inlineFonts(css, (n) => (n === 'a.woff2' ? Buffer.from('A') : n === 'b.ttf' ? Buffer.from('B') : null));
  assert.match(out, /url\(data:font\/woff2;base64,QQ==\) format\("woff2"\)/);
  assert.match(out, /url\(data:font\/ttf;base64,Qg==\)/);
  assert.match(out, /url\(img\.png\)/, 'a non-font url is left alone');
  assert.throws(() => inlineFonts('src: url(c.woff2)', () => null), /font file c\.woff2 not found/);
});

test('the PDF footer template escapes its text and carries page counters', () => {
  const f = pdfFooterTemplate('Jordan Example · <Head> · jordan@example.com', { fontFaceCss: '@font-face{}' });
  assert.match(f, /^<style>@font-face\{\}<\/style>/);
  assert.match(f, /Jordan Example · &lt;Head&gt; · jordan@example\.com/);
  assert.match(f, /<span class="pageNumber"><\/span> \/ <span class="totalPages"><\/span>/);
});
