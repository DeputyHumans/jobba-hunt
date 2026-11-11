---
title: Fit Profile
updated: YYYY-MM-DD
status: Draft
---

# Fit Profile

The single source of truth for scoring roles. `/hunt-triage` scores each role against this file. `scripts/lib/triage.mjs` computes the tier from the score and the gates, so the model never assigns a tier. How to fill it and calibrate it: the repo's `docs/fit-profile-guide.md`. Change it only through calibration (a passing `/hunt-triage calibrate`).

## Target

| Field | Value |
|---|---|
| Engagement | `<fill>` (must agree with `profile/preferences.json` `engagement.accept`) |
| Not in scope | `<fill>` |
| Capacity | `<fill>` |
| Location | `<fill>` (must agree with `preferences.location`) |
| Buyer | `<fill>` |
| Lanes | `<fill>` (from `preferences.lanes`: `leadership`, `hands-on`) |

## Leadership lane

### Gates (any `fail` = reject)

| Gate | Pass | Fail | Unclear |
|---|---|---|---|
| G1 Structure | An engagement type in `preferences.engagement.accept`, shown by the title, the board's employment-type tag or the description. `<fill>` | Equity-only; unpaid; a type not in `engagement.accept`. `<fill>` | The posting is silent on structure |
| G2 Location | Remote within `<fill: time zones or hours>`; occasional travel; on-site or hybrid inside `preferences.location.onsite_metros` | On-site, or hybrid with regular office days, outside `onsite_metros` (when `remote_required`). `<fill>` | Hybrid with no detail on frequency; location not stated |
| G3 Seniority | `<fill>` | `<fill>` | The title says lead but the description reads as a lower level |
| G4 Honesty | Every must-have can be met with claims in `collateral/claim-bank.md` | A must-have needs a claim the operator cannot make (claim bank, Never claim) | The must-haves are vague |

- A G4 problem in a **nice-to-have** is a gap, not a failure. Record it in `gaps[]`.
- **The board's employment-type tag is not evidence on its own.** Fractional roles are often tagged Full-time. G1 fails only when the description confirms a structure outside `engagement.accept`. A Contract or Part-time tag passes G1 even on a plain title.
- **Quote, don't paraphrase,** the JD lines that drive a `fail`.

### Score (0-100)

Score each dimension 0-5. `score = round(sum(dim / 5 * weight))`.

| Dimension (`dims` key) | Weight | 5 | 3 | 1 |
|---|---|---|---|---|
| Mandate (`mandate`) | 35 | `<fill>` | `<fill>` | `<fill>` |
| Domain (`domain`) | 20 | `<fill>` | `<fill>` | `<fill>` |
| Stage/buyer (`stage`) | 20 | `<fill>` | `<fill>` | `<fill>` |
| Stack (`stack`) | 10 | `<fill>` | `<fill>` | `<fill>` |
| Signal quality (`signal`) | 15 | `<fill>` | `<fill>` | `<fill>` |

## Lane H: hands-on

**When it applies:** a role whose title names a senior, lead, principal, staff or architect individual contributor, from any source. A leadership title (CTO, VP, head of, director) is scored on the leadership lane whatever the source. Triage sets `lane: "hands-on"`.

### Gates, Lane H (any `fail` = reject)

| Gate | Pass | Fail | Unclear |
|---|---|---|---|
| G1 Structure | **Dice:** a contract badge in `engagement.accept` (Contract Corp To Corp, Contract Independent, Third Party, Contract W2), or the description allows one. **LinkedIn:** a Contract, Part-time or Temporary engagement, or a role stated in hours per week. **Both:** a full-time role when `engagement.accept` lists `full-time`, at or above `preferences.money.ft_salary_floor` or with no pay stated. `<fill>` | A structure outside `engagement.accept`; a full-time role posted under `ft_salary_floor` | **Dice:** Contract with no tax terms listed |
| G2 Location | As the leadership lane | As the leadership lane. Dice's Remote filter also returns "Remote or Hybrid in <city>" roles: the job page's work-setting badge decides, never the search filter | As the leadership lane |
| G3 Seniority | Senior, lead, principal, staff or architect, hands-on (writes and reviews code, owns design or delivery). `<fill>` | Junior or mid-level; helpdesk or field support; a pure PM, BA or manual QA role; work that is rating or labeling model output (AI-training marketplaces). `<fill>` | The title says senior but the description reads as support or maintenance only |
| G4 Honesty | Every must-have is backed by stack claims: `<fill: claim IDs>` | A must-have needs a stack, a certification or a number of years no claim supports. `<fill>` | The must-haves are vague |

A staffing-firm poster is normal on Dice and on contract IC roles and is not penalized on this lane.

### Score, Lane H (0-100)

Same formula, these dimensions:

| Dimension (`dims` key) | Weight | 5 | 3 | 1 |
|---|---|---|---|---|
| Stack (`stack`) | 40 | `<fill>` | `<fill>` | `<fill>` |
| Role fit (`role`) | 25 | `<fill>` | `<fill>` | `<fill>` |
| Domain (`domain`) | 15 | `<fill>` | `<fill>` | `<fill>` |
| Signal (`signal`) | 20 | `<fill>` | `<fill>` | `<fill>` |

## Tiers (computed, not chosen)

| Tier | Rule | Action |
|---|---|---|
| A | No gate fails, score >= `preferences.tiers.a` | Pursue the same day |
| B | No gate fails, score >= `preferences.tiers.b` and below `tiers.a` | Review in the digest |
| C | No gate fails, score below `tiers.b` | Log only |
| reject | Any gate fails | Log only, with the failing gate named |

## Compensation

**Shown, never scored.** Record `comp_seen` and `hours_seen` verbatim when the posting states them. Pricing belongs to the proposal stage (`pipeline/proposals/<client>/`).

The floors in `preferences.money` are enforced by `scripts/lib/rate.mjs` and `record-triage`, never by the score:

| Floor | Rule |
|---|---|
| `ic_rate_floor` | A hands-on role whose posted hourly rate tops out under it is dropped by the prefilter (pay on the card) or rejected by `record-triage`. The top of the range counts; a day is 8 hours and a year 2,080. An open-ended top ("$90+/hr") or no rate stated has no effect. Leadership roles have no floor |
| `ft_salary_floor` | A full-time IC role whose posted pay tops out under it is rejected |
| `ft_salary_target` | A full-time IC role posted from the floor up to the target is scored as usual and carries the red flag `Below target` |

None of these numbers appears on the tracker.

## Scoring output (one object per role)

```json
{"job_id": "9000000001", "lane": "leadership", "score": 84,
 "gates": {"G1": "pass", "G2": "pass", "G3": "pass", "G4": "pass"},
 "dims": {"mandate": 5, "domain": 4, "stage": 4, "stack": 4, "signal": 3},
 "why_fit": ["C03 ..."], "gaps": ["..."], "red_flags": ["..."],
 "comp_seen": null, "hours_seen": "10-15 hrs/week", "archetype": "<cv-map slug>"}
```

```json
{"job_id": "dice-11111111-1111-4111-8111-111111111101", "lane": "hands-on", "score": 78,
 "gates": {"G1": "pass", "G2": "pass", "G3": "pass", "G4": "pass"},
 "dims": {"stack": 4, "role": 4, "domain": 3, "signal": 4},
 "why_fit": ["..."], "gaps": ["..."], "red_flags": ["..."],
 "comp_seen": "$70-85/hr", "hours_seen": null, "archetype": "<cv-map slug>"}
```

- **`lane`**: `hands-on` for Lane H; `leadership` or omitted otherwise.
- **`why_fit`** names claim IDs where they apply.
- **`archetype`** is one of the slugs in `collateral/cv-map.md`.
- **No description fetched:** every gate `unclear`, red flag `no-description`, score at most 50.

## Calibration

`data/calibration.json` holds known roles with the expected outcome (expectation types `order`, `tier_at_least`, `gate_is`, `reject_on`). Run it before trusting any change to this file: `/hunt-triage calibrate` (blind: the scorer never sees labels, sources or expectations), then `node scripts/check-calibration.mjs --file <results.json>`.

| Role (label) | Source | Expectation |
|---|---|---|

**Revisit the weights** when the operator overrides more than 30% of tiers in a week. Every overridden role is added to the calibration set.
