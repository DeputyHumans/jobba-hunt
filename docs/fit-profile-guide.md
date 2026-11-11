# Fit Profile Guide

How to fill `fit-profile.md` in the workspace, write its anchors, and calibrate it. `/hunt-onboard` phase 4 drafts it from the interview; the operator confirms each section.

## What the file decides

| Part | Decides | Who computes it |
|---|---|---|
| Gates G1-G4 | Hard no's. Any `fail` rejects the role | The scorer (a model), from the description text |
| Dimensions and weights | Taste: how good a fit the role is, 0-100 | The scorer gives 0-5 per dimension; `score = round(sum(dim / 5 * weight))` |
| Tiers | What happens next | `scripts/lib/triage.mjs`, from the score, the gates and `preferences.tiers`. Never the model |
| Floors | Pay below the operator's floors | `scripts/lib/rate.mjs` and `record-triage`, from `preferences.money`. Never the score |

Keep the parts apart. A preference in a gate rejects roles that would have scored well; a hard limit in a dimension lets bad roles through on a high total.

## 1. Target

One line each: engagement types, what is out of scope, capacity, location, buyer, lanes. Each must agree with `profile/preferences.json` (`engagement.accept`, `location`, `lanes`). When they disagree, the preferences file wins and the fit profile is corrected.

## 2. Gates

Write each cell so the scorer can decide it from the posting alone.

| Gate | Pass | Fail | Unclear |
|---|---|---|---|
| G1 Structure | The engagement types in `engagement.accept`, plus how they show (title, tag, description) | Structures the operator refuses: equity-only, unpaid, and every type not accepted | Silent postings |
| G2 Location | Remote with the hours the operator keeps; the on-site metros the operator accepts | On-site or regular office days elsewhere | Hybrid with no frequency; no location |
| G3 Seniority | The levels the operator targets, per lane | Levels and role types the operator will not take | A title that disagrees with its description |
| G4 Honesty | Must-haves the claim bank covers | A must-have only a Never claim row could meet | Vague must-haves |

Rules that hold for every workspace:
- A board's employment-type tag is not evidence on its own: fractional roles are often tagged Full-time. G1 fails only on the description.
- A G4 problem in a nice-to-have is a gap (`gaps[]`), not a failure.
- The scorer quotes the JD lines that drive a fail.

## 3. Lanes

| Lane | Applies to | Dimensions |
|---|---|---|
| `leadership` | Leadership titles (CTO, VP, head of, director), from any source | Mandate 35, Domain 20, Stage/buyer 20, Stack 10, Signal 15 |
| `hands-on` (Lane H) | Senior, lead, principal, staff or architect individual-contributor titles | Stack 40, Role fit 25, Domain 15, Signal 20 |

Drop a lane the operator does not want from `preferences.lanes` and from the queries; keep its section empty.

## 4. Anchors

Each dimension needs a 5, a 3 and a 1. Scores of 4 and 2 sit between them.

- **Observable.** Name what the posting says: a mandate, a domain, a stack, a stage, a signal. Never a feeling ("exciting").
- **From the description alone.** The scorer sees the fetched description and top card, nothing else.
- **Tied to claims.** Domain and stack anchors name the claim-bank domains and stacks. A 5 is a posting the strongest claims answer directly; a 1 is one only a Never claim row could answer.
- **Never comp.** Pay is shown, never scored. Floors are enforced elsewhere.
- **One idea per anchor.** Two ideas in one cell make the middle score ambiguous.

Example anchors (a hands-on platform engineer):

| Dimension | 5 | 3 | 1 |
|---|---|---|---|
| Stack | Core stack is the operator's main language and platform, as claimed | Adjacent stack, or one must-have only partly covered | Most of the stack is outside the claims |
| Role fit | Owns design and delivery; greenfield or platform build; hands-on | Feature work in an existing system | Maintenance-heavy, ticket work, or support duties mixed in |
| Signal | End client named; rate or salary stated; structure stated; posted under 72 hours; scope and duration stated | Some of these | Vague; reposted many times; "multiple positions"; a location that contradicts itself |

Leadership signal quality usually rewards a direct employer, a recent posting, a low applicant count and stated hours and scope, and penalizes staffing aggregators, vague text, many reposts and very high applicant counts. On Dice and on contract IC roles a staffing-firm poster is normal and not penalized.

## 5. Weights and tiers

- The default weights sum to 100. Keep them until calibration shows a reason to move them.
- Tier thresholds live in `preferences.tiers` (`a`, `b`). A raises the same-day pursuit; B goes to the digest for review.

## 6. Calibration

Calibration checks the rubric against roles whose right answer the operator already knows.

| Step | Detail |
|---|---|
| Build the set | `data/calibration.json`: 5-15 roles with `job_id`, `label`, `title`, `company`, `location`, `employment_type`, `description_text`, `source`, plus `expectations`. Include at least one negative control per gate (a role that must reject on G1, G2, G3, G4) and one ordering pair |
| Expectation types | `order` (`higher`, `lower`), `tier_at_least` (`label`, `tier`), `gate_is` (`label`, `gate`, `value`), `reject_on` (`label`, `gate`) |
| Run blind | `/hunt-triage calibrate` gives one fresh scorer only the `roles` array, with each `label` and `source` removed and no `expectations`. Labels and sources leak the answer |
| Check | `node scripts/check-calibration.mjs --file <results.json>` |
| On a failure | Propose a rubric edit to the operator. Never tune the rubric until the check passes by itself, and never to fit one role |

**When to recalibrate:** after any edit to `fit-profile.md`; when the operator overrides more than 30% of tiers in a week (each overridden role joins the set); after a scope change in `preferences.json`.
