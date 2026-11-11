---
title: Intro Note Templates
updated: YYYY-MM-DD
status: Draft
---

# Intro Note Templates

> **Voice rule (mandatory).** Final copy for any real application goes through the `authentic-prose` skill, matched to the voice profile in `profile/voice.md`. Very clear English. No em dashes, no semicolons (the letter and mail checks refuse both). These templates are structure, not finished prose.

## Format rules

| Element | Rule |
|---|---|
| Opener | "Hi [Name]," when the reader is known. Otherwise the opener recorded in `profile/voice.md` |
| Background | Exactly two sentences: who the operator is and what they do now, then the one prior role that matters most |
| Bullets | One per JD ask, in JD order, at most five. Pick the template by the triage `archetype` slug. Label = the JD's own words. Each bullet pulls 1-2 claim IDs |
| Disclosure | When a JD must-have hits a gap (`collateral/cv-map.md`, `honest_gaps`), one bullet states it plainly |
| Close | The profile link from `profile/person.json` `links` |
| Paste | Plain text. Strip every `[C##]` tag before sending |
| Attach | The CV the tailoring or the CV-creation rule picked (`collateral/cv-map.md`) |
| Never | Pricing or rates. Client names the claim bank does not allow. Time-relative dates ("through September"): write the month and year |

## Shared background (two sentences)

> [Opener] [Sentence 1: current role and what it does for whom, C##] [Sentence 2: the prior role or frame that fits the archetype, C##]

| Frame | Wording | Claim | Best for |
|---|---|---|---|
| F1 | | | |

---

## T1. <Archetype name> (`<archetype-slug>`)

CV: `<slug>`. Frame: F1.

| Typical JD ask | Claims (primary, backup) |
|---|---|
| | |

> [Shared background, F1]
>
> - [JD ask 1]: [C##] [C##]
> - [JD ask 2]: [C##]
> - [JD ask 3]: [C##]
> - [JD ask 4]: [C##]
> - [Disclosure if a must-have has no claim]
>
> [Profile link]

---

## Pre-send checklist

- [ ] The kit cites the job ID and `detail.fetched_at` from `data/state/jobs.json`. Never draft against a posting that was not fetched
- [ ] Every JD ask label comes from the fetched posting. Company facts carry a URL
- [ ] Every bullet traces to a usable claim ID. No unbanked fact
- [ ] Ran `authentic-prose`. No em dashes, no semicolons
- [ ] Checked against Never claim in `collateral/claim-bank.md`
- [ ] Background is two sentences. Dates are absolute
- [ ] The CV is attached. No pricing anywhere
- [ ] `[C##]` tags stripped
