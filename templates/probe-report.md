---
title: <Platform> Query Probe, <topic>
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: Draft
tags: [query-probe, <platform>]
---

# <Platform> Query Probe: <topic>

<!-- Method: docs/query-probe-method.md. Sections 1-3 are written and saved BEFORE any probe data exists. Saved in the workspace as docs/probes/YYYYMMDD-<platform>-<topic>-probe-report.md. -->

## Summary

<Two or three sentences, written last: what was asked, what was adopted, what changes in the config.>

## 1. Reason

| Item | Value |
|---|---|
| Question | <what this probe must decide> |
| Trigger | <change control item, scope change, weekly query-health finding, canary failure, onboarding> |
| Probe file | `config/probes/YYYYMMDD-<platform>-probe-<x>.json` |
| Config it may change | `config/searches.json` or `config/dice-searches.json` |

## 2. Decision rules (fixed YYYY-MM-DD, before any probe data)

| # | Rule |
|---|---|
| R1 | **Kept** = a card whose prefilter verdict is not `drop` under the `config/prefilter.json` in force today |
| R2 | A query keeps a slot when its 7-day page holds **2 or more kept cards** and a **kept share of 15% or more** |
| R3 | A query that passes R2 loses its slot when **80% or more** of its kept cards also appear in a query already chosen. Queries are chosen in descending order of kept count |
| R4 | **At most <N> queries** join the rotation (budget: `config/limits.json` searches per day against ticks per day and the canary share). Ties go to more Easy Apply kept cards |
| R5 | **The canary** is <rule: the chosen query with the most cards if 20 or more; else the current canary stays> |
| R6 | **Views (<n> per query) measure structure:** the share with an engagement type in `preferences.engagement.accept`. If under half, the report says so and the prefilter is revisited in a second probe, not tuned here |
| R7 | **Fallback:** if no query passes R2, <the set stays as it is / the lane moves to another platform> |

Relevance labels, if the report uses any (core, fit, relevant), are defined here too.

## 3. Candidates

| # | Keywords | Endpoint | Filters | Why |
|---|---|---|---|---|
| Q1 | | classic / AI search / dice | | |

Syntax check (docs/platforms.md): phrases quoted; no `AND`; no `f_JT` on fractional phrases; no `"A" OR "B"` on Dice.

## 4. Run

| Item | Value |
|---|---|
| Dry run | `npm run probe -- --file <file> --dry-run`: <planned loads> |
| Headed run | `npm run probe -- --file <file> --headed`, HH:MM-HH:MM |
| Budget used | <searches> / <cap>, <views> / <cap> |
| Guards | none |
| Cap override | none (or: the operator's words, `profile/decisions.md` date, entries tagged `cap_override`) |

## 5. Metrics

`npm run probe-report -- data/probes/<files> [--exclude-company <name>] --cards`

| Probe | Keywords | Header | Cards | Kept | Kept % | Unique kept | Most overlap |
|---|---|---|---|---|---|---|---|
| Q1 | | | | | | | |

**Views (R6):**
- 

## 6. Verdicts

| Rule | Result |
|---|---|
| R2 | |
| R3 | |
| R4 | |
| R5 | |
| R6 | |
| R7 | |

| Query | Verdict |
|---|---|
| Q1 | Adopt as `<id>` / Merge / Drop |

## 7. Config edit

| File | Change |
|---|---|
| `config/searches.json` | <queries added, removed, canary>, `verified: true` |

## 8. Process deviations

None. (Or: what deviated from the method, the rule applied after the fact, and that it was applied the same way to every query.)

## 9. Next checks

- The first live week of each new query is its check: <threshold, date>.

## Data

| File | Content |
|---|---|
| `data/probes/<file>.json` | |
