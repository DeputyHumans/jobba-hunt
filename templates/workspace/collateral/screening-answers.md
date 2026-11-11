---
title: Screening Answers
updated: YYYY-MM-DD
status: Draft
---

# Screening Answers

> **Rules.**
> - Answers carry only the operator's own statements about themselves, sanitized: no client name, client product, other people's background, exact location or personal-health content from the source material.
> - "Gap: ask the operator" means no source exists. Nothing is written until the operator answers.
> - Facts beyond the quoted lines come from `collateral/claim-bank.md` by ID. A new fact said here goes into the claim bank with its source first.
> - Final wording goes through `authentic-prose` (voice in `profile/voice.md`) before it is used.
> - Single-value form answers (phone, work authorization, start date, standing rate, EEO) live in `profile/answers.json`, not here. This file holds the spoken and written answers.
> - `/hunt-onboard` phase 5 drafts each answer from claims; the operator confirms it.

## Source key

| Tag | Origin |
|---|---|
| `user:YYYY-MM-DD` | The operator's own statement in a session, quoted |
| `screen:YYYY-MM-DD` | A screening call or written reply by the operator (sanitized) |
| `src:<file>#p<n>` | An original in `sources/` |

## Q&A bank

| ID | Question (common variants) | Answer (the operator's words, sanitized) | Source | Open gap |
|---|---|---|---|---|
| Q01 | Availability. How many hours a week? | Gap: ask the operator | | |
| Q02 | Time zone, location, travel | Gap: ask the operator | | Never offer more on-site time than `preferences.location` allows |
| Q03 | What else are you working on? Will we get enough of you? | Gap: ask the operator | | |
| Q04 | How do you work with founders or leadership? Cadence, decision rights, disagreement | Gap: ask the operator | | |
| Q05 | How do you use AI in engineering? Policy for client code and data in AI tools | Gap: ask the operator | | |
| Q06 | Team and contractor model. Who does the work? | Gap: ask the operator | | |
| Q07 | Security and compliance experience | Gap: ask the operator | | Each standard named needs its own claim |
| Q08 | Experience under a specific regulator or standard the role names, which the operator does not have | Gap: ask the operator | | Say no plainly. Never stretch a neighbouring standard into this one |
| Q09 | Have you held this title in this domain before? | Gap: ask the operator | | Answer with the nearest true claim and say what is missing |
| Q10 | First 30/60/90 days | Gap: ask the operator | | |
| Q11 | Why this engagement type (fractional, contract, full-time)? | Gap: ask the operator | | |
| Q12 | Engagement structure: trial, term, cadence, notice | Gap: ask the operator | | |
| Q13 | Rate, compensation, equity, budget fit | Deferred to the proposal stage | Policy | A form field that requires a number takes `profile/answers.json` `facts.rate_hourly` or `facts.rate_annual`. Mail drafts carry `[RATE]` |
| Q14 | Open to full-time or conversion? | Gap: ask the operator | | Must agree with `preferences.engagement.accept` |
| Q15 | Hands-on or advisory? | Gap: ask the operator | | |
| Q16 | Tell me about your background | The shared two-sentence background in `collateral/intro-templates.md`, then the top three claims for the archetype | | |
| Q17 | Why did your last role end? | Gap: ask the operator | | Wording and how much to say |
| Q18 | Personal connection to our mission | Never pre-written. Ask the operator per role | Policy | Personal answers from earlier screenings are not reusable |
| Q19 | Start date, notice period | Gap: ask the operator | | Must agree with `profile/answers.json` `facts.start_date` |
| Q20 | References | Gap: ask the operator | | Names and consent stay out of this file |
| Q21 | Contracting entity, insurance, work authorization | Gap: ask the operator | | Must agree with `profile/answers.json` `facts.work_authorization`, `sponsorship`, `contracting_entity` |

## Answered vs gap

| State | IDs |
|---|---|
| Answered from the operator's statements | |
| Answered by another file | Q16 |
| Partial, needs confirmation | |
| Deferred to proposal | Q13 |
| Never pre-written | Q18 |
| Gap: ask the operator | Q01-Q12, Q14, Q15, Q17, Q19-Q21 |
