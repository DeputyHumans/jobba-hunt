#!/usr/bin/env node
// Interview and call prep brief builder. Renders a /hunt-interview brief
// (<workspace>/pipeline/interviews/<date>-<company>-<role>-<stage>-brief.md) into the designed
// HTML page next to it: numbered sections, claim IDs as chips that open the exact claim-bank
// wording, optional glossary hints. Fails on a claim ID the bank does not hold or holds as retired.
// Brand: brand/brief.css and the fonts (a workspace brand/ file wins), preferences.brand
// (wordmark, title, accent), and a mark only when the workspace brand folder holds mark.json.
//
// Usage: npm run brief -- <brief.md> [--glossary <terms.json>] [--out <brief.html>] [--write-claims]
//   --glossary      { "terms": [{ "term", "def", "here" }] }. Default: <stem>-glossary.json next to the
//                   brief (the stem drops "-brief" and any "-screen"), when that file exists.
//   --write-claims  replaces the "**Claims** `[CLAIMS TABLE]`" placeholder in the markdown with the table
//                   of every claim it cites (the HTML gets the table either way).
// A CV variant named in the body outside a link is a warning: link the exact version sent instead.
// Publishing (bikeshed publisher): the HTML as its own private document in the tracker's folder,
//   npm run bikeshed -- publish <brief.html> --title "<Company> brief: <role> (<date time>)" --folder <config/tracker.json bikeshed.folder_id> --json
// and revise it with `npm run bikeshed -- update <docId> <brief.html>`.
// Exit 0 ok, 1 refused (unknown claim, missing file).

import './lib/env.mjs';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseClaimBank, renderBriefHtml, unlinkedCvMentions } from './lib/brief.mjs';
import { loadMark } from './lib/brand-mark.mjs';
import { parseArgs, out, fail } from './cloak-core.mjs';
import { COLLATERAL_DIR, CV_SRC, brandFile, display, resolveArgPath } from './lib/paths.mjs';
import { requireWorkspace } from './lib/config.mjs';
import { operatorName, person, preferences } from './lib/profile.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
try { requireWorkspace(); } catch (err) { fail(err.message); }

const src = positional[0] && resolveArgPath(positional[0]);
if (!src || !existsSync(src) || !src.endsWith('.md')) fail('usage: build-brief.mjs <brief.md> [--glossary <json>] [--out <html>] [--write-claims]');

const defaultGlossary = src.replace(/(-screen)?-brief\.md$/, '-glossary.json');
const glossaryPath = typeof flags.glossary === 'string' ? resolveArgPath(flags.glossary) : (defaultGlossary !== src && existsSync(defaultGlossary) ? defaultGlossary : null);
if (glossaryPath && !existsSync(glossaryPath)) fail(`no glossary at ${display(glossaryPath)}`);
const glossary = glossaryPath ? JSON.parse(readFileSync(glossaryPath, 'utf8')).terms || [] : [];

const md = readFileSync(src, 'utf8');
const bank = parseClaimBank(readFileSync(join(COLLATERAL_DIR, 'claim-bank.md'), 'utf8'));
const brand = preferences().brand || {};
const p = person();
const res = renderBriefHtml({
  md, bank, glossary, builtAt: new Date().toISOString(),
  assets: {
    css: readFileSync(brandFile('brief.css'), 'utf8'),
    sansWoff2: readFileSync(brandFile('fonts', 'instrument-sans-latin-wght-normal.woff2')),
    monoWoff2: readFileSync(brandFile('fonts', 'geist-mono-latin-wght-normal.woff2')),
    mark: loadMark(),
    wordmark: brand.wordmark || p.display_name || p.name || '',
    kicker: brand.title || 'Job hunt',
    accent: brand.accent,
    operator: operatorName(p),
  },
});
if (res.unknown.length) fail(`claims not in the bank (or retired): ${res.unknown.join(', ')}`, { unknown: res.unknown });

const variantsDir = join(CV_SRC, 'variants');
const slugs = existsSync(variantsDir) ? readdirSync(variantsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
const warnings = unlinkedCvMentions(md, slugs).map((m) => `line ${m.line}: CV \`${m.slug}\` is not a link to the version sent`);
for (const w of warnings) console.error(`warning: ${w}`);

const outPath = typeof flags.out === 'string' ? resolveArgPath(flags.out) : src.replace(/\.md$/, '.html');
writeFileSync(outPath, res.html);
const wroteClaims = Boolean(flags['write-claims']) && res.filledMd !== md;
if (wroteClaims) writeFileSync(src, res.filledMd);
out({ success: true, html: display(outPath), bytes: res.html.length, sections: res.sections, claims: res.claims, terms: res.terms, glossary: glossaryPath ? display(glossaryPath) : null, wrote_claims: wroteClaims, warnings });
