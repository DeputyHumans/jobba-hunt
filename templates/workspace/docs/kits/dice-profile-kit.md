---
title: Dice Profile Kit
updated: YYYY-MM-DD
status: Draft
---

# Dice Profile Kit

> **Manual only.** Automation never edits a profile. The operator approves this kit, then enters each value by hand and saves each section. A field not in this kit is asked first. Every line comes from `collateral/claim-bank.md`. Personal values (rate, zip, work authorization) come from `profile/answers.json` and are never written into this kit.

**Why Dice:** the largest US board for C2C and contract tech roles. Recruiters, mostly staffing firms, search with Boolean queries over resume text, skills, title, work authorization, employment type and rate.

**What matters, in order:** the resume, the skills list, the preferences. Dice has no summary or "about" field, and its work history has no descriptions. **The resume carries all the prose.**

## Limits and quirks

| Item | Value |
|---|---|
| Resume file | pdf, doc, docx, txt or rtf; 2 MB at most. After upload Dice offers "Scan and upload" or "Upload only": use **Upload only** and enter the skills by hand |
| Skills | At least five. Skill names come from Dice's taxonomy |
| Taxonomy traps | "gcp" also matches Good Clinical Practice; "mcp" also matches Microsoft Certified Professional; the only match for "technical hiring" is "recruiting", which pulls recruiter jobs. Pick the unambiguous taxonomy term ("google cloud", "Model Context Protocol") |
| No taxonomy match | Enter the skill as free text. It survives a reload |
| Last used | "Current" or a year. The year list can stop at last year: a skill used this year gets "Current" |
| Work history | Company (200 characters), title, start month and year, current, end month and year. No description. Dice requires months: a role with years only is left off rather than given a guessed month. The resume still lists it |
| Phone | Shown to employers once the profile is visible |
| Easy Apply | The apply runner's per-application Replace swaps the resume for that application only. The profile resume is read back unchanged after every run (`config/apply.json` `dice.profile_resume`) |
| Automation profile | The Dice tick's browser profile under `data/browser/` is never used for edits. Edit in a normal browser |

## 1. Decisions

| Topic | Value | Source |
|---|---|---|
| Employment types | Must agree with `preferences.engagement.accept` | |
| Work authorization | `profile/answers.json` `facts.work_authorization_type` | |
| Rate | `profile/answers.json` `facts.rate_hourly` | |
| Location | | |
| Phone | | |
| Visibility | On, once the required fields are filled | |
| Target titles | A target title is not a claim of a past title | |

## 2. Field map

### Profile (`/profile/info`)

| Field | Req | Value | Source |
|---|---|---|---|
| Resume | | `data/out/cv/<board>/<file>.pdf` (section 3) | |
| First / last name | yes | | |
| Zip/Postal code | yes | `profile/answers.json` `profile.zip` | |
| City, State | yes | | |
| Country | yes | | |
| Email | | Account setting | |
| Phone | | | |
| Years of experience | | | |
| Authorization status | yes | `profile/answers.json` | |
| Security clearance | | | |
| LinkedIn | | | |
| X, Facebook | | | |
| Other | | | |
| Degree type | | | |
| School or institution | | | |
| Education location | | | |

### Skills (`/profile/skills`)

The table is section 4.

### Work history (`/profile/work-history`)

| Company | Job title | Start | End | Source |
|---|---|---|---|---|
| | | | | |

### Preferences (`/profile/preferences`)

| Field | Req | Value | Source |
|---|---|---|---|
| Preferred job title | | | |
| Preferred salary | | | |
| Preferred hourly rate | | `profile/answers.json` `facts.rate_hourly` | |
| Employment type | yes | | |
| Work setting | yes | | |
| Relocation | | | |
| Travel | | | |
| Company size, company age | | | |

## 3. Resume

| Item | Value |
|---|---|
| Variant | `pipeline/channels/dice/cv/<slug>.json`, kept outside `collateral/cv/variants/` so it never enters the `--match` vocabulary or auto-apply (`collateral/cv-map.md`, Targeted CVs) |
| Build | `npm run cv -- --dir pipeline/channels/dice/cv --variant <slug> --docx` |
| File | The PDF. Use the `.docx` only if the PDF parse breaks |

## 4. Skills with years

Years come only from role dates and claims. The operator confirms every row.

| # | Skill (taxonomy term) | Years | Last used | Source | Operator confirmed |
|---|---|---|---|---|---|
| 1 | | | | | [ ] |

**Left off on purpose** (true, but pulls low-fit vendor mail):

## 5. Order of entry

1. Profile: upload the resume (Upload only), then personal info, work authorization, clearance, links, education. Save.
2. Skills: curate the list to section 4. Save.
3. Work history. Save.
4. Preferences. Save.
5. Preview: read everything back, then turn visibility on.

## 6. Entry log

| Section | Entered (date) | Verified (read back after reload) | Notes |
|---|---|---|---|

## 7. Review

| Date | Check | Decision |
|---|---|---|
| | Count the Dice recruiter contacts that pass the gates (`pipeline/channels/dice/`) | The operator decides whether the profile stays visible |
