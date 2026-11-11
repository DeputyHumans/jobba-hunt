---
name: hunt-kit
description: "Use when the operator decides to pursue a role (an opportunity file at stage shortlisted, or an Apply answer in /hunt-loop), or asks to prepare an application, an intro note or the CV pick for a job. Produces company research with source URLs, a fit matrix with honest odds, the CV and letter pick, an intro note run through authentic-prose, a claim-source table and a submission checklist, all in the opportunity file. It never applies or sends: submission goes through the apply runner (/hunt-loop step 4b) after the operator's Apply, or the operator submits by hand."
---

# /hunt-kit <opportunity file | job id>

Run from the repo root. Read `CLAUDE.md` first. Paths starting `workspace/` are in the workspace (`$JOBBA_HOME` when set).

## Preconditions (stop and say which one fails)
- The opportunity file exists in `workspace/pipeline/opportunities/` at stage `shortlisted`. Given only a job id, create it first, as `/hunt-triage` step 6 does.
- The job has a fetched description in `workspace/data/state/jobs.json`. Cite its job id and `detail.fetched_at`. **Never draft against a posting the tick did not fetch.**

## Steps
1. **Read** the job record (`description_text`, top card, triage), `workspace/collateral/claim-bank.md`, `workspace/collateral/cv-map.md`, `workspace/collateral/intro-templates.md`, and the profile kit for the source (`workspace/docs/kits/linkedin-profile-kit.md` or `dice-profile-kit.md`).
2. **Research the company** with the harness's WebSearch and WebFetch. Use firecrawl or Perplexity only when the harness provides them (`preferences.research.extra_tools`). Send search tools only public names (company, role), never the operator's data.
   - Collect only facts with a URL: what the company does, stage and funding, founders, team size, stack hints, and news from the last 6 months.
   - What cannot be found goes under "Open questions for the first call". Never guess.
3. **Fit matrix.** Quote each JD must-have, map it to claim IDs, and name the gap plainly. State the odds in one line, with the reason.
4. **CV and letter.**
   - **When `/hunt-loop` sent the role,** the operator already approved a CV (and letter) with "Apply". Use those.
   - **Per-job tailoring (default):** use the job's tailored set (`npm run -s tailor -- status --job <id>`: `record.docs.cv.share_pdf`, `record.docs.letter.pdf`). With none yet, run `/hunt-tailor <id>`.
   - **Archetype mode:** `npm run -s cv -- --match <job_id>` ranks the CVs by coverage of the posting's vocabulary and lists the missing terms. Apply the CV-creation rule in `cv-map.md`. A new variant is built only from claim-bank claims, by editing `workspace/collateral/cv/variants/` and running `npm run cv -- --variant <slug>`.
   - Put the missing terms in the fit matrix as gaps. Never patch them into a CV. Never hand-edit a rendered CV. Never attach a file listed under "Never attach" in `cv-map.md`.
5. **Intro note.**
   - Fill the archetype skeleton from `intro-templates.md`, one bullet per JD ask in JD order, claims only.
   - Run it through `authentic-prose`, matched to `workspace/profile/voice.md`: the operator's openers, words and rhythm; very clear English; no em dashes or semicolons.
   - Keep the structure the role's channel expects.
6. **Claim-source table.** Every claim in the note, the CV and the letter gets its claim ID and source. A claim missing from the bank stops the kit: ask the operator for its source and wording, and add it to the Pending table. Never add it silently, and never use it before the operator confirms it.
7. **Submission checklist.** Run the consistency items from the profile kit. Any open item that contradicts the CV blocks submission; mark it in the checklist.
8. **Write it all** into the opportunity file. Set `stage: kit-ready`, `next_action: the operator says Apply (or submits by hand)`, `next_action_due:` today. Add a stage-log row.

## After the operator says they submitted
- By hand: `npm run -s triage -- applied --id <id> --note "<the operator's words>"`.
- Set `stage: applied`, `applied_on:` today, and leave `next_action` and `next_action_due` empty: no follow-up dates.
- Add a stage-log row.

## Never
- Submit, apply, message or upload anything on the operator's behalf.
- Copy NDA material into the workspace or the repo. Link to where it lives.
- Put pricing in the kit. Pricing waits for the `proposal` stage (`/hunt-status`).
