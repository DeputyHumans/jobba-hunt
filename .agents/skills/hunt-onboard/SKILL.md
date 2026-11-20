---
name: hunt-onboard
description: "Use when the operator sets up the hunt for the first time (`/hunt-onboard`, \"set up the hunt\", \"onboard me\"), resumes an interrupted onboarding, or any command fails with \"No workspace found\". Builds a ready workspace phase by phase (preflight, init, ingest, claims, interview, answers, calibration, access, baseline CVs, searches, ready) from the operator's CVs, cover letters, profile export and answers, with conservative defaults, and records progress so it resumes where it stopped. It never types credentials and never applies."
---

# /hunt-onboard [phase]

Run from the repo root. Read `AGENTS.md` first, then `docs/setup.md` "Onboard" (its "Commands", "Phases", "Interview topics", "Fresh-install posture" and "Resuming"). The skill runs the conversation and writes the content; `npm run onboard -- <command>` creates, checks and tracks the workspace. Paths starting `workspace/` are in the workspace (`$JOBBA_HOME` when set).

| Command | Does | Exit |
|---|---|---|
| `npm run -s onboard -- status` | Phases done and `next` | 0 |
| `npm run -s onboard -- mark --phase <name>` | Records a finished phase: `preflight init ingest claims interview answers calibration access cvs searches ready` | 0; 2 unknown phase |
| `npm run -s onboard -- init` | Copies `templates/workspace/`; never overwrites a file | 0 |
| `npm run -s onboard -- ingest --file <path> [--file <path> ...]` | Copies PDF, DOCX, TXT or MD into `sources/` and writes page-tagged text next to each (`<name>.txt`) | 0; 1 missing file; 2 usage |
| `npm run -s onboard -- validate` | Checks the shape of every workspace file, and that `master.json` bullets and roles cite only usable claims | 0 clean; 1 `problems` (`[{ file, msg }]`) |
| `npm run -s onboard -- git-init` | Makes the workspace its own private git repository | 0 |
| `npm run -s onboard -- mail-guard --deny <tool,tool,...>` | Writes `permissions.deny` into `.claude/settings.local.json` | 0; 2 usage |

An unknown command exits 2.

## Resume
1. Run `npm run -s onboard -- status`. Start at `next`. A phase the operator names by argument runs again on request.
2. An interrupted phase runs again from its start. Files written before the interruption are kept; read them and continue from what they hold.
3. When a phase is done, run `npm run -s onboard -- mark --phase <name>` before the next one.

## Rules for every phase
- **Questions:** AskUserQuestion, at most 4 questions per call. Put the conservative default first and label it "(default)". Paths, wording and free text are asked in plain chat.
- **Write as you go:** write each answer to its file before the next call, so an interruption loses nothing.
- **Conservative defaults:** auto-apply off; tailoring `cv: per-job`, `letter: per-job`, `review: bikeshed`; every EEO answer `decline`; caps as shipped in `config/limits.json`; the per-company limit at 1; every channel unverified. The runner never creates ATS accounts.
- **Standing decisions:** any answer that sets a policy (auto-apply and its keys, review `auto`, a fixed letter approach, the company limit, agencies or aliases, an EEO value other than `decline`, a cap, scope) gets a row in `workspace/profile/decisions.md`: the date, the decision, the operator's own words, what it changed.
- **Facts:** only from the operator's sources or the operator's words. Only Claims-table rows with status `user-confirmed`, `public` or `CV` are usable; the builds and `validate` refuse any other and name its status.
- **Credentials:** never typed, asked for or read by the agent. Logins happen by hand, in the operator's own terminal.

## Phase 0: Preflight (`preflight`)
1. Run `npm run setup`, then `npm run doctor -- --preflight`.
2. For each `FAIL` row, show its `fix` line and wait for the operator to fix it; re-run the doctor. Warnings may stay.

## Phase 1: Init (`init`)
1. Run `npm run -s onboard -- init`. It marks the phase itself.
2. Ask whether to keep the workspace in its own private git repository. On yes: `npm run -s onboard -- git-init`.

## Phase 2: Ingest (`ingest`)
1. Ask for the file paths of the operator's CVs, cover letters and a profile export (LinkedIn: More > Save to PDF), and for their public links.
2. Run `npm run -s onboard -- ingest --file <path> [--file <path> ...]`. Read each `sources/<name>.txt` (pages are tagged `--- page <n> ---`).
3. Draft `workspace/collateral/cv/master.json`. Its `_comment` holds the full schema; read it first.
   - `person` (with `claims`), `bullets` (`<role-key>-<topic>`, in the source's wording), `education`, `languages`.
   - `roles` (`<role-key>`): `title`, `company`, `dates`, `claims` (required), `contexts.default` (a role shown in full) and `line` (a role shown inline among earlier roles). Optional: `titles` (alternate titles the operator held), `subheads` (program or team labels), `clients` (`[{ name, claims }]`, for a practice section) and `via` (the key of an `employers` entry, printed "Client (via Employer)").
   - Optional top-level `links` (`{ "<company or product>": "<url>" }`) and `employers` (`{ <key>: { name, dates, claims } }`); `education[].note` prints after the degree.
   - Every text unit cites the P ID of its candidate claim.
4. Add one candidate claim per fact to the **Pending** table of `workspace/collateral/claim-bank.md`: `| P<nn> | <candidate wording> | <category> | src:<file>#p<n> | <question for the operator> |`. Categories are in the file's legend.
5. Propose 3 to 8 voice samples for `workspace/profile/voice.md`, only from text the operator wrote and sent (letters, emails, posts), never CV bullets or agent drafts. Sanitize names, emails, phones, clients and figures to `[name]`, `[email]`, `[client]`, `[figure]`. Write a sample only after the operator confirms it.
6. Material under NDA is never ingested: link to it from where it lives.

## Phase 3: Claims (`claims`)
1. Show the pending claims in batches: one AskUserQuestion per claim, options "Confirm", "Edit" (the operator types the wording), "Reject".
2. **Confirm:** move the row to the **Claims** table with the next free C ID, in the approved wording. Status `CV` when it is in a CV the operator supplied, else `user-confirmed`. Fill the Do-not-say column with the tempting overstatements (more years, a bigger team, a title not held). Update "Next free ID" and "Count". Replace the P ID with the C ID everywhere in `master.json`.
3. **Edit:** the operator's wording, then as Confirm. Wording that adds facts beyond the source cites `user:YYYY-MM-DD` with the quote.
4. **Reject:** delete the row and the `master.json` units that cite it. A candidate that states something false becomes a **Never claim** row; one a regex can catch also becomes a pattern in `workspace/collateral/cv/never-claim.json` (`{ id, re, why }`).
5. Ask what must never be said: titles never held, confidential names, figures with no source. Each becomes a Never claim row (and a pattern where a regex fits).
6. C IDs are never renumbered or reused.
7. Run `npm run -s onboard -- validate`. It checks the claims of `master.json` bullets and roles only, and names any cited claim that is unknown or not usable by its status. The full check of every unit a CV uses (person, roles, titles, contexts, bullets, employers, clients, education, languages) runs with the first CV build, `npm run cv -- --all`, in phase 8.

## Phase 4: Interview (`interview`)
Rounds of at most 4 questions. Write each answer where the table says.

| Topic | Default | Writes |
|---|---|---|
| Identity and contact: name, display name, file prefix, email, application email, phone, location, workplace line (`Remote (US)`), links, phone on CV, start date | `show_phone_on_cv: false` | `profile/person.json` (`workplace` included); `profile/answers.json` `profile`, `facts.start_date` |
| Work authorization, sponsorship, legal entity, contract types | none | `answers.json` `facts` (`work_authorization`, `work_authorization_type`, `sponsorship`, `contracting_entity`, `contract_types`); `preferences.engagement.accept` |
| EEO self-identification | `decline` for each | `answers.json` `eeo`; a decisions row for any other value |
| Lanes, titles, seniority, engagement types, domains, buyer, capacity | both lanes | `preferences.lanes`, `preferences.engagement.accept`; `fit-profile.md` Target, G1, G3 |
| Location, home metro, travel, relocation | `remote_required: true`, no metros | `preferences.location` (`onsite_metros` as place regexes, `onsite_metro_label`); `answers.json` `facts.relocation`, `facts.remote`, address fields; `fit-profile.md` G2 |
| Standing form rates, IC rate floor, full-time salary floor and target | floors `null` (off) | `answers.json` `facts.rate_hourly`, `facts.rate_annual`; `preferences.money` |
| Exclusions: stacks, title words, companies | empty | `config/prefilter.json` `stack_title_drop`, `ic_title_drop`, `company_drop`, `onsite_metro_markers` |
| Schedule, ask window, time zone, reset hour | the template's values in the operator's time zone | `preferences.schedule` |
| Platforms: LinkedIn, Dice | both | which probes phase 9 runs |
| Tailoring: per-job or archetype CVs; review in bikeshed or auto-send | `cv: per-job`, `review: bikeshed` | `preferences.tailoring.cv`, `review`; a decisions row for `auto` or `archetype` |
| Letter approach (`docs/tailoring.md` "Cover letters"): picked per job, or one fixed approach (A requirements map, B first two weeks, C three questions, D lean letter plus P.S.). B and C always wait for review | `per-job` | `preferences.tailoring.letter`; a decisions row for a fixed approach |
| Auto-apply | off | `config/apply.json` `auto_apply` (`enabled`, `min_score`, `channels`, `min_cv_coverage`, `cover_letter`, `cv_pool` for archetype mode); a decisions row for each key the operator sets |
| One application per company | `limit: 1`, no agencies, no aliases | `config/apply.json` `companies` (`limit`, `agencies`: staffing posters that count only as their end client, `aliases`: `{ "Brand": "Legal name" }`); a decisions row for each |

Then draft every `<fill>` in `workspace/fit-profile.md` from the answers and the claims, per `docs/fit-profile-guide.md`: observable anchors, decidable from the posting alone, tied to claims, never comp. The operator confirms each section. `fit-profile.md` must agree with `preferences.json`; where they differ, the preferences file wins.

## Phase 5: Answers (`answers`)
1. Draft Q01-Q21 in `workspace/collateral/screening-answers.md` from claims only, through `authentic-prose` matched to `profile/voice.md`. No source: "Gap: ask the operator", and ask. Q13 (rate) stays deferred to the proposal stage; Q18 is never pre-written.
2. The operator confirms each answer (AskUserQuestion, 4 per call).
3. Single-value answers go to `profile/answers.json`. A form question the operator answers now: `npm run apply -- learn --label "<question>" --answer "<answer>"`. A question asking whether an AI, a bot or an agent applies is never learned: `learn` refuses it (exit 2), and the runner hands such a form to the operator.
4. Run `npm run -s apply -- check-answers` and ask about each empty value the operator wants filled.

## Phase 6: Calibration (`calibration`)
1. The operator names 5 to 15 roles with the expected verdict: a clear positive, at least one negative control per gate (G1 to G4), and one ordering pair. Each description is pasted by the operator, or fetched from a public posting page they link.
2. Write `workspace/data/calibration.json`: `roles` (`job_id` as a neutral string such as `cal-01`, `label`, `title`, `company`, `location`, `employment_type`, `description_text`, `source`) and `expectations` (`order` with `higher` and `lower`; `tier_at_least` with `label` and `tier`; `gate_is` with `label`, `gate`, `value`; `reject_on` with `label` and `gate`). Labels name the case, never the answer the scorer would copy from a job id.
3. Run `/hunt-triage calibrate`. It must pass. On a failure, propose a rubric edit to `fit-profile.md`; apply it only on the operator's yes; run calibration again. Never tune the rubric to one role.

## Phase 7: Access (`access`)
1. **LinkedIn and Dice.** Ask the operator to run, in their own terminal in the repo folder: `npm run jobs -- login` (sign in in the window, then press Enter) and `npm run dice -- login`. Never run a login from the agent's shell: it has no keyboard for the Enter step and leaves the profile locked. Then run `npm run -s jobs -- whoami` and `npm run -s dice -- whoami` (one page load each). Skip a platform the operator does not use.
2. **Mail adapter** (AskUserQuestion: "none (default)", "gws", "bridge"). Write `workspace/config/mail.json`: `adapter`, `me` (the one mailbox read), `first_scan_after` (an ISO date, usually today), and `never_open.domains` and `senders` (the operator's own domains, clients, family).
   - **gws:** the operator creates a Desktop OAuth client in their own Google Cloud project (`docs/setup.md` "Mail adapter"), saves it as `workspace/.secrets/gws/client_secret.json`, then runs in their own terminal: `npm run gws -- auth login --scopes https://www.googleapis.com/auth/gmail.readonly`. Check with `npm run gws -- auth status` and `npm run -s mail -- pending --dry-run` (exit 0).
   - **bridge:** list the harness's mail connector tools. Classify each as a read (search, list, get or read a message or thread) or a write (send, draft, label, archive, delete, modify, mark read). Run `npm run -s onboard -- mail-guard --deny <every write tool, comma-separated>`. Check with `npm run -s mail -- pending --dry-run`: exit 6 and a request file under `workspace/data/mail/requests/`; delete that request file afterwards.
   - **none:** no inbox scan; mailed codes at apply time hand the role to the operator.
3. **bikeshed** (default publisher; the operator may choose `publisher: local` instead: no comments and no review documents).
   - The operator runs `npm run bikeshed -- login` in their own terminal.
   - Create the folders: `npm run -s bikeshed -- mkdir "Job hunt" --json`, then `npm run -s bikeshed -- mkdir "Reviews" --parent <hunt folder id> --json` and `npm run -s bikeshed -- mkdir "Letters" --parent <hunt folder id> --json`. Read each id from the JSON, or from `npm run -s bikeshed -- folders --json`. Check with `npm run -s bikeshed -- folder <hunt folder id>` that only the operator can read it.
   - Write `workspace/config/tracker.json` `bikeshed.folder_id`, `reviews_folder_id`, `letters_folder_id`, and `workspace/config/cv-bikeshed.json` `folder_id` (the hunt folder).
   - Run `npm run -s tracker -- --publish`. It creates the tracker document and records `doc_id` and `url`. Exit 2: not signed in. Exit 1: read the error (a privacy-guard hit means private data reached the page: fix the source, never the guard).
4. **ATS accounts:** tell the operator the runner never creates an account or types a password. A Workday or iCIMS sign-in or sign-up comes to them as a hand-off; they sign in by hand in a headed run (`docs/setup.md` "11. ATS accounts"). A `workspace/config/vault.json` from an older install is unused: offer to delete it.

## Phase 8: Baseline CVs (`cvs`)
1. Pick 2 to 4 archetypes from the lanes and target titles. Slugs name a role, never a company.
2. Draft `workspace/collateral/cv/variants/<slug>.json` for each: `master.json` units and usable C IDs only; summary and highlights through `authentic-prose`; `target_keywords` the claimable terms of that archetype; `honest_gaps` the rest; `share` a role-title slug; no company name.
3. Run `npm run -s cv -- --all`. Exit 1: fix each variant as `report[].problems` say and rebuild. Never hand-edit a rendered file.
4. Run `npm run -s cv-publish`. Each render gets its own private document (`config/cv-bikeshed.json` `docs`). Exit 1: a CV was refused (`results[]` names why: no render, private data, open comments, no folder). Exit 2: not signed in. With `publisher: local` it publishes nothing (`published: false`).
5. The operator approves each render: give its document link, then AskUserQuestion "Approve" or "Change". A change is made in the variant from claims, then rebuilt and republished.
6. Add each variant's row to the Archetype map in `workspace/collateral/cv-map.md`.
7. Rehearsal: save one calibration role's description to a text file, then run `/hunt-tailor` on it with `npm run -s tailor -- prepare --job rehearsal-1 --jd <file> --company "<company>" --title "<title>"` and the usual steps through `build`. Show the operator the result and the coverage against the baseline. It is never reviewed or sent. Afterwards delete `workspace/data/applications/rehearsal-1/`, `workspace/data/out/cv/rehearsal-1/` and `workspace/data/cv-preview/<rehearsal slug>-*`. The first real `/hunt-tailor` runs on the first tier A/B role, with review on.

## Phase 9: Searches (`searches`)
1. Draft candidate queries per lane from the target titles. LinkedIn: quote every phrase, `OR` allowed, never `AND`, no `f_JT` on fractional phrases. Dice: never `"A" OR "B"` (`docs/platforms.md`).
2. Run `/hunt-probe` for LinkedIn, then for Dice, for each platform the operator uses. It writes the report, edits the query set from its verdicts, and sets `verified` through `npm run probe -- --mark-verified`. Never set `verified` by hand.
3. Probes spend the day's caps: one platform's probe per day is normal.

## Phase 10: Ready (`ready`)
1. Run `npm run -s onboard -- validate` (exit 0) and `npm run doctor` (no `FAIL` rows). Fix each red item with its printed fix.
2. Run `npm run -s onboard -- mark --phase ready`.
3. Tell the operator:
   - Start the loop with `/loop /hunt-loop`, in a session that stays open.
   - Each channel's first application is a headed dry run they check (`npm run apply -- --job <id> --dry-run --headed`), verified only with `npm run apply -- verify --channel <name> --evidence <that run folder>`.
   - Back up the workspace with `npm run onboard -- git-init` if not done.

## Never
- Type, ask for or store a password, or run a login from the agent's shell.
- Use a claim before the operator confirmed it, or write a fact with no source.
- Change an EEO answer from `decline`, switch auto-apply on, set review to `auto`, fix a letter approach, change the company limit or raise a cap without the operator's explicit words and a decisions row.
- Copy any workspace file into the repository.
