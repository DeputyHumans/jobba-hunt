# Tailoring

By default every application gets a CV and a cover letter tailored to that job from the claim bank. This file explains how that works: `/hunt-tailor`, `npm run tailor -- <command> --job <id>` (`scripts/tailor.mjs`), the review step, the document format and the four letter approaches. The agent drafts. The script freezes the yardstick, measures each draft, builds the documents with every check, and routes them to review. The rules are in `AGENTS.md` "Honesty" and "Tailored documents".

Settings: `profile/preferences.json` `tailoring`.

| Key | Values | Default |
|---|---|---|
| `cv` | `per-job`: a tailored CV for every application. `archetype`: per-job tailoring off, archetype variants only (`collateral/cv-map.md`) | `per-job` |
| `letter` | `per-job`: `/hunt-tailor` picks approach A, B, C or D for each posting and writes `approach_why`. `A`, `B`, `C` or `D`: that approach only, and `npm run cover` refuses any other ("Cover letters") | `per-job` |
| `review` | `bikeshed`: each newly tailored set is published for the operator to approve first. `auto`: sent without review, except a B or C letter | `bikeshed` |
| `max_rounds` | Measured draft rounds before the build | 3 |

`npm run onboard -- validate` refuses any other value. A fixed letter, `review: auto` and `cv: archetype` are standing decisions, recorded in `profile/decisions.md` (`AGENTS.md` "Questions and the loop").

## Steps

All files are in `data/applications/<id>/`. `tailor.json` there records every step, and `status` prints it.

| # | Command | Does | Writes |
|---|---|---|---|
| 1 | `npm run tailor -- prepare --job <id> [--jd <file> --company <c> --title <t>]` | Needs a fetched posting: the tick's detail view (`detail.description_text` and `detail.fetched_at`), or a JD file for a role from email or a recruiter (recorded as `posting_source: file:<path>`). `--jd` without `--company` and `--title` exits 2. Refused once the terms are frozen. Copies the posting and suggests terms: the variants' `target_keywords` and skill terms that the posting uses, plus the posting's requirement lines as comments | `jd.txt`, `jd.terms.suggested.txt`, `tailor.json` (status `drafting`) |
| 2 | The agent writes `jd.terms.txt` | From the suggestions and the posting: must-haves, stack, domain and title words. 5 to 40 terms, one per line, `\|` between alternatives, `#` for comments | `jd.terms.txt` |
| 3 | `npm run tailor -- freeze --job <id>` | Locks `jd.terms.txt` by hash and measures the baseline: the best archetype CV against those terms. From then on a changed file is refused | `tailor.json` `terms_hash`, `terms_frozen_at`, `baseline` (`slug`, `pct`, `missing`) |
| 4 | The agent drafts the CV | In the variant schema, from `collateral/cv/master.json` units and usable claim IDs only. Selection, order, headline, summary, highlights and skills are tuned to the terms. Summary and highlights go through `authentic-prose`. No target company name | `cv/<slug>.json` |
| 5 | `npm run tailor -- measure --job <id> [--slug <slug>]` | Scores the draft against the frozen terms and records the round. `--slug` is needed when `cv/` holds more than one draft. Prints `pct`, `baseline`, `missing` and `continue`. `continue` is true only while rounds remain (`max_rounds`), terms are still missing, and the last round beat the one before (the first round always continues). A missing term that no usable claim covers is a gap: it goes to `honest_gaps`, never into the CV | A round in `tailor.json`, a `tailor.round` action-log entry |
| 6 | The agent writes the letter | The approach `tailoring.letter` allows ("Cover letters"), quoting the posting from `jd.txt`, through `authentic-prose` | `cover-letter.json` |
| 7 | `npm run tailor -- build --job <id> [--slug <slug>]` | The gates: the frozen terms unchanged, a measured round for this draft with the last one at or above the baseline, and no target company name ("The company-name gate"). Then it builds the CV with every CV check and, when `cover-letter.json` exists, the letter with every letter check. For a role in the job state, a rebuild clears an earlier approval of the set | The CV in `data/out/cv/<id>/` (a dated folder and `share/`). The letter `<file_prefix>-cover-letter-<company-slug>.{html,pdf,png}` and `cover-letter.txt`. `tailor.json` `docs`, status `built` |
| 8 | `npm run tailor -- review --job <id>` | Routes the built set by `tailoring.review` ("Review") | Review documents, `data/tracker/review-docs.json`, `application.docs_review` in `data/state/jobs.json` |
| 8b | `npm run tailor -- fallback --job <id>` | For a draft that cannot reach the baseline: the baseline archetype CV and the job's letter (rebuilt) become the set, logged as `tailor.fallback`. The archetype CV must already be built (`npm run cv -- --variant <slug>`). Review follows as usual | `tailor.json` `docs` with `fallback: true` |
| 9 | `npm run tailor -- status --job <id>` | Prints the tailoring record and `approved` (the role's `docs_approved_at` in the job state) | Nothing |

The terms are frozen first, so the CV is never measured against a vocabulary it shaped. A draft below the baseline is never built: revise it, or send the fallback set.

**Exit codes:** 0 ok. 1 refused or a check failed (the JSON names which). 2 usage. 3 bikeshed refused the update (the document is open in the editor, a suggestion is pending, or there is a newer base). 4 bikeshed signed out (`npm run bikeshed -- login`).

**The company-name gate** (`companyLeak` in `scripts/tailor.mjs`). `build` refuses a CV whose own fields name the target company:

| Checked | Exempt |
|---|---|
| `slug`, `share`, `title` (the page title), `description` (the meta description), `target_title`, `headline`, `summary`, `highlights`, `skills`, `practice.heading`, `practice.title`, `contact.location` | Experience and practice entries: they point at `master.json` roles and bullets by key, so an operator who once worked for that employer keeps the role |

A trailing Inc, LLC, Ltd, Corp, Corporation, Co, GmbH or PLC is dropped from the company name before the match. A name shorter than 3 characters is not checked.

**Layout options a variant or tailored CV may use.** All are optional. Every unit still comes from `master.json` with claim IDs.

| Field | Effect |
|---|---|
| `practice` `{role, title?, context?, items, clients?, heading?}` | A section after Experience for one's own consultancy or freelance work. `role` is a `master.json` role key. `title` and `context` pick from that role's `titles` and `contexts` (the context defaults to `default`). `items` are bullet keys or `{ "sub": "<sub-head key>" }`, and the sub-heads render as in Experience. `heading` defaults to "Independent Practice". `clients: true` prints the role's `clients` as "Featured clients" |
| `contact` `{location?, workplace?, phone?}` | The header line for one target role: another location, `workplace: null` for an on-site role, and `phone: "profile"` (the number in `profile/person.json`) or `phone: null`. Without `phone`, `person.json` `show_phone_on_cv` decides. Never a literal number. Any other key is refused |
| `master.json` `links` | `{ "<company or product name>": "<url>" }`: each name links on the CV |
| `master.json` `employers`, role `via` | `employers: { "<key>": { name, dates, claims } }`. A role with `"via": "<key>"` was a client engagement through that employer and prints as "Client (via Employer)". On a Workday form the runner merges those client roles into one entry under the employer's name and dates, with each client's context line as the description, and lists the practice entry after the experience (`workdayHistory` in `scripts/lib/apply-forms.mjs`) |
| `master.json` education `note` | Prints "Degree (note)" |

A role with three bullets or fewer and no sub-heads never breaks across pages. A longer one may split 2 + 2.

**Archetype variants stay.** The Baseline CVs phase of `/hunt-onboard` builds them from `master.json` (`docs/setup.md` "Onboard"). They are the baseline every tailored draft is measured against, and the fallback. `tailoring.cv: archetype` turns per-job tailoring off.

## Review (`tailoring.review`)

### `bikeshed` (default)

1. `review` publishes the CV and the letter **each as its own private document** in the reviews folder (`config/tracker.json` `bikeshed.reviews_folder_id`, else `folder_id`; with neither it exits 1). The titles are `Review · <company> · <role> · CV` and `Review · <company> · <role> · cover letter`. Each document is the real rendering, so a comment on a passage stays anchored to that passage.
2. The documents are recorded in `data/tracker/review-docs.json` for the comment watch, and the role's `docs_review` becomes `{ status: "pending", url, letter_url }`. A push notification and a "Needs you" card on the tracker point the operator at them. What the operator checks: `templates/review-doc.md`.
3. The comment watch (`npm run watch`) reports each comment as soon as it arrives:

| Comment | Effect |
|---|---|
| A change on a passage | `/hunt-tailor` edit mode: redrafted from claims, then `measure` (after a CV change), `build` and `review`, which updates the same documents. Reply, resolve |
| `approve` | `npm run triage -- approve-docs --id <id> --note "<the operator's words>"`. Reply, resolve |
| `Apply` | `npm run triage -- decide --id <id> --decision pursue`, then `approve-docs`, then `npm run triage -- approve --id <id> --cv <docs.cv.share_pdf> --cover-pdf <docs.letter.pdf>`, each with the operator's words. Reply, resolve |
| `use archetype` | `tailor -- fallback`, then `review`. The operator's words approve that set: run `approve-docs` after the publish. Reply, resolve |
| A thread with no text yet | Left open: the operator is still typing |

4. **A rebuilt set needs a fresh approval.** `build` clears the role's `docs_approved_at`, and `review` sets `docs_review` back to pending. An approval covers the text the operator read, never a later revision.
5. **Auto-apply waits on it.** With `cv: per-job` and `review: bikeshed`, `npm run triage -- auto` lists "tailored documents are waiting for review approval (approve-docs)" as a blocker until the documents are approved. An auto-apply-eligible role then needs nothing more. Any other role still needs its "Apply".

A role outside the job state (an email or recruiter role, "Where tailoring is called") has no entry in `jobs.json`. `review` writes nothing there, and `approve-docs` records the approval in the role's `tailor.json` instead (`status: approved`, `docs_approved_at`). Its output says `job_state: false`.

### `auto`

`review` marks the documents approved under the standing decision (`docs_review: "auto"`, `docs_approved_at`), with no document published. The decision is in `profile/decisions.md`, in the operator's words.

A letter of approach B or C always waits for the operator's review (`AGENTS.md` "Tailored documents"). Under `auto`, `review` publishes such a set exactly as under `bikeshed`, or lists its files under publisher `local`. Its output carries `reason: "letter approach <B or C> always waits for the operator's review"`.

### Publisher `local`

With `config/tracker.json` `publisher: local` there are no review documents. `review` prints `review: "session"` and the HTML files. The agent shows them to the operator in the session, inside the ask window, and records `approve-docs` on the operator's word.

## How `auto` uses the tailored set

With `cv: per-job`, `npm run triage -- auto --id <id>`:
- takes the CV from `tailor.json` `docs.cv.share_pdf`. No tailored CV is a blocker: "no tailored CV for this job yet (/hunt-tailor)".
- measures coverage against `config/apply.json` `auto_apply.min_cv_coverage`. The coverage is the last measured round of the built draft, or `baseline.pct` when the set is a fallback (`tailor -- fallback`).
- uses the tailored letter (`docs.letter.pdf`) as the cover-letter PDF unless `--cover-pdf` names another, and its `cover-letter.txt` for cover-letter text boxes.
- requires `approve-docs` first when the review mode is `bikeshed`.
- requires `approve-docs` for a B or C letter in any review mode. The blocker reads "letter approach <B or C> needs the operator's review (approve-docs)".

With `cv: archetype` it ranks the CVs with `npm run cv -- --match <id>` and takes the archetype's CV. With `auto_apply.cv_pool` it takes the best-covering CV of the role's lane instead: the archetype's on a tie, and a `domain` CV only for a role whose archetype is that CV. The output then names it in `cv_slug`, with `archetype_coverage`.

The apply runner also refuses a real submit with an unapproved B or C letter (exit 2, `docs/runbook.md` "Apply outcomes").

## Where tailoring is called

| Caller | When |
|---|---|
| `/hunt-loop` | Each tier A/B role, before the auto-apply rule and before the question. An "Apply" with no tailored set yet |
| Inbox: an email-only role worth an application | `/hunt-tailor` with the email's text saved as the JD file: `npm run tailor -- prepare --job email-<thread id> --jd <file> --company <c> --title <t>`. The id is the opportunity file's `job_id`, `email-<thread id>` |
| A recruiter's JD sent as a single role | The same JD-file flow (`AGENTS.md` "Honesty") |
| `/hunt-onboard`, Baseline CVs phase | A rehearsal on one calibration role (`--job rehearsal-1 --jd <file>`) through `build`. Never reviewed or sent, and deleted afterwards |

Email and recruiter roles have no job state. `jobs.json` is untouched, and `approve-docs` records their approval in `data/applications/<id>/tailor.json`.

`/hunt-recruiter` does not call tailoring. It runs its own flow for each role on a list (`npm run cv -- --match <jd> --terms <terms> --dir <list>/cv --candidate <slug>`), and its output stays in the list folder.

**Tracker links.** The tracker links each CV and letter that was sent.

| Document | Links to |
|---|---|
| A tailored CV (built under `data/out/cv/<job id>/`) | That job's review document in `data/tracker/review-docs.json`. Never a standard CV that shares its `share` name |
| A standard CV, including a fallback | Its own render (`npm run cv-publish`) |
| A sent letter | Its published copy (`npm run tracker -- --publish` publishes sent letters to `bikeshed.letters_folder_id`, else `folder_id`). It falls back to the job's letter review document when the letter was never published |

## Document format

The CV and letter format lives in `brand/cv/template.css`, `brand/cv/cover.css` and `scripts/lib/cv-pages.mjs`. A file of the same name under `workspace/brand/` overrides the repo's.

| Medium | Behaviour |
|---|---|
| Screen | Each page is a sheet (Letter, 8.5 × 11 in, by default) with a soft shadow on a grey page background (`#e6e9ee`), with a footer on every page. Screens narrower than a sheet show the pages as plain full-width cards |
| Print | `@page { margin: 0 }`, one sheet per page with `break-after: page`, and the print footer |
| Pagination | Static, because bikeshed sandboxes scripts. `npm run cv` reads where each PDF page starts (`scripts/lib/pdf.mjs`, pdfjs-dist) and splits the HTML there into sheets. A sheet whose `.page-body` overflows fails the build |
| Paper | `preferences.cv.paper`: `letter` (default) or `a4` sets the sheet size and `@page` |
| Fonts | The bundled OFL fonts, inlined through `@font-face`: Charis SIL for the serif, Nunito Sans for the sans |
| Letters | One sheet. They reuse the CV's header, type scale and colour tokens, so a CV and its letter read as a set. The map has a head row, the asks in italic quotes and the ramp-up line in smaller, muted type. B's plan is a numbered list, C's questions a bulleted list, and D's P.S. sits after the signature |

**One rendering everywhere:** the review documents, the CV publish, the tracker's letter link and the PDF all use the same rendered HTML. A document never has a second, plainer rendering.

## Cover letters

Four letter approaches. `preferences.tailoring.letter` decides which one a letter may use: under `per-job` (the default) `/hunt-tailor` picks one per posting and writes `approach_why`, and a fixed `A` to `D` allows that approach only. `scripts/lib/cover.mjs` (`validateCover`) checks each approach's structure, and `npm run cover -- --job <id>` (`scripts/build-cover.mjs`) builds the letter. `tailor -- build` and `tailor -- fallback` run that build too.

The example under each approach is a test fixture: `tests/fixtures/letters/a-requirements-map.json`, `b-first-two-weeks.json`, `c-three-questions.json` and `d-lean-ps.json`. They use the synthetic persona Jordan Example applying to Vandelay Industries, with claims from the synthetic claim bank in `tests/fixtures/workspace/`. `tests/cover-build.test.mjs` builds all four through `scripts/build-cover.mjs` (`npm run cover`) with every check, one page each. The header (name, contact line, To, Re, Date) is the same for every approach and is left out of the examples.

### Rules for every approach

Checked by the builder:

| Rule | Detail |
|---|---|
| Claims only | Every cited ID must be a usable row: the Claims table of `collateral/claim-bank.md`, status `user-confirmed`, `public` or `CV`. The builder refuses any other ID and names its status. Map rows, B's plan steps, the paragraph after a B or C list, and D's P.S. must cite at least one claim. A line that states no record (the opening line, a ramp-up line, a call invitation, C's questions) may have `claims: []` |
| Length | 100 to 260 words, counted over the greeting, every block and the closing. Map rows count their ask and answer, list items their text, and the P.S. counts with its "P.S.". The name and the header do not count |
| Punctuation | No em dash, no semicolon |
| Never-claim lint | `collateral/cv/never-claim.json`, on the letter text and on the PDF text layer |
| One page | In the CV's typography. The page view (the HTML sheet printed from a browser) must be one page too |
| Approach | The structure of the approach named in `approach`, below. A P.S. belongs to D only |

Drafting rules the builder cannot check:
- Quote the posting verbatim from `jd.txt`: the posting the tick fetched, or the JD file (`AGENTS.md` "Honesty").
- Every sentence goes through `authentic-prose`, matched to `profile/voice.md` (`AGENTS.md` "Voice and outbound copy").
- Never "best candidate" or "perfect fit". The fit shows through what is set next to what.
- No rates, no figure a claim does not carry, no story the claim bank does not hold.

### Comparison

| | A. Requirements map | B. First two weeks | C. Three questions | D. Lean letter plus P.S. |
|---|---|---|---|---|
| How it stands out | The posting's own words beside the record, plus one honest ramp-up line | Shows how the applicant would start, so the reader pictures them in the job | Questions only a practitioner asks, then the record behind them | Short paragraphs of record, and a P.S. that adds one more claim |
| Recruiter scan (staffing screens) | **Fastest**: a checklist ticked in 10 seconds | Medium | Medium | Fast |
| Hiring manager read | Strong | **Strongest** for a buyer who wants a plan | **Strongest** for a technical manager | Adequate |
| Honesty risk | Lowest: each row is a quote and a claim, and gaps are named | Medium: a plan can imply work never done | Low to medium: the questions must be sharp, and the tone can read as presumptuous | Low |
| Fit for generated letters | **High**: quotes plus claims, a fixed structure | Low: needs judgment per role | Low: question quality varies | High |
| Review | Follows `tailoring.review` | Always reviewed | Always reviewed | Follows `tailoring.review` |
| Length (the example below) | 144 words | 129 words | 118 words | 116 words |

### Picking an approach

| Situation | Approach |
|---|---|
| Recruiter-screened roles (staffing firms, Dice), and any posting with three or more quotable asks | **A.** Recruiters screen against the posting line by line, and A does that work for them. The ramp-up line buys trust a claim alone cannot |
| Fractional or interim leadership roles, where the buyer pays for a plan | **B** |
| Product companies with a technical hiring manager | **C** |
| A posting with fewer than three quotable asks | **D** |

`approach_why` gives the reason in one line, for example "A recruiter screens this posting against its list of requirements, so the map answers each line."

B and C always wait for the operator's review, whatever `tailoring.review` says:
- `tailor -- review` publishes a B or C set even under `review: auto`, and its output carries a `reason`.
- `triage -- auto` adds the blocker "letter approach <B or C> needs the operator's review (approve-docs)".
- The apply runner refuses a real submit with an unapproved B or C letter (exit 2).

So an unreviewed send (`review: auto`, including an auto-applied role) can only use A or D.

### A. Requirements map

Structure: one `map` block with at least 3 rows, each quoting one of the posting's asks verbatim beside a claim-backed answer. No list. At most one `kind: "rampup"` line, "Where I would ramp up: ...", naming the honest gaps and only those.

`approach_why`: "A recruiter screens this posting against its list of requirements, so the map answers each line."

> Hello Vandelay Industries team,
>
> Your posting lists what this role has to do. Here is what I bring to each part.
>
> | Your posting | My record |
> |---|---|
> | "Scale an engineering organization through rapid growth" | I grew Acme engineering from 12 to 45 engineers across six teams. |
> | "Improve delivery speed and reliability" | I cut release lead time at Acme from 10 days to under one day with trunk-based delivery and CI/CD. |
> | "Own security and compliance programs" | I led the SOC 2 Type II program at Acme to a clean first audit. |
> | "Hire and develop engineering leaders" | I built a structured interview loop at Globex that hired 35 engineers in 18 months, and I mentored eight engineers into management or staff roles. |
>
> Where I would ramp up: payments. My platform work so far has been in B2B software, not card processing.
>
> Happy to go through any row on a call.
>
> Best regards,
> Jordan Example

Claims: C03, C04, C05, C12, C22.

### B. First two weeks

Structure: one numbered list (`ordered: true`) of 2 to 4 plan steps, each citing at least one claim, because each step rests on work done before. No map. After the list, a paragraph citing the record behind the plan.

`approach_why`: "An interim leadership role: the buyer pays for a plan, so the letter opens with one."

> Hello Vandelay Industries team,
>
> If I joined as your interim VP of Engineering, this is how I would start.
>
> 1. Map how code reaches production for every team and remove the manual steps, as I did when I cut release lead time at Acme from 10 days to under one day.
> 2. Set service level objectives and error budgets with each team lead, the approach that brought the incident rate at Globex down 45%.
> 3. Agree a quarterly plan and its goals with product leadership, the way I have run planning before.
>
> I have led this work at scale. I grew Acme engineering from 12 to 45 engineers across six teams, and at Globex I led four managers and 60 engineers.
>
> Happy to walk through the plan on a call.
>
> Best regards,
> Jordan Example

Claims: C03, C04, C08, C11, C26.

### C. Three questions

Structure: one bulleted list (`ordered: false`) of 2 to 4 items, each ending in "?". No map. After the list, a paragraph citing the record behind the questions.

`approach_why`: "A product company with a technical hiring manager: questions a practitioner would ask show the fit faster than a list."

> Hello Vandelay Industries team,
>
> Three things I would want to understand first about your platform:
>
> - Which deploys still need a person to press a button, and why?
> - When a service fails at night, how long until the right engineer knows?
> - Do product teams own their services in production, or does one team own them all?
>
> I have had to answer these myself. At Acme I cut release lead time from 10 days to under one day with trunk-based delivery and CI/CD. At Globex the incident rate came down 45% after SLOs, error budgets and a reworked on-call, and I moved 140 services from on-premises hosting to AWS and Kubernetes.
>
> Happy to compare notes on a call.
>
> Best regards,
> Jordan Example

Claims: C04, C09, C11.

### D. Lean letter plus P.S.

Structure: 2 to 4 paragraphs, at least one citing claims. No map or list. An optional single P.S., the last block, citing a claim. It prints after the signature.

`approach_why`: "The posting names fewer than three asks a map could quote, so a short letter carries the record."

> Hello Vandelay Industries team,
>
> I'm applying for the VP of Engineering role.
>
> I have been Head of Engineering at Acme Corp since 2023, reporting to the CEO. In that time I grew the team from 12 to 45 engineers across six teams and cut release lead time from 10 days to under one day.
>
> Before that I was Director of Engineering at Globex, with four managers and 60 engineers. I built the interview loop that hired 35 engineers in 18 months, and I mentored eight engineers into management or staff roles.
>
> Best regards,
> Jordan Example
>
> P.S. I also report DORA metrics and engineering health to the board, and I am happy to share how I set that up.

Claims: C02, C03, C04, C08, C12, C22, C29.

### Not used, and why

- **A story** ("the night the deploy went wrong"): only when the claim bank holds that incident. Otherwise it would be invented.
- **Unsourced numbers** (uptime, cost saved, team velocity): only figures a claim carries.
- **Pinning a capability to a product or client** when the claim bank keeps them apart.

### `cover-letter.json`

Written to `data/applications/<job_id>/cover-letter.json`. Never hand-edit the rendered letter: edit this file and rebuild.

| Key | Required | Meaning |
|---|---|---|
| `job_id` | yes | The job the letter is for |
| `approach` | yes | `A`, `B`, `C` or `D`. Under a fixed `tailoring.letter`, only that one |
| `approach_why` | when `tailoring.letter` is `per-job` | One line on why this approach fits the posting |
| `company` | yes | Shown in the header and used for the file slug (accented letters keep their base letter) |
| `role` | yes | The "Re" line |
| `ref` | no | Appended to the "Re" line (workplace, job id). A ref naming on-site, hybrid or in-office drops the workplace (`Remote (US)`) from the header |
| `to` | no | Default `<company>, hiring team` |
| `date` | yes | As printed |
| `greeting` | yes | "Hello Vandelay Industries team," |
| `closing` | yes | "Best regards,". The name under it comes from `profile/person.json`, with `master.json` `person` fields over it: the same person block the CV prints |
| `map_left`, `map_right` | no | The map's column heads. Default "Your posting", "My record" |
| `paragraphs` | yes | The blocks, in order (below) |

| Block | Shape | Renders as |
|---|---|---|
| Paragraph | `{ text, claims, kind? }` | A paragraph. `kind: "rampup"` styles the ramp-up line |
| Map | `{ map: [{ ask, answer, claims }] }` | The two-column map. Every row needs `ask`, `answer` and at least one claim |
| List | `{ list: [{ text, claims }], ordered }` | `ordered: true`: a numbered plan (`<ol class="plan">`, B). `ordered: false`: questions (`<ul class="questions">`, C) |
| P.S. | `{ ps, claims }` | After the signature (D) |

**Outputs**, next to the JSON:

| File | Use |
|---|---|
| `<file_prefix>-cover-letter-<company-slug>.pdf` | The cover-letter upload |
| `<file_prefix>-cover-letter-<company-slug>.html` | The one-sheet page a published copy shows |
| `<file_prefix>-cover-letter-<company-slug>.png` | A screenshot of that sheet |
| `cover-letter.txt` | The text twin, for cover-letter text boxes |

The text twin runs greeting, blocks, closing and name, then the P.S. A map row becomes `Your posting: "<ask>"` then `My record: <answer>`. A numbered list becomes `1. ...`, a bulleted list `- ...`, and the P.S. `P.S. ...`.

`npm run cover -- --job <id>` exits 0 when every check passed (its JSON gives `words`, `pages`, `paper` and the file paths) and 1 when any failed (`errors`, `lint` or `problems` name each). It logs `letter.built` either way once rendered. Fixes for each refusal: `docs/troubleshooting.md` "Letters".
