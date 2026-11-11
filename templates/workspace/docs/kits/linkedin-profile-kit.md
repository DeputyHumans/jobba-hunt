---
title: LinkedIn Profile Kit
updated: YYYY-MM-DD
status: Draft
---

# LinkedIn Profile Kit

> **Manual only.** Automation never edits a profile. The operator approves this kit, then enters each change by hand. Every line comes from `collateral/claim-bank.md`. New copy goes through `authentic-prose` first. A field not in this kit is asked first.

Why: screeners cross-check the intro note and the CV against the profile. A claim on the CV that the profile contradicts costs more than a missing claim.

## Limits and quirks

| Item | Value |
|---|---|
| Headline | 220 characters |
| PDF export | More > Save to PDF. It omits Featured, Services and the Open-to settings: audit those on the live profile |
| Open-to visibility | "Recruiters only" shows the setting to recruiters with no #OpenToWork photo frame. "All LinkedIn members" adds the frame |
| Services page | Services are picked from LinkedIn's predefined list. Confirm the exact labels on the form |
| Automation profile | The tick's browser profile under `data/browser/` is never used for edits. Edit in a normal browser |

## 1. Export the current profile

- [ ] More > Save to PDF
- [ ] Save as `sources/YYYYMMDD-linkedin-export.pdf` (the export date)
- [ ] After all edits, export again as the "after" snapshot and update the claim-bank statuses it confirms

## 2. Consistency audit

One row per field; one row per role in `collateral/cv/master.json`.

| Field | Canonical value | Claim | Check |
|---|---|---|---|
| Name | | | [ ] match |
| Headline | Step 3 | | [ ] match |
| Location | | | [ ] match |
| Contact email | `profile/person.json` `application_email` | | [ ] match |
| Phone | | | [ ] match |
| Websites | | | [ ] match |
| About | No banned figures (claim bank, Never claim) | | [ ] match |
| Current role | | | [ ] match |
| `<role>` | Title, company, dates as in `master.json` | | [ ] match |
| Education | | | [ ] match |
| Languages | | | [ ] match |
| Top skills | | | [ ] match |
| Banned figures | None of the Never claim rows | Never claim | [ ] clean |
| Dates | Start and end months that are on file; no month guessed | | [ ] match |

## 3. Headline options (draft, run through `authentic-prose`)

| Option | Text | Chars | Claims |
|---|---|---|---|
| H1 | | | |

## 4. Experience entries

| Role | Change | Claims |
|---|---|---|
| | | |

## 5. Open-to settings

| Setting | Value |
|---|---|
| Feature | Open to > Finding a new job |
| Job titles | |
| Employment types | Must agree with `preferences.engagement.accept` |
| Locations | Must agree with `preferences.location` |
| Visibility | |
| Start date | |

## 6. Services page

| Field | Value |
|---|---|
| Entry point | Open to > Providing services |
| Services | |
| Description | Claim slots, then `authentic-prose` |
| Work location | |
| Pricing | Blank. Pricing happens at the proposal stage |
| Contact email | |

## 7. Featured section

Check that every URL loads before it is added.

| Order | Item | Caption claim |
|---|---|---|
| 1 | | |

## 8. Decisions

| # | Topic | Decision | Date (`profile/decisions.md`) |
|---|---|---|---|

## 9. Entry log

| Section | Entered (date) | Verified (read back) |
|---|---|---|
