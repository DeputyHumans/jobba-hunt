---
name: hunt-probe
description: "Use whenever a LinkedIn or Dice query set must change or be verified: onboarding phase 9, a new or changed query, a scope change (engagement types, location, lanes, seniority), a query with 0 survivors for 2 weeks, the classic LinkedIn endpoint redirecting, or a canary failure. Runs the query probe method: the question and decision rules written and saved before any data, a dry run, one paced headed run, metrics from probe-report, one verdict per query by the written rules, then the config edit and the verified mark. A query set never changes from intuition."
---

# /hunt-probe <linkedin | dice> <topic>

Run from the repo root. Read `CLAUDE.md` first, then `docs/query-probe-method.md` (the method and the default rules) and the query syntax table in `docs/platforms.md`. Paths starting `workspace/` are in the workspace (`$JOBBA_HOME` when set); `config/` and `data/` in a command resolve there too.

| Exit (`npm run probe`) | Meaning | Action |
|---|---|---|
| 0 | Done (or a dry run) | Next step |
| 1 | Aborted by a guard | The platform is halted. Follow `docs/runbook.md` section 5 for the abort named. The probe result keeps what was read; it cannot verify a set |
| 2 | Refused: not enough cap left today for the whole probe, or `--mark-verified` on a probe that did not finish, or a workspace config with no own canary and queries | Run after the cap reset, or fix the cause named. Never override a cap without the operator's explicit instruction (`docs/runbook.md` section 6) |
| 3 | Profile busy | Run later. Never loop |

## Before any data (report sections 1 to 3)
1. **Start the report** from `templates/probe-report.md` as `workspace/docs/probes/YYYYMMDD-<platform>-<topic>-probe-report.md`.
2. **Reason (section 1):** the question the probe must decide, its trigger, the probe file, the config it may change.
3. **Decision rules (section 2):** copy R1 to R7 from `docs/query-probe-method.md` and set the numbers now: what counts as kept, the slot threshold, the overlap bar, the slot budget N (ticks per day in `config/limits.json` less the canary share `tick.canary_every`, each query at least once a day), the canary rule, what the views measure, the fallback. Define relevance labels here if the report uses any. Date the section and save the file before the run. For a coverage probe, use the coverage variant.
4. **Candidates (section 3):** write `workspace/config/probes/YYYYMMDD-<platform>-probe-<x>.json`:
   - `{ name, source?, tpr_seconds, defaults: { geo, workplace }, views, already_viewed, searches: [{ id, keywords, geo?, workplace?, job_type?, params?, base_url?, capture?, view_sample?: { n, where } }] }`.
   - Dice: `"source": "dice"`; `view_sample.where: "kept"` counts prefilter-kept roles.
   - Syntax gate per `docs/platforms.md`: LinkedIn phrases quoted, `OR` allowed, never `AND`, no `f_JT` on fractional phrases; Dice never `"A" OR "B"`. A candidate that fails the gate is not run.
   - Add the live queries when the probe compares against the current set.

## Run
5. **Dry run:** `npm run -s probe -- --file config/probes/<file>.json --dry-run`. It prints every planned load and the caps left. The whole probe must fit inside today's caps (`npm run -s jobs -- limits`, `npm run -s dice -- limits`): the live run refuses up front rather than run out halfway.
6. **Headed run:** `npm run -s probe -- --file config/probes/<file>.json --headed` (Bash timeout 600000, in the background when it may run longer). The same caps, pacing and guards as a sweep. It never touches the job state or the sweep cap.
   - One probe at a time, never parallel to a tick, a sweep or another probe. No sweep that day.
   - `--into-state` (Dice only) writes the cards and views into the job state for a one-time scan before the loop starts: only on the operator's instruction.
   - Output: `workspace/data/probes/<stamp>-<name>.json`, rewritten after every page load.

## Judge
7. **Metrics:** `npm run -s probe-report -- data/probes/<files> --cards [--exclude-company "<regex>"]`. Per query: header count, cards, kept, kept %, unique kept, most overlap (containment matrix), and the views table. Paste it into section 5.
   - `--exclude-company` is for cards that pass on structure but are not the work (expert networks, AI-training marketplaces). Each exclusion is flagged in the report as a judgment call for the operator, and the company goes into `config/prefilter.json` `company_drop` only on the operator's yes.
8. **Verdicts (section 6):** apply each rule as written, the same way to every query. One verdict per query: adopt, merge, or drop. A rule changed after the data was read is recorded with the reason under "Process deviations" and must keep the rule's intent.
9. **Fallback:** no query passes R2: the set stays as it is (or the lane moves to another platform), and the report says so.

## Config edit
10. Write the adopted canary and queries into the workspace file (`workspace/config/searches.json`, or `dice-searches.json` for a Dice probe) exactly as the verdicts say (section 7). Never touch `verified` by hand.
11. Write the Summary, section 8 (deviations, or "None") and section 9 (next checks: the first live week of each new query, with its threshold and date).
12. Mark it verified: `npm run -s probe -- --mark-verified data/probes/<result>.json --report docs/probes/<report>.md`. It refuses an aborted or unfinished probe, and a workspace config with no own canary and queries. The action log records `search.verified`.

## Canary failures (`canary-failed`, `canary-empty`, `throttle-suspect`)
The day after the abort: `npm run -s probe -- --file config/probes/canary-check.json --headed`, then `node scripts/replay-capture.mjs <its capture under data/captures/> --all`. Cards on screen but 0 parsed: selector rot (a code change, `docs/runbook.md` change control). Nothing on screen: throttling, pause 3 days. "No matching jobs" on the semantic canary: the endpoint changed; run this probe procedure on the canary.

## Never
- Write or adjust a decision rule after reading the data without recording it as a deviation.
- Run `AND` on LinkedIn or `"A" OR "B"` on Dice.
- Set `verified` by hand, or edit a query set without a probe report.
- Run probes in parallel, retry a refused probe the same day, or raise a cap for a probe without the operator's explicit instruction.
