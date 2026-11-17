# Tailoring

By default every application gets a CV and a cover letter tailored to that job from the claim bank. This file is the workflow behind `/hunt-tailor` and `npm run tailor -- <step> --job <id>` (`scripts/tailor.mjs`), the review option, and the document format. The agent drafts; the script freezes the yardstick, measures each draft, builds the documents with every check, and routes them to review.

Settings: `profile/preferences.json` `tailoring`:

| Key | Values | Default |
|---|---|---|
| `cv` | `per-job` (a tailored CV for every application) or `archetype` (per-job tailoring off: archetype variants only, `collateral/cv-map.md`) | `per-job` |
| `letter` | `per-job` | `per-job` |
| `review` | `bikeshed` (each newly tailored set is published for the operator to approve first) or `auto` (sent without review) | `bikeshed` |
| `max_rounds` | Measured draft rounds before the build | 3 |

## Steps

All files are in `data/applications/<id>/`. The record of every step is `tailor.json` there, shown by `status`.

| # | Command | Does | Writes |
|---|---|---|---|
| 1 | `npm run tailor -- prepare --job <id> [--jd <file> --company <c> --title <t>]` | Needs a fetched posting: the tick's detail view, or a JD file for a role that arrived by email or from a recruiter (recorded as `posting_source: file:...`). Refused once the terms are frozen. Copies the posting text and suggests terms: the vocabulary the claim bank and CVs already know that the posting uses, plus the posting's requirement lines as comments | `jd.txt`, `jd.terms.suggested.txt`, `tailor.json` |
| 2 | The agent writes `jd.terms.txt` | From the suggestions and the posting: must-haves, stack, domain and title words. 5 to 40 terms, one per line, `\|` for alternatives, `#` for comments | `jd.terms.txt` |
| 3 | `npm run tailor -- freeze --job <id>` | Locks `jd.terms.txt` by hash and measures the baseline: the best archetype CV against those terms. The terms never change after this; a changed file is refused | `tailor.json` (`terms_hash`, `baseline`) |
| 4 | The agent drafts the CV | In the variant schema, from `collateral/cv/master.json` bullets and confirmed claim IDs only. Selection, order, headline, summary, highlights and skills are tuned to the terms. Summary and highlights go through `authentic-prose`. No target company name | `cv/<slug>.json` |
| 5 | `npm run tailor -- measure --job <id> [--slug <slug>]` | Scores the draft against the frozen terms and records the round. `continue` stays true while a round improved and rounds remain (`max_rounds`). Missing terms that no confirmed claim covers are gaps: they go to `honest_gaps`, never into the CV | A round in `tailor.json`; an action-log entry |
| 6 | The agent writes the letter | Approach A, the requirements map (`docs/cover-letter-approaches.md`), from the same frozen terms, through `authentic-prose` | `cover-letter.json` |
| 7 | `npm run tailor -- build --job <id> [--slug <slug>]` | The gates: frozen terms unchanged; the last round at or above the baseline; no target company name in the text the draft writes itself (slug, share, title, headline, summary, highlights, skills; roles from `master.json` may still name a past employer). Then builds the CV with every CV check and, when `cover-letter.json` exists, the letter with the letter checks | CV render in `data/out/cv/<id>/`; letter `.html`, `.pdf`, `.png`, `cover-letter.txt`; `tailor.json` status `built` |
| 8 | `npm run tailor -- review --job <id>` | Routes the built set by `tailoring.review` (below) | Review documents, `data/tracker/review-docs.json`, `docs_review` in `data/state/jobs.json` |
| 8b | `npm run tailor -- fallback --job <id>` | When no draft reaches the baseline after the last round: the baseline archetype CV (already built) and the job's letter become the set, logged as `tailor.fallback`; review follows as usual | `tailor.json` docs with `fallback: true` |
| 9 | `npm run tailor -- status --job <id>` | The job's tailoring record, and whether the documents are approved | Nothing |

The terms are frozen first so the CV is never measured against a vocabulary it shaped. A draft that stays below the baseline after the last round is not built: the best archetype CV (`collateral/cv-map.md`) is used instead, or the draft is revised.

**Exit codes:** 0 ok; 1 refused or a check failed (the JSON names which); 2 usage; 3 bikeshed refused the update (the document is open in the editor, a suggestion is pending, or there is a newer base); 4 bikeshed signed out (`npm run bikeshed -- login`).

**Layout options a variant or tailored CV may use** (all optional, every unit still from `master.json` with claim IDs):

| Field | Effect |
|---|---|
| `practice` `{role, context, items, clients: true, heading}` | A section after Experience for one's own consultancy or freelance work, default heading "Independent Practice"; `clients: true` prints the role's `clients` as "Featured clients" |
| `contact` `{location, workplace: null, phone: "profile" \| null}` | The header line for one target role: a different location, no workplace (an on-site role), and the phone from `profile/person.json` shown or hidden (default `show_phone_on_cv`). Never a literal number |
| `master.json` `links`, `employers` + role `via`, education `note` | Clickable company and product names, "Client (via Employer)" roles, "Degree (note)" |

A role with three bullets or fewer and no sub-heads never breaks across pages; a longer one may split 2 + 2.

**Archetype variants stay.** `/hunt-onboard` phase 8 builds them from `master.json`. They are the baseline every tailored draft is measured against, and the fallback. `tailoring.cv: "archetype"` turns per-job tailoring off.

## Review (`tailoring.review`)

### `bikeshed` (default)

1. `review` publishes the CV and the letter **each as its own private document** in the `Reviews` folder (`config/tracker.json` `bikeshed.reviews_folder_id`, else `folder_id`), titled `Review · <company> · <role> · CV` and `... · cover letter`. Because each document is the real rendering, a comment on a passage stays anchored to that passage.
2. The documents are recorded in `data/tracker/review-docs.json` for the comment watch, and the role's `docs_review` becomes `pending`. A push notification and a "Needs you" card on the tracker point the operator at them. What the operator checks: `templates/review-doc.md`.
3. The comment watch (`npm run watch`) reports each comment as soon as it arrives:

| Comment | Effect |
|---|---|
| A change on a passage | Redrafted from claims, measured, rebuilt, `review` run again: it updates the same documents. Reply, resolve |
| `approve` | `npm run triage -- approve-docs --id <id> --note "<the operator's words>"`. Reply, resolve |
| `Apply` | `approve-docs`, and the role's own approval (`npm run triage -- approve`) together |
| A thread with no text yet | Left open: the operator is still typing |

4. **A rebuilt set needs a fresh approval.** `build` and `review` clear `docs_approved_at` when the documents change: an approval covers the text the operator read, never a later revision.
5. **Auto-apply waits on it.** In per-job mode with `bikeshed` review, `npm run triage -- auto` lists "tailored documents are waiting for review approval (approve-docs)" as a blocker until the documents are approved. An auto-apply-eligible role then needs nothing more; any other role still needs its "Apply".

### `auto`

`review` marks the documents approved under the standing decision (`docs_review: auto`), with no document published. The decision is written to `profile/decisions.md` at onboarding, in the operator's words.

### Publisher `local`

With `config/tracker.json` `publisher: local` there are no review documents. `review` lists the HTML files to show the operator in the session, inside the ask window, and `approve-docs` is recorded on the operator's word.

## How `auto` uses the tailored set

In per-job mode, `npm run triage -- auto --id <id>`:
- takes the CV from `tailor.json` (`docs.cv.share_pdf`); no tailored CV is a blocker ("no tailored CV for this job yet");
- measures coverage as the last measured round of the built draft, against `config/apply.json` `auto_apply.min_cv_coverage`;
- uses the tailored letter as the cover-letter PDF unless `--cover-pdf` names another;
- requires `approve-docs` first when the review mode is `bikeshed`.

In archetype mode it picks the archetype's share CV and measures it with `npm run cv -- --match <id>`.

## Where tailoring is called

| Caller | When |
|---|---|
| `/hunt-loop` | Each tier A/B role before the auto-apply rule and before the question; an "Apply" with no tailored set yet |
| Inbox outreach replies | `outreach-fit` cards that need a CV |
| `/hunt-recruiter` | Each role on a recruiter list (its output stays in the list folder) |

The tracker links each CV and letter that was sent.

## Document format

The CV and letter format is ported unchanged: `brand/cv/template.css`, `brand/cv/cover.css` and `scripts/lib/cv-pages.mjs`.

| Medium | Behaviour |
|---|---|
| Screen | Each page is a sheet (Letter, 8.5 × 11 in, by default) with a soft shadow on a grey page background (`#e6e9ee`), with a footer on every page. Narrow screens fall back to stacked full-width sheets |
| Print | `@page { margin: 0 }`, one sheet per page with `break-after: page`, and the print footer |
| Pagination | Static: the HTML is split at the PDF's own page starts, because bikeshed sandboxes scripts. The `.page-body` overflow check stays |
| Letters | Reuse the CV's header, type scale and colour tokens, so a CV and its letter read as a set. The requirements-map layout (map head, quoted asks, the ramp-up line) is unchanged |

What differs from the original format:
- `pageStarts` reads page text through `scripts/lib/pdf.mjs` (pdfjs-dist), not an external tool.
- Fonts are the bundled OFL set through `@font-face` (Charis SIL for the serif, Nunito Sans for the sans). The type scale, margins and spacing keep the original density and page count.
- `preferences.cv.paper` (`letter` by default, `a4`) switches the sheet size and `@page`.

**One rendering everywhere:** the review documents, the CV publish, the tracker's letter link and the PDF all use the same rendered HTML. A document never has a second, plainer rendering.
