# Fit Profile Guide

How to fill `workspace/fit-profile.md`, write its anchors, and calibrate it. The template is `templates/workspace/fit-profile.md`. The Interview phase of `/hunt-onboard` drafts the file from the operator's answers (`docs/setup.md` "Onboard"), and the operator confirms each section. The scoring rules are in `AGENTS.md` "Honesty".

## What the file decides

| Part | Decides | Who computes it |
|---|---|---|
| Gates G1 to G4 | Hard no's. Any `fail` makes the tier `reject` | The scorer (a model), from the description text |
| Dimensions and weights | Taste: how good a fit the role is, 0 to 100 | The scorer gives 0 to 5 per dimension and the score, `round(sum(dim / 5 * weight))`. `triage -- record` checks only that the score is an integer from 0 to 100 |
| Tiers | What happens next | `scripts/lib/triage.mjs`, from the score, the gates and `preferences.tiers`. Never the model |
| Floors | Pay under the operator's floors | Not this file: `preferences.money`, enforced by the scripts ("Floors"). Never part of the score |

Keep the parts apart. A preference in a gate rejects roles that would have scored well. A hard limit in a dimension lets bad roles through on a high total.

## Target

One line each: engagement types, what is out of scope, capacity, location, buyer, lanes. Each must agree with `profile/preferences.json` (`engagement.accept`, `location`, `lanes`). When they disagree, the preferences file wins and the fit profile is corrected.

## Gates

Write each cell so the scorer can decide it from the posting alone.

| Gate | Pass | Fail | Unclear |
|---|---|---|---|
| G1 Structure | The engagement types in `engagement.accept`, plus how they show (title, tag, description) | Structures the operator refuses: equity-only, unpaid, and every type not accepted | Silent postings |
| G2 Location | Remote with the hours the operator keeps. The on-site metros the operator accepts | On-site or regular office days elsewhere | Hybrid with no frequency. No location |
| G3 Seniority | The levels the operator targets, per lane | Levels and role types the operator will not take | A title that disagrees with its description |
| G4 Honesty | Must-haves the claim bank covers | A must-have only a Never claim row could meet | Vague must-haves |

Rules that hold for every workspace:
- A board's employment-type tag is not evidence on its own: fractional roles are often tagged Full-time. G1 fails only on the description.
- A G4 problem in a nice-to-have is a gap (`gaps[]`), not a failure.
- The scorer quotes the JD lines that drive a fail.
- `unclear` does not change the tier, but `npm run triage -- auto` needs every gate at `pass`.
- **No description.** A role whose fetched description is empty is recorded only with every gate `unclear`, the red flag `no-description`, and a score of at most 50. `npm run triage -- record` refuses any other row for it.

## Lanes

| Lane | Applies to | Dimensions (`dims` key, weight) |
|---|---|---|
| `leadership` | Leadership titles (CTO, VP, head of, director), from any source | Mandate (`mandate`) 35, Domain (`domain`) 20, Stage/buyer (`stage`) 20, Stack (`stack`) 10, Signal (`signal`) 15 |
| `hands-on` (Lane H) | Senior, lead, principal, staff or architect individual-contributor titles | Stack (`stack`) 40, Role fit (`role`) 25, Domain (`domain`) 15, Signal (`signal`) 20 |

A Lane H role is recorded with `lane: "hands-on"`. The pay floors key on that value, so never leave it out for a hands-on role. Drop a lane the operator does not want from `preferences.lanes` and from the queries, and keep its section empty. `triage -- record` refuses a `lane` that is not in `preferences.lanes`.

## Anchors

Each dimension needs a 5, a 3 and a 1. Scores of 4 and 2 sit between them.

- **Observable.** Name what the posting says: a mandate, a domain, a stack, a stage, a signal. Never a feeling ("exciting").
- **From the description alone.** The scorer sees the fetched description and top card, nothing else.
- **Tied to claims.** Domain and stack anchors name the claim-bank domains and stacks. A 5 is a posting the strongest claims answer directly. A 1 is one only a Never claim row could answer.
- **Never comp.** Pay is shown, never scored. The floors are enforced by the scripts ("Floors").
- **One idea per anchor.** Two ideas in one cell make the middle score ambiguous.

Example anchors (a hands-on platform engineer):

| Dimension | 5 | 3 | 1 |
|---|---|---|---|
| Stack | Core stack is the operator's main language and platform, as claimed | Adjacent stack, or one must-have only partly covered | Most of the stack is outside the claims |
| Role fit | Owns design and delivery. Greenfield or platform build. Hands-on | Feature work in an existing system | Maintenance-heavy, ticket work, or support duties mixed in |
| Signal | End client named. Rate or salary stated. Structure stated. Posted under 72 hours. Scope and duration stated | Some of these | Vague. Reposted many times. "Multiple positions". A location that contradicts itself |

Leadership signal quality usually rewards a direct employer, a recent posting, a low applicant count and stated hours and scope. It penalizes staffing aggregators, vague text, many reposts and very high applicant counts. On Dice and on contract IC roles a staffing-firm poster is normal and not penalized.

## Weights and tiers

- The default weights sum to 100. Keep them until calibration shows a reason to move them.
- Tier thresholds live in `preferences.tiers` (`a`, default 80, and `b`, default 65).

| Tier | Rule | Action |
|---|---|---|
| A | No gate fails, score at or above `tiers.a` | Pursue the same day |
| B | No gate fails, score at or above `tiers.b` and below `tiers.a` | Review in the digest |
| C | No gate fails, score below `tiers.b` | Log only |
| reject | Any gate fails, or a pay floor (below) | Log only, with the failing gate or the floor named |

## Floors

The floors are `preferences.money` `ic_rate_floor`, `ft_salary_floor` and `ft_salary_target` (`null` turns a check off). `AGENTS.md` "Honesty" holds the rule: pay floors force `reject` for a hands-on role. They are never part of the score or a gate, and they never appear on the tracker. Parsing is in `scripts/lib/rate.mjs`.

| Floor | Prefilter (`scripts/lib/prefilter.mjs`) | `npm run triage -- record` (`scripts/lib/triage.mjs`) |
|---|---|---|
| `ic_rate_floor` | Drops an IC title (no executive word) whose posted pay tops out under it: reason `rate-below-floor` | Tier `reject` for a `lane: "hands-on"` role whose `comp_seen`, else the posting's comp text, tops out under it. Red flag "Rate floor: ...", field `rate_below_floor` |
| `ft_salary_floor` | Drops a full-time IC title whose posted pay tops out under it: reason `salary-below-ft-floor` | Tier `reject` for a full-time `hands-on` role under it. Red flag "Salary floor: ...", field `salary_below_floor` |
| `ft_salary_target` | Nothing | A full-time `hands-on` role from the floor up to the target keeps its tier and gets the red flag "Below target: ...", field `salary_below_target` |

How the pay is read:
- The top of the posted range counts. A day is 8 hours and a year 2,080 hours, so the hourly floor also applies to a posted salary.
- An open-ended top ("$90+/hr") or no figure has no effect.
- A figure labelled equity, bonus, stock, RSU, options or commission is not pay.
- Leadership roles have no floor.

When each check runs:
- **The prefilter** drops a role before triage, and a dropped role is never scored. Dice cards show pay before any view, so a Dice role can drop before its job page is loaded. LinkedIn shows pay only on the job page, so the drop comes after the view.
- **Full-time in triage** means the posting's employment-type tag (`detail.employment_type`) says full-time and names no contract, part-time or temporary term.
- **A floor reject fails no gate.** The gates and the score stay as the scorer gave them. `triage -- auto` names the floor as its own blocker.

## Agencies and the company limit

Two optional fields in each scored row tell the per-company limit which company a posting counts against (`config/apply.json` `companies.limit`, default 1, `AGENTS.md` "Platform safety"):

| Field | Value |
|---|---|
| `via_agency` | `true` when the poster is a recruiter, staffing firm or aggregator. `true`, `false` or omitted |
| `end_client` | The employer the description names, or `null`. A non-empty string or `null` |

`triage -- record` refuses any other value. An agency posting counts against its end client. With no client named it counts against no company, and only the same agency posting the same title again counts as a duplicate. `companies.agencies` lists posters that are always agencies, and `companies.aliases` maps two names of one company. Company names are compared without punctuation, a leading "the", or trailing corporate words such as Inc, LLC, Group, Global, Tech, AI or Labs (`scripts/lib/company.mjs`).

## Calibration

Calibration checks the rubric against roles whose right answer the operator already knows.

| Step | Detail |
|---|---|
| Build the set | `data/calibration.json`, written in the Calibration phase of `/hunt-onboard`. `roles`: 5 to 15 roles, each with `job_id` (a neutral string such as `cal-01`), `label`, `title`, `company`, `location`, `employment_type`, `description_text` and `source`. `expectations`: below. Include a clear positive, at least one negative control per gate (a role that must reject on G1, G2, G3 and G4) and one ordering pair |
| Run blind | `/hunt-triage calibrate` gives one fresh scorer only the `roles` array, with each `label` and `source` removed and no `expectations`. Labels and sources leak the answer |
| Check | `node scripts/check-calibration.mjs --file <results.json> [--fixture <calibration.json>]`. Exit 0 when every expectation holds, 1 with `failures` otherwise |
| On a failure | Propose a rubric edit to the operator. Never tune the rubric until the check passes by itself, and never to fit one role |

Each expectation is an object with a `type` key:

| Expectation | Holds when |
|---|---|
| `{ "type": "order", "higher": "<label>", "lower": "<label>" }` | `higher` scores strictly above `lower` |
| `{ "type": "tier_at_least", "label": "<label>", "tier": "B" }` | The role's tier is that tier or better (reject, C, B, A) |
| `{ "type": "gate_is", "label": "<label>", "gate": "G1", "value": "pass" }` | The gate has that value |
| `{ "type": "reject_on", "label": "<label>", "gate": "G2" }` | The gate is `fail` |

The check computes each tier from the score and the gates only: no floor applies. A role with no result fails, and so does an unknown `type`. `tests/fixtures/calibration.json` is a complete synthetic example.

**When to recalibrate:** after any edit to `fit-profile.md`. When the operator overrides more than 30% of tiers in a week (each overridden role joins the set). After a scope change in `preferences.json`.
