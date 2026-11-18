# Query Probe Method

A query set (`config/searches.json`, `config/dice-searches.json`) changes only through a probe: a live test of candidate queries, judged by rules written before any data exists. The rule is in AGENTS.md "Platform safety": "Query sets change only through a probe (`/hunt-probe`, `docs/query-probe-method.md`): rules written before the data, a dated report, then the config edit." `/hunt-probe` runs this procedure.

Paths: `scripts/`, `templates/` and `docs/` are repo-relative. `config/`, `data/` and the report folder `docs/probes/` are workspace-relative.

## When to probe

| Trigger | Source |
|---|---|
| Onboarding, `searches` phase | Every new workspace (`docs/setup.md` "Onboard"). A live `tick`, `dice-tick` or `sweep` refuses (exit 2, `cap: "not-verified"`) until a probe marks the set verified |
| Any change to a query set | `docs/runbook.md` "Change control" |
| A scope change (engagement types, location, lanes, seniority) | The same day. A scope that never reaches the search filters silently misses roles |
| A query with 0 survivors for 2 weeks | Query health, `docs/runbook.md` "Weekly review" |
| The classic LinkedIn endpoint redirects | Fired. `/jobs/search/` redirects to the AI search and drops `f_JT`, `f_WT` and `sortBy` (`docs/platforms.md` "LinkedIn"). The classic queries need a probe onto the AI search endpoint: candidates with `base_url` `https://www.linkedin.com/jobs/search-results/` |
| `canary-failed`, `canary-empty`, `throttle-suspect` | The canary check: `templates/workspace/config/probes/canary-check.json`, one headed, captured load of the AI-search canary, then a replay of its capture (`.agents/skills/hunt-probe/SKILL.md`, `docs/runbook.md` "Guards and actions") |

## Probe file

`config/probes/YYYYMMDD-<platform>-probe-<x>.json`. `--file` resolves against the repo, then the workspace.

| Key | Meaning |
|---|---|
| `name` | Names the result file |
| `source` | `"dice"` runs the probe on Dice (`--source dice` does too): `config/dice-searches.json`, the Dice reader and profile, the `dice_jobs` caps. Absent: LinkedIn |
| `report` | `"kept"` or `"leadership"`: picks the `probe-report` layout ("Report layouts" below). Default `kept` on Dice, `leadership` on LinkedIn |
| `tpr_seconds` | The posted window for every search. A search's own `tpr_seconds` wins |
| `defaults` | `{ geo, workplace }`, merged under each search |
| `views` | Explicit detail views: `[{ probe, job_id }]` |
| `already_viewed` | Job IDs an earlier probe day read. View samples skip them |
| `searches` | `[{ id, keywords, geo?, workplace?, employment?, job_type?, scope?, params?, base_url?, tpr_seconds?, capture?, view_sample?: { n, where } }]` |

Search fields:
- `employment` is Dice only. `job_type` is LinkedIn only.
- `params` are raw URL parameters, applied last.
- `capture: true` saves the page HTML and a screenshot under `data/captures/`, for a replay.
- `view_sample.where`: `any` (default), `lead` (a leadership title), `non-remote` or `kept` (prefilter verdict not `drop`).
- `scope` sets the prefilter scope of a LinkedIn search's cards: `generic` when `job_type` is set, else `scope`, default `fractional`. Dice cards use `dice`.

Check every search against `docs/platforms.md` "Query syntax" before the run.

## Procedure

| Step | What | Output |
|---|---|---|
| Reason | Write the question the probe must decide and what it may change | Report "Reason" (`templates/probe-report.md`) |
| Decision rules | Written and saved before any data: what counts as kept, the slot threshold, the overlap rule, the slot budget, the canary rule, what the views measure, the fallback. Relevance labels too, if any | Report "Decision rules", dated |
| Candidates | The probe file ("Probe file" above) | The probe file; report "Candidates" |
| Dry run | `npm run probe -- --file <file> --dry-run`. Prints every planned load and the caps left. Opens no browser; runs while paused or halted | The planned loads |
| Headed run | `npm run probe -- --file <file> --headed`. The same caps, pacing and guards as a sweep. One probe at a time, never beside a tick, a sweep or another probe. No sweep that day | `data/probes/YYYYMMDD-HHMM-<name>.json`, rewritten after every page load; captures |
| Metrics | `npm run probe-report -- data/probes/<files> --cards [--exclude-company "<regex>"]` | Report "Metrics" |
| Verdicts | Apply each rule as written, to every query the same way. One verdict per query: adopt, merge, drop | Report "Verdicts" |
| Config edit | Change the query set in the workspace file as the verdicts say. Save the dated report. Then `npm run probe -- --mark-verified data/probes/<result>.json --report <report path>` | `docs/probes/YYYYMMDD-<platform>-<topic>-probe-report.md`, the config |

What the headed run does and refuses:
- **Up front:** it refuses (exit 2) when the whole probe does not fit today's `searches_per_day` and `job_views_per_day` caps, so it never runs out halfway. It waits on the same stops as a tick: the source's halt (exit 5; LinkedIn `halt_until`, Dice `sources.dice.halt_until`, both in `data/state/jobs.json`), then the pause (exit 4, `config/pause.json`).
- **During the run:** each card carries its prefilter verdict, under the `config/prefilter.json` in force. Searches run first, then the views.
- **State:** it never writes `data/state/jobs.json` or the `sweeps_per_day` cap. The exception is `--into-state` (Dice only): a one-time Dice scan before the loop starts that writes the cards and views into the job state. It never moves a query window or the canary counter.
- **Abort:** a guard abort (exit 1) keeps what was already read, but that result can never verify a set. It halts the source like a tick abort (until the next reset, 7 days on a checkpoint or authwall) and logs `halt.set`. Follow the row for the abort in `docs/runbook.md` "Guards and actions". Stopping on the probe's own cap check (`cap-reached`) halts nothing.

What `--mark-verified` does:
- It sets `verified: true`, `verified_at`, `verified_by` (the result path) and, with `--report`, `verified_report`. The file is the workspace `config/searches.json`, or `config/dice-searches.json` for a Dice result.
- It refuses (exit 2) a result that did not finish cleanly: no `finished_at`, an abort, or no searches.
- It also refuses (exit 2) when the workspace config has no `canary` and `queries` of its own. The shipped examples are never verified.
- It logs `search.verified`, opens no browser, and runs while paused or halted.

### Exit codes (`npm run probe`)

| Exit | Meaning |
|---|---|
| 0 | Done, a dry run, or the set marked verified |
| 1 | Aborted by a guard (`aborted` names it), or an error (no `--file`, a file not found, `--into-state` on LinkedIn) |
| 2 | Refused: not enough cap left today for the whole probe, or `--mark-verified` refused |
| 3 | Profile busy. Not counted. Never loop |
| 4 | Paused |
| 5 | Halted |

### Selector checks

`node scripts/replay-capture.mjs data/captures/<file>.html [--all]` replays the LinkedIn collectors against a saved page, with no page load. It is LinkedIn only: Dice has no replay script.

## Report layouts

`npm run probe-report -- <result files> [--cards] [--json] [--exclude-company "<regex>"]` prints markdown. Paths resolve against the repo, then the workspace. The layout follows the files:
- **kept:** every file is a Dice probe or has `report: "kept"`. It serves Dice probes and LinkedIn hands-on probes.
- **leadership:** any other mix. It serves LinkedIn leadership probes.

| Layout | Per query | After the table | `--cards` | Other flags |
|---|---|---|---|---|
| kept | Status, Header, Cards, Kept, Kept %, Leadership, Hands-on, Easy Apply, Unique kept (kept roles no other query in the files returned), Covered by (the other query that holds the largest share of this query's kept roles, with that share) | The views: title and company, contract types, workplace, pay, apply type | Every card, `KEEP` or `drop` with the drop reasons | `--json` and `--exclude-company` do nothing |
| leadership | Filters, Status, Header, IDs, Trunc, Remote, Core, Fit, Relevant, Unique relevant (with the IDs) | A line for any query whose keywords LinkedIn rewrote (read from the final URL). The containment matrix (row: the % of its IDs that the column query also returned). The detail views: type, workplace, the scope signal in the text, comp, applicants | Every card labelled `FIT`, `core` or blank, plus `R` for a remote location | `--exclude-company "<regex>"` (case-insensitive) takes matching companies out of Relevant. `--json` prints rows, relevant, unique relevant, the matrix and the views |

Leadership labels (`scripts/lib/probe-metrics.mjs`, from `config/prefilter.json`):
- **Core:** a title in `probe_core_title`, else `title_exec`.
- **Fit:** core, plus a strict structure word in the title (`probe_strict_scope`, else `scope_signals`).
- **Relevant:** core, plus engagement structure from any source: a structure word in the title, the job-type filter, or a detail view showing a Contract, Part-time or Temporary tag or structure in the text.

R1 to R4 below count kept cards, which only the kept layout prints. Rules for a leadership probe name the leadership columns they use.

## Default decision rules

Copy them into the report and adjust the numbers before the run, never after.

| # | Rule |
|---|---|
| R1 | **Kept** = a card whose prefilter verdict is not `drop`, under the `config/prefilter.json` in force on the probe date. The probe saves each card's verdict when it runs |
| R2 | A query keeps a slot when its 7-day page holds **2 or more kept cards** and a **kept share of 15% or more** |
| R3 | A query that passes R2 loses its slot when **80% or more** of its kept cards also appear in a query already chosen. Queries are chosen in descending order of kept count. When adding to a live set, the live queries count as already chosen and the bar is **60%** |
| R4 | **At most N queries** join, where N fits the budget: ticks per day in `config/limits.json`, less the canary share (`tick.canary_every`), must run each query at least once a day. Ties go to more Easy Apply kept cards |
| R5 | **The canary** is the chosen query with the highest card count, if 20 or more. On LinkedIn prefer the AI search endpoint: semantic search is never legitimately empty, so an empty page means rot or throttling |
| R6 | **Views measure structure**, 1 or 2 kept cards per query: the share whose engagement type is in `preferences.engagement.accept`. Under half: the report says so, and the prefilter is revisited in a second probe, never tuned here |
| R7 | **Fallback.** If no query passes R2, the set stays as it is (or the lane moves to another platform), and the report says so |

**Coverage variant** (finding roles the live set misses): adopt a search when page 1 holds **at least 8 never-seen, prefilter-kept roles** and **no more than 60% of it is covered by another search**. Never-seen means the job ID is not in `data/state/jobs.json`. No tool computes it: the agent checks each kept card's ID against that file.

**Syntax gate:** a candidate that needs `AND`, `f_JT` on a fractional phrase, or `"A" OR "B"` on Dice is not adopted, whatever its numbers.

## Metric hygiene

- A metric changed after the data was read is recorded in the report with the reason, and must not change the rule's intent.
- Small samples (a handful of relevant roles in one week) are re-measured after two weeks of ticks before anything else is dropped.
- A no-results page with promoted filler cards is `empty`, not a result.
- Cards that pass on structure but are not the work (for example expert-network or AI-training postings with leadership titles) are flagged in the report as a judgment call for the operator. In the leadership layout, `--exclude-company` takes them out of Relevant. The company goes into `config/prefilter.json` `company_drop` only on the operator's yes.
- A cap override for a probe happens only on the operator's explicit instruction (`docs/runbook.md` "Halts, the pause and cap overrides"), and the report names it.

## Process deviation

When a probe ran without rules written beforehand:
1. The report gets a "Process deviations" section that says so plainly.
2. It states the rule applied after the fact.
3. It applies that rule the same way to every query in the probe, with no exceptions for favoured queries. A query adopted against the rule says why (for example, it replaces a live query one for one, so the query count stays the same).
4. The weekly query-health check is the backstop: a wrongly adopted query shows 0 survivors within two weeks and goes into the next probe.

## After adoption

- The first live week of each new query is its check. A page 1 with fewer than 5 never-seen kept roles after the first week marks it for review. The agent counts never-seen against `data/state/jobs.json`, as in the coverage variant.
- The same client posted through several recruiters is flagged in triage, so the operator picks one channel.
