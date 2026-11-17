---
name: hunt-interview
description: "Use when the operator has a screening call or interview booked (\"prep me for the call with <company>\", an interview request card, a stage moved to screening) or has just finished one and gives notes or names a recording. `brief` writes a call brief from templates/interview-brief.md: company facts each with a source URL, the role decoded from the fetched posting, a fit map and spoken answers from confirmed claims only, and number guardrails. `debrief` writes what was said from templates/interview-debrief.md, and turns any new statement into a pending claim. Both live in workspace/pipeline/interviews/. It never sends anything."
---

# /hunt-interview brief|debrief <opportunity file | job id>

Run from the repo root. Read `CLAUDE.md` first. Paths starting `workspace/` are in the workspace (`$JOBBA_HOME` when set).

## Inputs
- The opportunity file in `workspace/pipeline/opportunities/` (stage, research, fit matrix, stage log).
- The job record in `workspace/data/state/jobs.json`: the fetched `description_text` and `detail.fetched_at`. An email-only role (`job_id: email-<thread id>`) uses its thread file in `workspace/pipeline/mail/`.
- What was sent: the approved CV and letter (`application.cv`, `application.cover_pdf`), the job's answers (`workspace/data/applications/<id>/answers.json`), and the mail thread.
- `workspace/collateral/claim-bank.md`, `workspace/collateral/screening-answers.md`, `workspace/profile/answers.json`, `workspace/profile/voice.md`.
- The call details (when, medium, who) from the operator or the mail thread. Never guessed.

## Brief
1. **File:** copy `templates/interview-brief.md` to `workspace/pipeline/interviews/YYYYMMDD-<company-slug>-<role-slug>-<stage>-brief.md` (the call date).
2. **Call card (section 1):** the call details, the posted band verbatim or "not stated", what was sent, the JD source (job id and `fetched_at`), open items.
3. **Research (sections 3 to 6)** with the harness's WebSearch and WebFetch; firecrawl or Perplexity only when the harness has them. Send search tools only public names (company, role, the interviewer's public name and title), never the operator's data.
   - Every fact carries its source URL: founded, funding, size, customers, news from the last 6 months, people and their public roles, the product and technical approach.
   - What cannot be found is an open question, never a guess.
   - JD lines are quoted from the fetched description, then decoded.
4. **Fit map (section 7):** each JD requirement against confirmed claims only, as `C##` plus its sayable form, with a strength. A requirement no claim covers is named as a gap.
5. **Answer bank (section 8):** spoken answers of 20 to 45 seconds, claims only, the IDs after each. Reuse the confirmed answers in `screening-answers.md`. New wording goes through `authentic-prose`, matched to `profile/voice.md`. If a likely follow-up goes past a claim, the answer stops at the claim.
   - Logistics (work authorization, location, start date) come from `profile/answers.json` and `screening-answers.md`.
   - Salary, rate and budget answers are `[bracketed]` lines only the operator fills. Never a number from a draft.
6. **Number guardrails (section 9):** one row per figure the call may touch. "Say" is the exact figure a claim carries; "Never say" lists the tempting inflations (the claim's Do-not-say column: more years, a bigger team, a title not held). Comp numbers come only from the operator.
7. **Questions to ask, risks, checklist, sources** (sections 10 to 13). Risks are for the operator's own decision.
8. **Page:** `npm run brief -- <brief.md> --write-claims` renders the designed HTML next to the markdown (claim IDs open the exact claim-bank wording; a `<stem>-glossary.json` of `{ "terms": [{ "term", "def", "here" }] }` adds term hints). It fails on a claim ID the bank does not hold. A CV named outside a link is a warning: link the exact version sent. With the bikeshed publisher, publish the HTML as its own private document in the tracker's folder (`npm run bikeshed -- publish <brief.html> --title "<Company> brief: <role> (<date time>)" --folder <config/tracker.json bikeshed.folder_id> --json`) and revise it with `npm run bikeshed -- update <docId> <brief.html>`.
9. **Opportunity file:** add a stage-log row ("brief written") with the brief's path and the page's URL.

## Debrief
1. **Source:** the operator's notes, or a recording or transcript the operator names. Nothing inferred is written as said.
2. **File:** copy `templates/interview-debrief.md` next to the brief, as `...-<stage>-debrief.md`.
3. Fill the outcome, the role as described, the process, what the operator covered, and next steps.
4. **Keep consistent:** each statement the operator made that the claim bank does not cover is listed. It enters `claim-bank.md` only as a Pending row (P ID, source `user:YYYY-MM-DD` with the quote), and only after the operator confirms its wording.
5. **Opportunity file:** add a stage-log row with the call date and outcome. A stage change follows `/hunt-status` (a loss: ask whether the role belongs in `workspace/data/calibration.json`).

## Never
- Invent a fact, a number, a person's background or a call outcome.
- Put a rate or salary figure in a draft. It is `[RATE]` or a bracketed line for the operator.
- Send, book or message anything. The operator does.
- Copy NDA material into the workspace. Link to where it lives.
