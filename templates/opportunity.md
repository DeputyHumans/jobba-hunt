---
title: <Role> at <Company>
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: Draft
tags: [opportunity, <archetype>]
role: <Role>
company: <Company>
stage: shortlisted
tier: A
score: 0
lane: leadership  # or hands-on
job_id: "9000000000"
url: https://www.linkedin.com/jobs/view/9000000000/
source: linkedin-jobs  # dice-jobs (job_id dice-<guid>, url dice.com/job-detail/<guid>) or email (job_id email-<thread id>)
fetched_at: YYYY-MM-DDTHH:MM:SSZ
archetype: <cv-map slug>
applied_on:
next_action: Run /hunt-kit  # only a real task for the operator; empty after applying (no follow-up dates)
next_action_due: YYYY-MM-DD
cv_note:
offer_folder:  # pipeline/proposals/<client>/ once the stage reaches proposal
---

# <Role> at <Company>

<!-- Stages: inbound (a role found only in an email, job_id email-<thread id>) | shortlisted -> kit-ready -> applied -> screening -> nda -> proposal -> negotiating -> won | lost | withdrawn -->
<!-- company: the employer. The per-company application limit (config/apply.json companies) counts this file once stage is applied or later, or applied_on is set; an agency role names its end client. -->
<!-- cv_note: optional, one sentence. Set it when the CV that was sent no longer matches its current render; the tracker flags it on the application card. -->
<!-- File name: pipeline/opportunities/YYYYMMDD-<company-slug>-<role-slug>.md. Material under NDA stays outside the workspace: link to it, never copy it in. -->

## Role snapshot

| Field | Value |
|---|---|
| Company | |
| Location / workplace | |
| Employment type | |
| Hours seen | |
| Comp seen (not scored) | |
| Posted / applicants | |

**JD asks (quoted):**
- 

## Triage

| Gate | Verdict |
|---|---|
| G1 Structure | |
| G2 Location | |
| G3 Seniority | |
| G4 Honesty | |

**Why fit:** 
**Gaps:** 
**Red flags:** 

## Company research

Facts only with a URL. What cannot be found goes under the open questions, never guessed.

| Fact | Source URL |
|---|---|
| | |

**Open questions for the first call:**
- 

## Fit matrix

| JD must-have | Evidence (claim IDs) | Gap |
|---|---|---|
| | | |

**Odds:** 

## Application kit

**CV:** `data/out/cv/<job_id>/share/<file>.pdf` (tailored) or `data/out/cv/share/<file>.pdf` (archetype)
**Cover letter:** `data/applications/<job_id>/<file>.pdf`
**Review docs:** <CV and letter bikeshed URLs, when `preferences.tailoring.review` is `bikeshed`>

> Intro note (after `authentic-prose`; the operator approves before it is sent)

### Claim sources

| Claim ID | Claim | Source |
|---|---|---|
| | | |

**Channel:** Easy Apply | Dice Easy Apply | Greenhouse | Lever | Ashby | Workday | appcast | Paycor | Paylocity | Workable | Rippling | iCIMS | Walmart | site | by hand. Evidence: `data/applications/<job_id>/<run>/` (confirmation screenshot)

## Submission checklist

- [ ] The board profile agrees with the CV (`docs/kits/linkedin-profile-kit.md`, `docs/kits/dice-profile-kit.md`)
- [ ] The right CV is attached (the runner verifies the selected resume)
- [ ] The tailored CV and letter are approved (`npm run triage -- approve-docs`), or `tailoring.review` is `auto`
- [ ] The operator's "Apply" is recorded (`npm run triage -- approve --id <id>`), or the auto-apply rule is named in the note
- [ ] Submitted by the runner or by hand (date in `applied_on`)

## Stage log

| Date | Stage | Note |
|---|---|---|
| YYYY-MM-DD | shortlisted | from digest YYYYMMDD |
