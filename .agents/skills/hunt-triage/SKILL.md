---
name: hunt-triage
description: "Use after a LinkedIn or Dice tick or sweep, or when the operator asks to review new roles, score jobs, or see the job digest. Scores every viewed, not-yet-scored role in the job state against workspace/fit-profile.md, records the scores (the script computes the tier), writes the dated digest to workspace/pipeline/digests/, and asks the operator pursue / watch / skip for each tier A and B role. `tick` mode (called by /hunt-loop) asks nothing. `calibrate` mode checks the rubric blind against the operator's known roles. It never browses a job board and never applies."
---

# /hunt-triage [tick | calibrate]

Run from the repo root. Read `CLAUDE.md` first. Paths starting `workspace/` are in the workspace (`$JOBBA_HOME` when set).

## Inputs
- `workspace/fit-profile.md`: gates, lanes, dimensions, weights, the output schema. The only rubric.
- `workspace/collateral/claim-bank.md`: claim IDs for `why_fit`, and the Never claim list for G4.
- `workspace/collateral/cv-map.md`: the valid `archetype` slugs.
- `workspace/profile/preferences.json`: `lanes`, `engagement.accept`, `location`. Floors and tiers are applied by the script, never by the score.

## Triage run
1. **Export the pending roles.** `npm run -s triage -- pending` prints `{ count, file }`.
   - Count 0: report the last run instead and stop. The last run is the newest `workspace/data/raw/*-tick.json` or `*-sweep.json`: give its `summary`, `aborted` and `budget_exhausted`.
2. **Score each role** per `fit-profile.md`: `lane`, `gates`, `dims`, `score`, `why_fit`, `gaps`, `red_flags`, `comp_seen`, `hours_seen`, `archetype`.
   - **Score from the fetched `description_text` only.** Empty: every gate `unclear`, red flag `no-description`, score at most 50.
   - **G1 reads `preferences.engagement.accept`.** A board's employment-type tag is not evidence on its own: a "Full-time" tag on a description of a fractional or part-time engagement passes G1, and a Contract or Part-time tag passes G1 on a plain title. A full-time role passes when `accept` lists `full-time`; the salary floor and target are applied by `record-triage`, not the score.
   - **G2 reads `preferences.location`.** With `remote_required`, hybrid passes only when the description limits on-site time to occasional travel. On-site or hybrid passes inside `onsite_metros`, and fails elsewhere.
   - **Dice roles (`source: dice`).** A hands-on title (senior, lead, principal, staff or architect with an engineering noun, not leadership) scores on Lane H with `lane: "hands-on"` and its own dims. G1 reads `contract_types` against `engagement.accept`. G2 reads the job page `workplace` badge, never Dice's Remote filter. The digest shows the posted rate in the hours/comp column.
   - **LinkedIn hands-on roles.** A hands-on title scores on Lane H with `lane: "hands-on"`. G1 passes a Contract, Part-time or Temporary engagement that `engagement.accept` allows.
   - **A role whose work is rating or labeling model output** (an AI-training marketplace) fails G3.
   - **Quote, don't paraphrase,** the JD lines that drive a gate `fail`.
   - **Above 10 roles, use subagents.** Fan out to `general-purpose` subagents in batches of 8. Give each the input file paths plus its batch, and require a JSON array as its only output. Never pass a subagent an expected outcome.
3. **Persist the scores.**
   - Write the results array to `workspace/data/triage/results-YYYYMMDD.json`, then run `npm run -s triage -- record --file <it>`.
   - Fix each `errors[]` entry and re-record only those. The script computes the tier, the IC rate floor and the full-time floor and target. Never write a tier.
4. **Write the digest** to `workspace/pipeline/digests/YYYYMMDD-digest.md` from `templates/digest.md`.
   - Frontmatter: `title`, `created`, `updated`, `status: Draft`, `tags`.
   - Rows from `npm run -s triage -- list --status triaged`.
   - Sections in order: **Sweep** (one line per tick or sweep: time, source, query, new, viewed, guards), **Tier A** and **Tier B** tables (score, role @ company, lane, location, hours/comp seen, one-line why, top gap, link), **Tier C and reject** (counts, plus one line per reject naming the failing gate and its quoted line), **Decisions**, **Inbox**, **Overrides and halts**.
   - Comp and hours verbatim, never scored. No floor appears. No em dashes.
5. **Get the operator's decision** on every A and B role with AskUserQuestion (pursue / watch / skip; up to 4 roles per call), inside `preferences.schedule` `ask_start`-`ask_end` only. Record each: `npm run -s triage -- decide --id <id> --decision <d> --note "<the operator's words>"`.
6. **For each `pursue`,** create `workspace/pipeline/opportunities/YYYYMMDD-<company-slug>-<role-slug>.md` from `templates/opportunity.md`.
   - Fill the snapshot, the triage block and `fetched_at` from the job state.
   - `stage: shortlisted`, `next_action: Run /hunt-kit`, `next_action_due:` today for tier A, otherwise two days out.
   - Offer `/hunt-kit` for tier A roles.

## Tick mode (`/hunt-triage tick`, called by `/hunt-loop`)
Steps 1 to 3 on whatever is pending. Then:
- **Digest:** create or update today's `workspace/pipeline/digests/YYYYMMDD-digest.md`. Add the new rows to the tables; the Sweep section gets one line per tick.
- **No questions.** Skip steps 5 and 6: `/hunt-loop` asks, with the documents attached.

## Calibrate mode (`/hunt-triage calibrate`)
Run it after any change to `fit-profile.md`, after a scope change in `preferences.json`, and when the operator overrides more than 30% of tiers in a week (each overridden role joins the set first).

1. Write the blind copy: **only the `roles` array** of `workspace/data/calibration.json`, with each role's `label` and `source` removed, to `workspace/data/triage/calibration-roles-YYYYMMDD.json`. Never include the `expectations` block. Labels and source notes leak the answer, and a scorer that sees the answer key is not being calibrated.
2. Spawn ONE fresh `general-purpose` subagent. Give it `workspace/fit-profile.md`, `workspace/collateral/claim-bank.md` and the blind copy, and require a JSON array of scores as its only output.
3. Save the array to `workspace/data/triage/calibration-YYYYMMDD.json`.
4. Run `node scripts/check-calibration.mjs --file <it>` (exit 0 pass, 1 fail with `failures`).
5. Report the pass, or each named failure. On a failure, propose a rubric edit to the operator. Never tune the rubric until the check passes by itself, and never to fit one role.

## Never
- Browse a job board, or fetch a posting the tick did not fetch.
- Invent company facts, comp or hours.
- Score compensation. The floors in `preferences.money` are applied by `record-triage`, never by the score, and never appear in the digest.
- Write a tier.
