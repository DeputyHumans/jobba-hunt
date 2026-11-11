# Query Probe Method

A query set (`config/searches.json`, `config/dice-searches.json`) changes only through a probe: a live test of candidate queries, judged by rules written before any data exists. `/hunt-probe` runs this procedure. Never tune a query set from intuition.

Paths: `scripts/`, `templates/` and `docs/` are repo-relative; `config/`, `data/` and the report folder `docs/probes/` are workspace-relative.

## When to probe

| Trigger | Source |
|---|---|
| Onboarding phase 9 | Every new workspace. The ticks refuse (`not-verified`) until a probe sets `verified: true` |
| Any change to a query set | Change control (`docs/runbook.md`) |
| A scope change (engagement types, location, lanes, seniority) | The same day. A scope that never reaches the search filters silently misses roles |
| A query with 0 survivors for 2 weeks | Weekly query health |
| The classic LinkedIn endpoint redirects or announces a date | Weekly classic search watch |
| `canary-failed` or `canary-empty` | `docs/runbook.md` section 5 (the canary check probe) |

## Procedure

| # | Step | Output |
|---|---|---|
| 1 | **Reason.** Write the question the probe must decide and what it may change | Report section 1 (`templates/probe-report.md`) |
| 2 | **Decision rules**, written and saved before any data: what counts as kept, the slot threshold, the overlap rule, the slot budget, the canary rule, what the views measure, the fallback. Relevance labels too, if any | Report section 2, dated |
| 3 | **Candidates.** `config/probes/YYYYMMDD-<platform>-probe-<x>.json`: `{ name, source?, tpr_seconds, defaults: { geo, workplace }, views, already_viewed, searches: [{ id, keywords, geo?, workplace?, job_type?, params?, base_url?, capture?, view_sample?: { n, where } }] }`. `"source": "dice"` runs it on Dice. Check each against the syntax rules (`docs/platforms.md`) | Probe file, report section 3 |
| 4 | **Dry run.** `npm run probe -- --file <file> --dry-run` | The planned loads, inside the caps |
| 5 | **Headed run.** `npm run probe -- --file <file> --headed`. Same caps, pacing and guards as a sweep. It never touches `jobs.json` or the sweep cap (unless `--into-state`). No sweep that day | `data/probes/<stamp>-<x>.json`, captures |
| 6 | **Metrics.** `npm run probe-report -- data/probes/<files> [--exclude-company <name>] --cards` | Per query: header count, cards, kept, kept %, unique kept, most overlap (containment matrix), views |
| 7 | **Verdicts.** Apply each rule as written, to every query the same way. One verdict per query: adopt, merge, drop | Report section 6 |
| 8 | **Config edit.** Change the query set as the verdicts say, save the dated report, then `npm run probe -- --mark-verified data/probes/<result>.json --report <report path>`: it sets `verified: true` (with `verified_at`, `verified_by`) in `config/searches.json`, or `config/dice-searches.json` for a Dice probe. It refuses a probe that did not finish | `docs/probes/YYYYMMDD-<platform>-<topic>-probe-report.md`, the config |

Selector checks need no page load: `node scripts/replay-capture.mjs data/captures/<file>.html [--all]`.

## Default decision rules

Copy them into the report and adjust the numbers before the run, never after.

| # | Rule |
|---|---|
| R1 | **Kept** = a card whose prefilter verdict is not `drop`, under the `config/prefilter.json` in force on the probe date |
| R2 | A query keeps a slot when its 7-day page holds **2 or more kept cards** and a **kept share of 15% or more** |
| R3 | A query that passes R2 loses its slot when **80% or more** of its kept cards also appear in a query already chosen. Queries are chosen in descending order of kept count. When adding to a live set, the live queries count as already chosen and the bar is **60%** |
| R4 | **At most N queries** join, where N fits the budget: ticks per day in `config/limits.json`, less the canary share (`tick.canary_every`), must run each query at least once a day. Ties go to more Easy Apply kept cards |
| R5 | **The canary** is the chosen query with the highest card count, if 20 or more. On LinkedIn prefer the AI search endpoint: semantic search is never legitimately empty, so an empty page means rot or throttling |
| R6 | **Views measure structure**, 1-2 kept cards per query: the share whose engagement type is in `preferences.engagement.accept`. Under half: the report says so, and the prefilter is revisited in a second probe, never tuned here |
| R7 | **Fallback.** If no query passes R2, the set stays as it is (or the lane moves to another platform), and the report says so |

**Coverage variant** (finding roles the live set misses): adopt a search when page 1 holds **at least 8 never-seen, prefilter-kept roles** and **no more than 60% of it is covered by another search**.

**Syntax gate:** a candidate that needs `AND`, `f_JT` on a fractional phrase, or `"A" OR "B"` on Dice is not adopted, whatever its numbers.

## Metric hygiene

- A metric changed after the data was read is recorded in the report with the reason, and must not change the rule's intent.
- Small samples (a handful of relevant roles in one week) are re-measured after two weeks of ticks before anything else is dropped.
- A no-results page with promoted filler cards is `empty`, not a result.
- Cards that pass on structure but are not the work (for example expert-network or AI-training postings with leadership titles) are excluded with `--exclude-company`, added to `company_drop`, and flagged in the report as a judgment call for the operator.
- A cap override for a probe happens only on the operator's explicit instruction (`docs/runbook.md` section 6), and the report names it.

## Process deviation

When a probe ran without rules written beforehand:
1. The report gets a "Process deviations" section that says so plainly.
2. It states the rule applied after the fact.
3. It applies that rule the same way to every query in the probe, with no exceptions for favoured queries. A query adopted against the rule says why (for example, it replaces a live query one for one, so the query count stays the same).
4. The weekly query-health check is the backstop: a wrongly adopted query shows 0 survivors within two weeks and goes into the next probe.

## After adoption

- The first live week of each new query is its check. A page 1 with fewer than 5 never-seen kept roles after the first week marks it for review.
- The same client posted through several recruiters is flagged in triage, so the operator picks one channel.
