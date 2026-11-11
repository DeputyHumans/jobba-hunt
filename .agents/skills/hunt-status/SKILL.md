---
name: hunt-status
description: "Use when the operator asks where the hunt stands, what is due, how the pipeline is converting, or what happened recently, or reports a stage change on an opportunity (a reply, a screening call, an NDA, a proposal, a win, a loss). Shows the board by stage from workspace/pipeline/opportunities/, flags due actions, gives three metrics and run health from the action log and caps, updates stages, and hands proposals off to workspace/pipeline/proposals/<client>/."
---

# /hunt-status [stage update] [--write]

Run from the repo root. Read `CLAUDE.md` first. Paths starting `workspace/` are in the workspace (`$JOBBA_HOME` when set).

## Board
1. **Read the frontmatter** of every `workspace/pipeline/opportunities/*.md`: `stage`, `tier`, `score`, `applied_on`, `next_action`, `next_action_due`.
2. **Print the board** grouped by stage, in this order: inbound, shortlisted, kit-ready, applied, screening, nda, proposal, negotiating, then won / lost / withdrawn as counts only.
3. **Flag what is due:**
   - `next_action_due` today or earlier
   - `shortlisted` older than 2 days with no kit: offer `/hunt-kit`
   - a call booked with no brief in `workspace/pipeline/interviews/`: offer `/hunt-interview`
4. **Metrics** (only these three):

   | Metric | How it's measured |
   |---|---|
   | Tier A roles surfaced in the last 7 days | `npm run -s log -- --since 7d --json`: rows with `action: "triage.recorded"` whose `detail` starts `tier A` |
   | Applications that turned into a first call | count at `screening` or later ÷ count at `applied` or later |
   | Signed contracts or offers accepted | count at `won` |

5. **Run health.**
   - The newest `workspace/data/raw/*-tick.json` and `*-sweep.json` per source: date, `aborted`, `budget_exhausted`.
   - Halts: `halt_until` and `sources.dice.halt_until` in `workspace/data/state/jobs.json`.
   - Caps used today: `npm run -s jobs -- limits` and `npm run -s dice -- limits`.
6. **Recent activity:** `npm run log -- --since <date>` (add `--job <id>` for one role's history). Every halt clearing, cap override and channel verification it lists must have a row in `workspace/profile/decisions.md`; name any that does not.

With `--write`, save the board to `workspace/pipeline/digests/YYYYMMDD-status.md` with frontmatter (`title`, `created`, `updated`, `status: Draft`, `tags`).

## Stage updates ("X replied", "screening call booked", "lost Y")
- Update `stage`, `updated`, `next_action` and `next_action_due`, and add a stage-log row with the date and the operator's note.
- **Screening or NDA:** record the call dates and offer `/hunt-interview`. Material under NDA stays outside the workspace: link to it, never copy it.
- **Proposal handoff:**
  1. Create `workspace/pipeline/proposals/<client-slug>/`.
  2. Set `offer_folder: pipeline/proposals/<client-slug>/` in the opportunity frontmatter.
  3. Draft the scope from the opportunity file and claims only. Pricing comes only from numbers the operator states in the session (or their standing rates in `workspace/profile/answers.json` `facts.rate_hourly` and `facts.rate_annual`); the operator approves every number.
  4. A team CV for the bid follows the Proposal row of the targeted-CV table in `workspace/collateral/cv-map.md`.
  5. Collateral uses the neutral brand (`preferences.brand`): the operator's name as the wordmark.
- **Won / lost / withdrawn:** set the stage and record the reason in one line. For a loss, ask the operator whether the role belongs in `workspace/data/calibration.json`.

## Never
- Send follow-ups, emails or platform messages. The operator sends.
- Invent replies or call outcomes. A stage changes only on the operator's word or a fetched email.
- Put a floor or a rate in the board, the status file or the tracker.
