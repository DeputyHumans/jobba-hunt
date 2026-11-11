---
title: Claim Bank
updated: YYYY-MM-DD
status: Draft
---

# Claim Bank

> **Rules.**
> - Every CV, cover letter, intro note, screening answer, mail draft and profile kit uses only claims from the Claims table: the exact wording, or a shorter paraphrase that adds no fact.
> - A new claim needs (1) a source (a file in `sources/` with its page, a URL, or a dated statement by the operator, quoted) and (2) the operator's confirmation. Until both exist it sits in the Pending table and nothing may use it.
> - A confirmed claim takes the next free C ID. C IDs are never renumbered or reused.
> - A claim found false is retired in place: its claim cell starts with `**Retired**` and the row stays, so the ID is never reused.
> - The Do-not-say column lists the tempting variants that overstate a claim. `collateral/cv/never-claim.json` enforces the ones a regex can catch.
> - A must-have no claim covers is a gap (`honest_gaps`, the fit matrix, the letter's ramp-up line). It is never patched into a document.

**Next free ID:** C01
**Count:** 0 claims, 0 retired.

How the scripts read this file: every line that starts `| C<nn> |` is a usable claim ID, unless its claim cell starts with `**Retired`. Pending rows therefore carry `P` IDs, and examples stay inside one-line comments.

## Source key

| Key | Origin |
|---|---|
| `src:<file>#p<n>` | An original in `sources/` (CV, letter, profile export), page n. Written by `/hunt-onboard` phase 2 |
| `user:YYYY-MM-DD` | The operator's own statement in a session. Quote the words in the Source cell |
| `form:YYYY-MM-DD` | The operator's answer to an application question. Quote the question and the answer |
| `url:<url>` | A public page, checked to load on the date given |

## Status legend

| Status | Meaning | Table | Usable |
|---|---|---|---|
| `pending` | Extracted or proposed, not yet confirmed by the operator | Pending | No |
| `user-confirmed` | The operator confirmed the wording; the source is on file | Claims | Yes |
| `public` | Confirmed, and verifiable on a public URL | Claims | Yes |
| `CV` | Confirmed, and present in a CV the operator supplied | Claims | Yes |
| retired | Found false or withdrawn (`**Retired**` in the claim cell) | Claims | No |

Categories: `leadership`, `AI/agentic`, `stack`, `domain`, `security/compliance`, `education`, `contact`.

## Claims

| ID | Claim (exact safe wording) | Category | Source | Status | Do-not-say variants |
|---|---|---|---|---|---|
<!-- Example (delete when the first real claim is added): | C01 | 12+ years in software, from production code to leading a 40-engineer platform group. | leadership | src:cv-original.pdf#p1 | CV | "15 years"; "led 100 engineers"; any title not held | -->

## Pending

Candidates waiting for the operator's confirmation. On confirmation the row moves to Claims with the next free C ID, in the wording the operator approved. A rejected candidate is deleted, or moved to Never claim when it states something false.

| ID | Candidate claim | Category | Source | Question for the operator |
|---|---|---|---|---|
<!-- Example: | P01 | Led the migration of a monolith to services. | stack | src:cv-original.pdf#p2 | Which years, and was it your team or a shared program? | -->

## Never claim

Each row is a fact the operator cannot claim, or a wording that misstates a true fact. `/hunt-onboard` phase 3 fills it from the claims review; every later "no, I never did that" from the operator adds a row. Rows that a regex can catch also go into `collateral/cv/never-claim.json`.

| Never claim | Why |
|---|---|
<!-- Example: | A VP Engineering title (never held) | user:YYYY-MM-DD: "I was never a VP" | -->
