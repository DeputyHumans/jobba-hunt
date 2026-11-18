---
name: hunt-tailor
description: "Use when a job needs its own CV and cover letter: called by /hunt-loop (auto-apply, approval package, an Apply with no tailored set, an email-only role keyed email-<thread id>), or when the operator asks to tailor a CV or letter for a job id. Also use for edit mode, when the operator comments on a tailored CV or letter review document. Freezes the posting's terms before any drafting, drafts the CV from master.json units and usable claims only, measures it against the frozen terms in rounds, picks one of four letter approaches (A to D) and writes the letter, builds both with every check, and routes them to review (a private bikeshed document each, or auto under the operator's standing decision; a B or C letter always goes to review). It never applies."
---

# /hunt-tailor <job id> [edit]

Run from the repo root. Read `AGENTS.md` first. The workflow is `docs/tailoring.md`; the commands are `npm run tailor -- <command> --job <id>` (`scripts/tailor.mjs`). Every command prints one JSON line. Pass each path exactly as a command printed it.

| Exit (`npm run tailor`) | Meaning |
|---|---|
| 0 | Done |
| 1 | Refused or a check failed: read `error` (and `report` or `detail`). `status` exits 1 when the job has no tailoring record |
| 2 | Usage (no command or no `--job`, an unknown command, or `--jd` without `--company` and `--title`) |
| 3 | bikeshed refused the update (the doc is open in the editor, a suggestion is pending, or the base moved): retry at the next firing |
| 4 | bikeshed signed out: tell the operator once to run `npm run bikeshed -- login` |

## Preconditions
- `preferences.tailoring.cv` is `per-job`. In `archetype` mode do not run this skill: the CV-creation rule in `workspace/collateral/cv-map.md` applies.
- The job has a fetched posting: the tick's detail view in `workspace/data/state/jobs.json` (`detail.description_text`, `detail.fetched_at`), or, for a role known only from a JD file, that file (an email's own text, or a description the operator pasted or a recruiter sent). A role from mail is keyed by its opportunity's job id `email-<thread id>`. Never draft against a posting nobody fetched or supplied.
- Read: `workspace/collateral/claim-bank.md` (only Claims-table rows with status `user-confirmed`, `public` or `CV`), `workspace/collateral/cv/master.json`, `workspace/collateral/cv/never-claim.json`, the archetype variants in `workspace/collateral/cv/variants/` (schema and baseline), `workspace/profile/voice.md`, `preferences.tailoring` (`letter`, `review`, `max_rounds`), and `docs/tailoring.md` "Cover letters".

## Steps

1. **Prepare.** `npm run -s tailor -- prepare --job <id>`. For a role known only from a JD file: `npm run -s tailor -- prepare --jd <file> --company "<company>" --title "<title>" --job <id>` (from mail: `--job email-<thread id>`). It writes `jd.txt` and `jd.terms.suggested.txt` in `workspace/data/applications/<id>/` and starts `tailor.json`. Exit 1 means no posting (or no JD file at that path): stop.
   - `prepare` is refused once the terms are frozen: the yardstick never changes for a job.
2. **Write `jd.terms.txt`** in the same folder, from the posting only, before any drafting:
   - the must-haves, the stack, the domain and the title words; 5 to 40 lines, one term per line, `|` between alternatives (`CI/CD|continuous delivery`), `#` for comments;
   - each term as the posting spells it: a term the posting text does not contain is not counted;
   - every real must-have, whether or not a claim covers it. Never choose terms because a CV already has them. The suggested file lists known vocabulary and the posting's requirement lines; mine the lines too.
3. **Freeze.** `npm run -s tailor -- freeze --job <id>`. It locks `jd.terms.txt` by hash and measures the baseline: the best archetype CV against those terms (`baseline.slug`, `baseline.pct`, `baseline.missing`). The terms never change after this; a changed file is refused.
4. **Draft** `workspace/data/applications/<id>/cv/<slug>.json` in the variant schema (the files in `collateral/cv/variants/` show it; `docs/tailoring.md`):
   - `slug`: the file name without `.json`, unique, never the slug of a standard variant (the build refuses a duplicate). Use `<role-title-slug>-<id>`.
   - `share`: a role-title slug (`head-of-platform`). It names the file the employer receives (`<file_prefix>-cv-<share>.pdf`). Never the company.
   - `target_title`, `headline`, `summary { text, claims }`, `highlights [{ label, text, claims }]`, `skills [{ label, terms, claims }]`, `experience [{ role, title?, context?, items }]` (bullet keys from `master.json`, or `{ "sub": "<subhead key>" }`), `earlier` (role keys).
   - Optional: `title` (the page title) and `description` (the page's meta description); `practice { role, title?, context?, items, clients?, heading? }`, a section after Experience for the operator's own practice (`clients: true` lists the role's `clients`; the default heading is "Independent Practice"); `contact { location?, workplace?, phone? }` for this CV's contact line (`workplace: null` drops a remote line that would misread for an on-site role; `phone` is `"profile"` or `null`, never a number).
   - Only `master.json` bullets, roles, titles, contexts, subheads and usable claim IDs. Selection, order, headline, summary, highlights and skills are tuned to the frozen terms. Every text unit cites at least one claim.
   - The summary and highlights go through `authentic-prose`, matched to `profile/voice.md`. No fact beyond the cited claims.
   - `target_keywords`: the frozen terms. `honest_gaps`: every frozen term no usable claim covers. A gap is never written into the CV.
   - No target company name in `slug`, `share`, `title`, `description`, `target_title`, `headline`, `summary`, `highlights`, `skills`, `practice.heading`, `practice.title` or `contact.location`, even when the operator once worked there (that role stays in `experience` or `practice` by key). `build` refuses a CV that names it.
5. **Measure in rounds.** `npm run -s tailor -- measure --job <id>` (add `--slug <slug>` when the folder holds more than one draft). It records the round and prints `pct`, `baseline`, `missing` and `continue`.
   - While `continue` is true: revise the draft so it carries more of `missing`, only where a usable claim supports the term (another bullet, a different order, a summary or skills line built from claims). A term no claim covers goes to `honest_gaps`. Then measure again.
   - Stop when `continue` is false (no gain, nothing missing, or `preferences.tailoring.max_rounds` reached).
   - Measure after every edit: `build` judges the last measured round.
6. **Letter.** Write `workspace/data/applications/<id>/cover-letter.json` (schema in `scripts/lib/cover.mjs`; `docs/tailoring.md` "cover-letter.json").
   - **Pick the approach.** A fixed `preferences.tailoring.letter` (`A` to `D`) forces that approach; `build` refuses any other. Under `per-job` (the default), pick one per posting by the table in `docs/tailoring.md` "Picking an approach", and write `approach_why`: one line naming what in the posting decided it. `build` refuses a per-job letter without it.
   - **Fields:** `job_id`, `approach`, `approach_why`, `company`, `role`, `ref` (workplace and job id), `date`, `greeting`, `closing`, `paragraphs`. Optional: `to` (default `<company>, hiring team`), `map_left` and `map_right` (map column heads).
   - **Blocks** in `paragraphs`: a text block `{ text, claims }` (`claims: []` only for the opening line; `kind: "rampup"` styles a ramp-up line); a map `{ map: [{ ask, answer, claims }] }`; a list `{ list: [{ text, claims }], ordered }`; a P.S. `{ ps, claims }`.
   - **Structure each approach needs** (`build` checks it):

     | Approach | Structure |
     |---|---|
     | A, requirements map | One `map` with at least 3 rows: each `ask` quoted verbatim from `jd.txt`, each `answer` claim-backed with its `claims`. No list. At most one `kind: "rampup"` line, "Where I would ramp up: ...", naming the must-haves in `honest_gaps`, and only those |
     | B, first two weeks | One list with `ordered: true` of 2 to 4 plan steps, each citing a claim (each step rests on work done before). No map. After the list, a paragraph citing the record behind it |
     | C, three questions | One list with `ordered: false` of 2 to 4 questions, each ending in "?". No map. After the list, a paragraph citing the record behind it |
     | D, lean letter plus P.S. | 2 to 4 text paragraphs, at least one citing a claim. No map or list. At most one P.S., last, citing a claim |

     A P.S. belongs to approach D only.
   - The availability line, from `profile/answers.json` `facts.start_date`.
   - 100 to 260 words. No em dashes, no semicolons, no rates, no figure a claim does not carry. Run every sentence through `authentic-prose`.
   - **B and C always go to the operator's review,** whatever `tailoring.review` says (step 8). A letter sent without review is approach A or D.
7. **Build.** `npm run -s tailor -- build --job <id>`. Gates: the terms unchanged, the last round at or above `baseline.pct`, no target company name. Then every CV check (claims, never-claim lint, page count, fonts, text layer, `honest_gaps`, repeated wording, sheets) and, with `cover-letter.json` present, the letter checks (approach and structure, claims, lint, word count, one page). A rebuilt set needs a fresh approval: `build` clears `docs_approved_at` in the job state.
   - Exit 1: read `error`. CV problems are at `report.report[].problems`. Letter problems are at `report.errors` and `report.lint` (letter checks) or `report.problems` (PDF checks). A claim the bank holds but does not allow is named with its status. Fix the draft or the letter, measure again after a CV edit, and rebuild. Never hand-edit a rendered file.
   - **Fallback:** a draft that stays below the baseline after the last round is not sent. Run `npm run -s tailor -- fallback --job <id>`: the baseline archetype CV (built already; otherwise `npm run cv -- --variant <slug>` first) and the job's letter become the set, logged as `tailor.fallback`. Then `review` as usual. Say "fallback" in the question and on the review card.
8. **Review.** `npm run -s tailor -- review --job <id>`. It follows `preferences.tailoring.review`:

| Mode | What happens | Next |
|---|---|---|
| `bikeshed` (default) | The CV and the letter are each published as their own private document in the reviews folder (`config/tracker.json` `bikeshed.reviews_folder_id`), listed in `workspace/data/tracker/review-docs.json` for the comment watch, and the role is marked `docs_review: pending`. A rebuilt set updates the same documents and needs a fresh approval | PushNotification: "Review: `<Title>` @ `<Company>`" with both links. The tracker shows a "Needs you" card. The operator's comments arrive through the watch (edit mode below) |
| `auto`, letter A or D (or no letter) | The documents are marked approved under the standing decision in `profile/decisions.md` (`review: "auto"`, `approved: true`) | Nothing |
| `auto`, letter B or C | Published for review exactly as `bikeshed`; the JSON carries `reason` | As `bikeshed` |
| publisher `local` | Prints `review: "session"` and the files (with `reason` for a B or C letter) | Show the operator the files inside the ask window and record `approve-docs` on their word |

9. **Report** to the caller: the CV share PDF (`record.docs.cv.share_pdf` from `npm run -s tailor -- status --job <id>`), the letter PDF (`record.docs.letter.pdf`), the letter approach and `approach_why`, the coverage against the baseline, the honest gaps, and the review links.

## Edit mode (a comment on a review document)
1. Read the comment's `quote` and `text`. Find the passage in the draft (`cv/<slug>.json` or `cover-letter.json`).
2. Revise from claims only, through `authentic-prose` for changed prose. A change that needs a fact the claim bank lacks: ask the operator for its source and wording, add it to the Pending table with a P ID, and use it only after the operator confirms it (it then takes the next free C ID).
3. **"use approach `<A-D>`":** redraft the letter in that approach (step 6), with an `approach_why` that cites the operator's choice. Under a fixed `tailoring.letter` the build refuses another approach: ask whether to change the standing preference (a `profile/decisions.md` row) before redrafting.
4. Take every open thread on that document in the same revision.
5. A CV change: `measure`, then `build`. A letter-only change: `build`. Then `review`, which updates the same documents.
6. Reply naming what changed (`npm run -s bikeshed -- reply <doc> <thread_id> "<what changed>"`), then `npm run -s bikeshed -- resolve <doc> <thread_id>`.
7. A set the operator had already approved needs a fresh approval after an edit: do not submit until the operator approves the revised set.

**Approval** on the operator's "approve" (comment or session): `npm run -s triage -- approve-docs --id <id> --note "<the operator's words>"`. For a role outside the job state (`email-<thread id>`) it records the approval in `data/applications/<id>/tailor.json` and prints `job_state: false`. "use archetype": the fallback set of step 7 replaces the tailored one, and the role needs the operator's "Apply". The operator's checklist for a review is `templates/review-doc.md`; put its Role, Coverage, Letter approach, Honest gaps and document rows in the push notification.

## Never
- Draft before `jd.terms.txt` is frozen, or change it after.
- Use a claim whose status is not `user-confirmed`, `public` or `CV`, a retired claim, one absent from the Claims table, or a bullet that is not in `master.json`.
- Patch a missing term into the CV or the letter. It is a gap.
- Name the target company in the CV.
- Send a B or C letter without the operator's review.
- Copy a tailored CV into `collateral/cv/variants/`: it would move every coverage score.
- Apply, or approve on the operator's behalf.
