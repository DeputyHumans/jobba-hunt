---
title: CV Map
updated: YYYY-MM-DD
status: Draft
---

# CV Map

**Generated from one source.** `npm run cv -- --all` builds every CV from:
- `collateral/cv/master.json`: the roles and a bullet bank, every text unit tagged with claim IDs from `collateral/claim-bank.md`
- `collateral/cv/variants/<slug>.json`: headline, summary, highlights, skills, bullet selection, `target_keywords`, `honest_gaps`

## Build checks

A build fails on any of these:

| Check | Rule |
|---|---|
| Pages | Exactly `preferences.cv.pages` pages, on `preferences.cv.paper` (`letter` or `a4`) |
| Fonts | Every font embedded and named. No Type 3 font |
| Text layer | The PDF text layer reads in order: the name first, the email present |
| Never-claim lint | No hit from `collateral/cv/never-claim.json`, on the source model and on the PDF text |
| Claims | Every text unit cites at least one claim ID from the Claims table of the bank (a retired ID fails) |
| Honest gaps | Every target keyword the CV cannot carry is listed in `honest_gaps` |
| Repeated wording | No 5-word phrase appears twice (rule below) |
| Company names | A variant names no company it targets (a rule, checked in review). The tailoring gate refuses a tailored CV that names the target company |
| Sheets | The screen HTML splits at the PDF's own page starts. A sheet that overflows, a missing footer, or a browser print with a different page count fails the build |

**Pick a CV per posting:** `npm run cv -- --match <job_id>` ranks the CVs by coverage of that posting's vocabulary. The slug is the `archetype` value from triage (`fit-profile.md`).

## Archetype map

Share PDFs live in `data/out/cv/share/`, named `<file_prefix>-cv-<share>.pdf` (`profile/person.json` `file_prefix`). `/hunt-onboard` phase 8 builds the first variants and adds their rows.

| Archetype and slug | Attach (share PDF) | Evidence (calibration or postings it was measured on) | Gaps to disclose (`honest_gaps`) |
|---|---|---|---|

## Rules

| # | Rule |
|---|---|
| 1 | Never hand-edit a rendered HTML or PDF. Edit `master.json` or a variant, then run `npm run cv -- --all` |
| 2 | New wording enters the bullet bank only with claim IDs, and must pass the lint |
| 3 | The contact line comes from `profile/person.json`. No phone unless `show_phone_on_cv` is true |
| 4 | An experience entry may set `"title": "<key>"` to pick a title from the role's `titles` in `master.json`, and `"context": "<key>"` to pick a context line. An unknown key fails validation |
| 5 | New summaries and highlights go through `authentic-prose` (voice in `profile/voice.md`) before they are rendered |
| 6 | A new archetype variant follows the CV-creation rule below, never a hunch |
| 7 | After every build, `npm run cv-publish` puts each CV's rendered HTML in its own private bikeshed document. Unchanged renders are skipped |
| 8 | The same rendered HTML goes everywhere: review doc, CV publish, tracker link and PDF. A CV never has a second, plainer rendering |

Operator rules (each with its `profile/decisions.md` date):

| # | Rule | Decision date |
|---|---|---|

## CV-creation rule

**Per-job tailoring is the default** (`preferences.tailoring.cv: "per-job"`). Every application gets its own CV and letter from the claim bank through `/hunt-tailor` (`npm run tailor -- prepare / freeze / measure / build / review --job <id>`; the workflow is in the repo's `docs/tailoring.md`). The tailored CV must cover at least as much of the frozen JD terms as the best archetype variant. Archetype variants are the baselines it is measured against, and the fallback when tailoring cannot beat them.

**Archetype mode** (`preferences.tailoring.cv: "archetype"`) turns per-job tailoring off. The triage `archetype` then picks the CV, and `--match` only checks it, because raw coverage favours the most keyword-dense CV. A domain CV is attached only when the archetype is that domain. With `config/apply.json` `auto_apply.cv_pool` set, `auto` instead takes the best-covering CV of the role's lane pool (the archetype's on a tie, a domain CV still only for its own domain).

| Case | Action |
|---|---|
| The archetype's variant covers at least `preferences.cv.min_coverage` % of the posting's vocabulary (`npm run cv -- --match <job_id>`) | Attach that variant's share PDF |
| The archetype has no variant, or it covers less | Draft `collateral/cv/variants/<archetype-slug>.json`: bullets from `master.json` with their claim IDs, summary and highlights through `authentic-prose`, the posting's claimable terms in `target_keywords`, the rest in `honest_gaps`. Build with `npm run cv -- --variant <slug>`; every check must pass |
| The new variant beats the archetype's variant (or, with none, the best non-domain CV) by at least `preferences.cv.keep_margin` points on `npm run cv -- --match <job_id> --candidate <slug>` (its own keywords stay out of the vocabulary) | Keep it. Add its row to the archetype map. The question to the operator marks it "new CV", so the operator's "Apply" approves the CV too |
| Otherwise | Delete the draft and attach the archetype's variant. The missing terms go into the fit matrix as gaps |

Slugs name archetypes, never companies, so every variant is reusable. No company name ever goes into a variant.

## Targeted CVs (outside the archetype inventory)

`--match` builds its vocabulary from every variant's `target_keywords`. A CV made for one list, board or bid therefore stays out of `collateral/cv/variants/`: an extra variant would shift every coverage score and the auto-apply coverage bar. All claim, lint and build rules above still apply.

| Kind | Folder | Build output | Notes |
|---|---|---|---|
| Per-job tailored | `data/applications/<job_id>/cv/<slug>.json`, frozen terms in `jd.terms.txt` | `data/out/cv/<job_id>/` (`npm run tailor -- build`) | Never copied into `variants/` |
| Recruiter list | `pipeline/recruiter/<YYYYMMDD-list>/` with `jd/`, `cv/`, `roles.json`, `bikeshed.json` | `data/out/cv/<YYYYMMDD-list>/` | Never in `share/` or auto-apply. Its pages carry no recruiter name and no process text |
| Board profile | `pipeline/channels/<board>/cv/` | `data/out/cv/<board>/` | The resume a job board shows recruiters (`docs/kits/`) |
| Proposal | `pipeline/proposals/<YYYYMMDD-archetype>/cv/` | `data/out/cv/<YYYYMMDD-archetype>/` | Team-member CV for a bid. The folder names the archetype, never the buyer |

| Step | Command |
|---|---|
| Build | `npm run cv -- --dir <folder>/cv --all` |
| Measure | `npm run cv -- --match jd/<role>.txt --terms jd/<role>.terms.txt --dir <folder>/cv --candidate <slug>`. The term list is written from the posting before any CV is drafted. The bar is still `keep_margin` points over the best standard CV |
| Publish | `npm run cv-publish -- --dir <folder>/cv`, into the private bikeshed subfolder its `bikeshed.json` names. With no `folder_id` it refuses |
| Pages (recruiter lists) | `npm run recruiter-pages -- --dir pipeline/recruiter/<list> [--publish]` renders the index and role analysis from `roles.json`. It refuses a page that names anyone in `never_show`, a role whose dimension scores do not add up to its fit score, and any page with a script |

## No repeated wording

The build fails any CV, standard or targeted, that says the same 5-word phrase twice (`repeatedPhrases` over the summary, highlights, skills and experience lines; the header and footer are excluded). When a highlight carries a fact that a dated experience bullet also states, reword the highlight. The bullet stays the detailed record.

## Never attach

Superseded or conflicting files in `sources/` that must never go out, with the reason (stale contact data, banned claims, unembedded fonts).

| File | Why |
|---|---|
