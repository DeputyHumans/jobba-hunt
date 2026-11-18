---
name: hunt-tailor
description: "Use when a job needs its own CV and cover letter: called by /hunt-loop (auto-apply, approval package, an Apply with no tailored set), by /hunt-recruiter, or when the operator asks to tailor a CV or letter for a job id. Also use for edit mode, when the operator comments on a tailored CV or letter review document. Freezes the posting's terms before any drafting, drafts the CV from master.json bullets and confirmed claims only, measures it against the frozen terms in rounds, writes an approach A requirements-map letter, builds both with every check, and routes them to review (a private bikeshed document each, or auto under the operator's standing decision). It never applies."
---

# /hunt-tailor <job id> [edit]

Run from the repo root. Read `AGENTS.md` first. The workflow is `docs/tailoring.md`; the commands are `npm run tailor -- <command> --job <id>` (`scripts/tailor.mjs`). Every command prints one JSON line. Pass each path exactly as a command printed it.

| Exit (`npm run tailor`) | Meaning |
|---|---|
| 0 | Done |
| 1 | Refused or a check failed: read `error` (and `report` or `detail`) |
| 2 | Usage |
| 3 | bikeshed refused the update (the doc is open in the editor, a suggestion is pending, or the base moved): retry at the next firing |
| 4 | bikeshed signed out: tell the operator once to run `npm run bikeshed -- login` |

## Preconditions
- `preferences.tailoring.cv` is `per-job`. In `archetype` mode do not run this skill: the CV-creation rule in `workspace/collateral/cv-map.md` applies.
- The job has a fetched posting: the tick's detail view in `workspace/data/state/jobs.json` (`detail.description_text`, `detail.fetched_at`), or, for a role that reached the operator by email or from a recruiter, the posting text saved to a file (the email's own text, or a description the operator pasted). Never draft against a posting nobody fetched or supplied.
- Read: `workspace/collateral/claim-bank.md` (only the Claims table, statuses `user-confirmed`, `public`, `CV`, not retired), `workspace/collateral/cv/master.json`, `workspace/collateral/cv/never-claim.json`, the archetype variants in `workspace/collateral/cv/variants/` (schema and baseline), `workspace/profile/voice.md`, `docs/cover-letter-approaches.md`.

## Steps

1. **Prepare.** `npm run -s tailor -- prepare --job <id>`, or for an email-only role `npm run -s tailor -- prepare --job <mail-thread-id> --jd <file> --company "<company>" --title "<title>"`. It writes `jd.txt` and `jd.terms.suggested.txt` in `workspace/data/applications/<id>/` and starts `tailor.json`. Exit 1 means no posting: stop.
   - `prepare` is refused once the terms are frozen: the yardstick never changes for a job.
2. **Write `jd.terms.txt`** in the same folder, from the posting only, before any drafting:
   - the must-haves, the stack, the domain and the title words; 5 to 40 lines, one term per line, `|` between alternatives (`CI/CD|continuous delivery`), `#` for comments;
   - each term as the posting spells it: a term the posting text does not contain is not counted;
   - every real must-have, whether or not a claim covers it. Never choose terms because a CV already has them. The suggested file lists known vocabulary and the posting's requirement lines; mine the lines too.
3. **Freeze.** `npm run -s tailor -- freeze --job <id>`. It locks `jd.terms.txt` by hash and measures the baseline: the best archetype CV against those terms (`baseline.slug`, `baseline.pct`, `baseline.missing`). The terms never change after this; a changed file is refused.
4. **Draft** `workspace/data/applications/<id>/cv/<slug>.json` in the variant schema (the files in `collateral/cv/variants/` show it):
   - `slug`: the file name without `.json`, unique, never the slug of a standard variant (the build refuses a duplicate). Use `<role-title-slug>-<id>`.
   - `share`: a role-title slug (`head-of-platform`). It names the file the employer receives (`<file_prefix>-cv-<share>.pdf`). Never the company.
   - `target_title`, `headline`, `summary { text, claims }`, `highlights [{ label, text, claims }]`, `skills [{ label, terms, claims }]`, `experience [{ role, title?, context?, items }]` (bullet keys from `master.json`, or `{ "sub": "<subhead>" }`), `earlier` (role keys).
   - Only `master.json` bullets, roles, titles, contexts and confirmed claim IDs. Selection, order, headline, summary, highlights and skills are tuned to the frozen terms. Every text unit cites at least one claim.
   - The summary and highlights go through `authentic-prose`, matched to `profile/voice.md`. No fact beyond the cited claims.
   - `target_keywords`: the frozen terms. `honest_gaps`: every frozen term no confirmed claim covers. A gap is never written into the CV.
   - No target company name in `slug`, `share`, `target_title`, `headline`, `summary`, `highlights` or `skills`, even when the operator once worked there (that role stays in `experience`).
5. **Measure in rounds.** `npm run -s tailor -- measure --job <id>` (add `--slug <slug>` when the folder holds more than one draft). It records the round and prints `pct`, `baseline`, `missing` and `continue`.
   - While `continue` is true: revise the draft so it carries more of `missing`, only where a confirmed claim supports the term (another bullet, a different order, a summary or skills line built from claims). A term no claim covers goes to `honest_gaps`. Then measure again.
   - Stop when `continue` is false (no gain, nothing missing, or `preferences.tailoring.max_rounds` reached).
   - Measure after every edit: `build` judges the last measured round.
6. **Letter.** Write `workspace/data/applications/<id>/cover-letter.json`, approach A, the requirements map (`docs/cover-letter-approaches.md`; schema in `scripts/lib/cover.mjs`):
   - `job_id`, `company`, `role`, `ref` (workplace and job id), `date`, `greeting`, `closing`, and `paragraphs`.
   - One opening line (`claims: []` allowed), then a `map` block quoting 3 to 5 of the posting's asks verbatim from `jd.txt`, each with a claim-backed `answer` and its `claims`.
   - One `kind: "rampup"` line, "Where I would ramp up: ...", naming the must-haves in `honest_gaps`, and only those.
   - The availability line, from `profile/answers.json` `facts.start_date`.
   - 100 to 260 words. No em dashes, no semicolons, no rates, no figure a claim does not carry. Run every sentence through `authentic-prose`.
7. **Build.** `npm run -s tailor -- build --job <id>`. Gates: the terms unchanged, the last round at or above `baseline.pct`, no target company name. Then every CV check (claims, never-claim lint, page count, fonts, text layer, `honest_gaps`, repeated wording, sheets) and, with `cover-letter.json` present, the letter checks (one page, claims, lint, word count).
   - Exit 1: fix the draft or the letter as `error` and `report.problems` say, measure again after a CV edit, and rebuild. Never hand-edit a rendered file.
   - **Fallback:** a draft that stays below the baseline after the last round is not sent. Run `npm run -s tailor -- fallback --job <id>`: the baseline archetype CV (built already; otherwise `npm run cv -- --variant <slug>` first) and the job's letter become the set, logged as `tailor.fallback`. Then `review` as usual. Say "fallback" in the question and on the review card.
8. **Review.** `npm run -s tailor -- review --job <id>`. It follows `preferences.tailoring.review`:

| Mode | What happens | Next |
|---|---|---|
| `bikeshed` (default) | The CV and the letter are each published as their own private document in the reviews folder (`config/tracker.json` `bikeshed.reviews_folder_id`), listed in `workspace/data/tracker/review-docs.json` for the comment watch, and the role is marked `docs_review: pending`. A rebuilt set updates the same documents | PushNotification: "Review: `<Title>` @ `<Company>`" with both links. The tracker shows a "Needs you" card. The operator's comments arrive through the watch (edit mode below) |
| `auto` | The documents are marked approved under the standing decision in `profile/decisions.md` | Nothing |
| publisher `local` | Prints `review: session` and the files | Show the operator the files inside the ask window and record `approve-docs` on their word |

9. **Report** to the caller: the CV share PDF (`record.docs.cv.share_pdf` from `npm run -s tailor -- status --job <id>`), the letter PDF (`record.docs.letter.pdf`), the coverage against the baseline, the honest gaps, and the review links.

## Edit mode (a comment on a review document)
1. Read the comment's `quote` and `text`. Find the passage in the draft (`cv/<slug>.json` or `cover-letter.json`).
2. Revise from claims only, through `authentic-prose` for changed prose. A change that needs a fact the claim bank lacks: ask the operator for its source and wording, add it to the Pending table with a P ID, and use it only after the operator confirms it (it then takes the next free C ID).
3. Take every open thread on that document in the same revision.
4. A CV change: `measure`, then `build`. A letter-only change: `build`. Then `review`, which updates the same documents.
5. Reply naming what changed (`npm run -s bikeshed -- reply <doc> <thread_id> "<what changed>"`), then `npm run -s bikeshed -- resolve <doc> <thread_id>`.
6. A set the operator had already approved needs a fresh approval after an edit: do not submit until the operator approves the revised set.

**Approval** on the operator's "approve" (comment or session): `npm run -s triage -- approve-docs --id <id> --note "<the operator's words>"`. "use archetype": the fallback set of step 7 replaces the tailored one, and the role needs the operator's "Apply". The operator's checklist for a review is `templates/review-doc.md`; put its Role, Coverage, Honest gaps and document rows in the push notification.

## Never
- Draft before `jd.terms.txt` is frozen, or change it after.
- Use a claim that is pending, retired or absent from the Claims table, or a bullet that is not in `master.json`.
- Patch a missing term into the CV or the letter. It is a gap.
- Name the target company in the CV.
- Copy a tailored CV into `collateral/cv/variants/`: it would move every coverage score.
- Apply, or approve on the operator's behalf.
