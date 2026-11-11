#!/usr/bin/env node
// Offline selector check: replays the live collectors (collectCards / collectView from
// linkedin-jobs.mjs) against a page saved with --capture, so selector fixes are verified
// without spending a LinkedIn page load. Throwaway browser: no profile, page scripts
// stripped, every network request aborted. Nothing here talks to LinkedIn.
//
// Usage: node scripts/replay-capture.mjs <data>/captures/<stamp>-search.html [--all]
//        node scripts/replay-capture.mjs <data>/captures/<stamp>-view.html
// The path resolves against the repo, then the workspace.

import './lib/env.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { out, fail, PINNED_BINARY } from './cloak-core.mjs';
import { display, resolveArgPath } from './lib/paths.mjs';
import { collectCards, collectView, SEL_ARG, JOBS_SEL } from './linkedin-jobs.mjs';
import { parseCardText, parseTopCard, classifySearch, isEmptyMarkerText, parseResultCount, applyTypeOf, alreadyAppliedIn } from './lib/extract.mjs';

const arg = process.argv[2];
if (!arg) fail('usage: replay-capture.mjs <capture.html>');
const file = resolveArgPath(arg);
const kind = /-view\.html$/.test(file) ? 'view' : 'search';
// Strip scripts and the CSP / trusted-types metas (they block a local load), then load the
// copy from a temp dir over file://.
const html = readFileSync(file, 'utf8')
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]+(http-equiv="content-security-policy"|name="trusted-types")[^>]*>/gi, '');
const tmp = mkdtempSync(join(tmpdir(), 'jobba-replay-'));
const local = join(tmp, 'page.html');
writeFileSync(local, html);

const { launch } = await import('cloakbrowser');
const browser = await launch({ headless: true, browserVersion: PINNED_BINARY });
try {
  const page = await browser.newPage();
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(local).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (kind === 'search') {
    const snap = await page.evaluate(collectCards, SEL_ARG);
    const emptyMarker = isEmptyMarkerText(`${snap.outsideText}\n${snap.mainText}`);
    const cards = snap.cards.map(([job_id, text]) => ({ job_id, ...parseCardText(text) }));
    out({
      kind, file: display(file),
      status: classifySearch({ url: 'https://www.linkedin.com/jobs/search/', loggedOut: false, idCount: cards.length, emptyMarker }),
      empty_marker: emptyMarker, result_count: parseResultCount(snap.countText || snap.mainText), used_list_items: snap.usedListItems,
      cards: cards.length, sample: process.argv.includes('--all') ? cards : cards.slice(0, 3),
    });
  } else {
    const v = await page.evaluate(collectView, SEL_ARG);
    out({
      kind, file: display(file), title: v.title, company: v.company, closed: JOBS_SEL.closedMarker.test(v.main_text),
      apply: applyTypeOf({ label: v.apply_label, href: v.apply_href }), apply_label: v.apply_label, already_applied: alreadyAppliedIn(v.main_text),
      ...parseTopCard(v.top_card_text),
      description_chars: v.description_text.length, description_head: v.description_text.slice(0, 160),
      status: v.title && v.description_text.length >= 100 ? 'ok' : 'unreadable',
    });
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
