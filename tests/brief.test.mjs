// Prep briefs (scripts/lib/brief.mjs): claim chips in text only, retired and unknown claims caught,
// numbered sections, glossary hints placed once, claims table filled from the placeholder, brand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaimBank, splitBrief, heroParts, claimUse, fillClaims, renderBriefHtml, unlinkedCvMentions, CLAIMS_PLACEHOLDER } from '../scripts/lib/brief.mjs';

const bankMd = [
  '| ID | Claim | Category | Source | Status | Never say |',
  '|---|---|---|---|---|---|',
  '| C14 | Runs two AI features in production at Acme Corp. | ai | CV:16 | CV | User or revenue numbers |',
  '| C20 | **Retired (fictional): kept so the ID stays reserved.** Was: something. | leadership | CV:1 | Retired | All of it |',
  '| C80 | Wrote the review checklist for AI-generated code. | ai | user:2026-11-01 | user-confirmed | Which team uses which checklist |',
  '| C81 | Pending wording, not confirmed yet. | ai | src:cv.pdf#p2 | pending | All of it |',
].join('\n');
const bank = parseClaimBank(bankMd);
const assets = { css: '.x{}', sansWoff2: Buffer.from('s'), monoWoff2: Buffer.from('m'), mark: null, wordmark: 'Jordan Example', kicker: 'Job hunt', accent: '#2F5D8A', operator: 'Jordan' };
const MARK = { viewBox: '-5 -5 34 34', frame: { x: 3, y: 3, size: 18, strokeWidth: 2 }, seal: { x: 10, y: 10, size: 7 } };
const brief = (body) => `---\ntitle: X\ncall: "Mon 16 Nov 2026 · 1:30 PM PT"\n---\n\n# Acme: Staff Engineer, AI, recruiter screen brief\n\n${body}`;

test('the bank leaves retired and unconfirmed claims out', () => {
  assert.deepEqual([...bank.keys()], ['C14', 'C80']);
  assert.equal(bank.get('C80').status, 'user-confirmed');
  assert.deepEqual(claimUse('C81', bank).unknown, ['C81'], 'a pending claim is not citable');
});

test('front matter, H1 and hero parts', () => {
  const { front, h1 } = splitBrief(brief('## 1. At a glance\n'));
  assert.equal(front.call, 'Mon 16 Nov 2026 · 1:30 PM PT');
  assert.deepEqual(heroParts(h1), { company: 'Acme', role: 'Staff Engineer, AI' });
});

test('unknown and retired claims are reported', () => {
  assert.deepEqual(claimUse('C14, C20 and C99, then C14', bank), { order: ['C14'], unknown: ['C20', 'C99'] });
});

test('the claims placeholder becomes a table of the claims cited', () => {
  const md = fillClaims(`Uses C80 then C14.\n\n${CLAIMS_PLACEHOLDER}\n`, bank);
  assert.match(md, /\| C80 \| Wrote the review checklist[^\n]*\n\| C14 \|/);
  assert.equal(fillClaims('no placeholder C14', bank), 'no placeholder C14');
});

test('chips land in text only, with one popover per claim and the sections that use it', () => {
  const md = brief('## 1. At a glance\n\nAnswer (C14, C80). See [link](https://example.com/C14).\n\n## 2. More\n\n| Item | Value |\n|---|---|\n| A | C14 |\n\n`C80 in code`\n');
  const { html, claims, sections, unknown } = renderBriefHtml({ md, bank, assets, builtAt: '2026-11-16T21:00:00Z' });
  assert.equal(sections, 3);
  assert.equal(claims, 2);
  assert.match(html, /<section id="claim-reference">[\s\S]*class="chips chip-grid"><button[^>]*pop-C14[^>]*>C14<\/button><button[^>]*pop-C80/);
  assert.match(html, /href="#claim-reference"><span class="index">03<\/span>/);
  assert.deepEqual(unknown, []);
  assert.match(html, /href="https:\/\/example.com\/C14"/);
  assert.match(html, /<code>C80 in code<\/code>/);
  assert.equal((html.match(/popover id="pop-C14"/g) || []).length, 1);
  assert.match(html, /id="pop-C14"[\s\S]*?Used in<\/dt><dd>§1 · §2</);
  assert.match(html, /<table class="data-table kv">/);
  assert.match(html, /<section id="s2-more">/);
  assert.match(html, /<h1>Acme, <em>Staff Engineer, AI<\/em><\/h1>/);
});

test('a code span of claim IDs is a chip group; the generated claims table is not checked', () => {
  const md = brief(`## 1. A\n\nPitch.\n\n\`C14 C80\`\n\n| ID | Claim (start of the exact wording) | Source (claim bank) |\n|---|---|---|\n| C14 | Builds. | formerly part of C20 |\n`);
  const { html, unknown } = renderBriefHtml({ md, bank, assets, builtAt: '2026-11-16T21:00:00Z' });
  assert.deepEqual(unknown, []);
  assert.match(html, /<span class="chips"><button[^>]*pop-C14[^>]*>C14<\/button> <button[^>]*pop-C80/);
});

test('a glossary term gets one hint per paragraph, none in headings, and a Terms grid', () => {
  const md = brief('## 1. RAG notes\n\nRAG here, RAG again (C14).\n\nRAG in a new paragraph.\n');
  const { html, terms } = renderBriefHtml({ md, bank, assets, builtAt: '2026-11-16T21:00:00Z', glossary: [{ term: 'RAG', def: 'Retrieval-augmented generation.', here: 'Their search.' }] });
  assert.equal(terms, 1);
  assert.equal((html.match(/class="term"/g) || []).length, 2);
  assert.match(html, /<h3 id="terms">Terms<\/h3>[\s\S]*popovertarget="term-rag">RAG<\/button>/);
  assert.match(html, /<h2>RAG notes<\/h2>/);
  assert.match(html, /id="term-rag" popover class="claim-pop term-pop"/);
});

test('a CV variant named outside a link is flagged; a linked one and front matter are not', () => {
  const md = '---\nrelated_docs:\n  - ../cv/variants/head-of-engineering.json\n---\n\nSent [`head-of-engineering` v3](https://bikeshed.now/d/x/v3).\nAlso `platform-director` here.\n';
  assert.deepEqual(unlinkedCvMentions(md, ['head-of-engineering', 'platform-director']), [{ line: 7, slug: 'platform-director' }]);
});

test('brand: text wordmark by default; a mark, the kicker, the accent and the operator when given; no repo path', () => {
  const md = brief('## 1. A\n\nPitch (C14).\n');
  const plain = renderBriefHtml({ md, bank, assets, builtAt: '2026-11-16T21:00:00Z' }).html;
  assert.match(plain, /<span class="wordmark" aria-label="Jordan Example">Jordan Example<\/span>/);
  assert.doesNotMatch(plain, /<svg/);
  assert.match(plain, /<span class="kicker">Job hunt · Interview brief<\/span>/);
  assert.match(plain, /:root\{--accent:#2F5D8A\}<\/style>/);
  assert.match(plain, /<footer>Private prep document for Jordan\. Source: the brief markdown and collateral\/claim-bank\.md\. Built 2026-11-16 21:00 UTC\.<\/footer>/);
  const marked = renderBriefHtml({ md, bank, assets: { ...assets, mark: MARK, wordmark: 'Example Studio.', accent: 'red' }, builtAt: '2026-11-16T21:00:00Z' }).html;
  assert.match(marked, /<svg viewBox="-5 -5 34 34"[\s\S]*?<span class="wordmark-name"><span>Example<\/span><span>Studio<span class="period">\.<\/span><\/span><\/span>/);
  assert.doesNotMatch(marked, /--accent:red/, 'only a hex accent is used');
});
