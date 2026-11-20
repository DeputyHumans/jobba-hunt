# Troubleshooting

Symptom, cause, fix. The rules are in `AGENTS.md`. Guard-by-guard actions, halts, the pause and cap overrides are in `docs/runbook.md` "Guards and actions" and "Halts, the pause and cap overrides"; selectors and site quirks in `docs/platforms.md`. Paths: repo-relative (`scripts/...`) or workspace-relative (`config/`, `data/`, `profile/`, `collateral/`).

## Install

| Symptom | Cause | Fix |
|---|---|---|
| `bin/install` exits 2 | Not macOS, macOS older than 13, or run as root | On Linux follow `docs/setup.md` from step 1. Never run the installer with sudo |
| `install: the Command Line Tools did not finish installing` | The Apple dialog was closed or the download stalled | Run `xcode-select --install`, let it finish, then run the installer line again |
| `install: <folder> exists and is not a jobba-hunt checkout` | `JOBBA_DIR` (default `$HOME/jobba-hunt`) holds other files | Move them, or pass another `JOBBA_DIR`. The installer never deletes a folder |
| `bootstrap: git is missing` | No git on the host | `docs/setup.md` "Install git" |
| macOS: a dialog asks to install the command line developer tools, or `xcrun: error: invalid active developer path` | The Command Line Tools are missing, or an OS upgrade removed them | `xcode-select --install` |
| `nvm: command not found` right after the nvm installer | macOS: no `$HOME/.zshrc` for the installer to edit, or the shell was not reopened | `touch $HOME/.zshrc`, run the nvm installer again, open a new shell |
| Bootstrap prints `Node.js is missing` and exits 1 | No `node` on `PATH` | Install Node (`docs/setup.md` "Install Node"), open a new shell, run `./bin/bootstrap` again |
| `bootstrap: Node v<x> is too old` | Node is below `package.json` `engines.node` (22.13.0) | `nvm install 22 && nvm use 22`, then `./bin/bootstrap` again |
| `Chromium download failed` in setup | The CloakBrowser download broke off | Check the connection, then run `./bin/bootstrap` again |
| `zsh: command not found: claude` | The Claude Code installer does not put `$HOME/.local/bin` on `PATH` | `docs/setup.md` "Install and open the agent": the profile line, then a new shell |

## Halts and checkpoints

| Symptom | Cause | Fix |
|---|---|---|
| Tick or dice-tick exits 1, `aborted: checkpoint` | The platform challenged the session (a LinkedIn checkpoint or authwall, a Dice challenge page) | Stop that source for 7 days. The operator signs in by hand in a real terminal (`npm run jobs -- login` or `npm run dice -- login`), halve that source's caps in `config/limits.json`, then one `--headed` tick watched before the loop resumes |
| Exits 1, `aborted: login-lost` | The session cookie is no longer valid | The operator signs in by hand. A same-day re-run is refused by the halt (exit 5); resume after `preferences.schedule.reset_hour` |
| Dice tick exits 1, `aborted: blocked` | Dice answered 403 | Dice is halted until the reset. Check the query for `"A" OR "B"` |
| Exits 1, `aborted: canary-failed`, `canary-empty`, `throttle-suspect`, `views-unreadable` or `unknown-status:<x>` | Selector rot, a changed endpoint, throttling, or a page state the guards do not know | `docs/runbook.md` "Guards and actions", row by row |
| Tick or dice-tick exits 5, sweep exits 2, live probe exits 5, with `halted` | An earlier abort set `halt_until` | Wait. Only the operator clears a halt early: `npm run jobs -- clear-halt` or `npm run dice -- clear-halt` with `--note "<their words>"` (`docs/runbook.md` "Halts, the pause and cap overrides") |
| `npm run jobs -- search` or `view` (or `dice`) exits 1, "refused: halted until ..." | The same halt holds the reader CLIs | Wait. `login`, `whoami` and `limits` still run |
| Apply exits 1 with `detail` "checkpoint: halted 7 days", "login lost: ...", or "Dice blocked: ...", "Dice checkpoint: ...", "Dice login: ..." | The runner hit the wall itself and set that source's halt | As the matching tick row above |
| Tick or dice-tick exits 4 with `paused: true` | `config/pause.json` is paused | Nothing to fix. The loop runs the inbox and the tracker only, and comes back in an hour. Only the operator lifts the pause, with a `profile/decisions.md` row |
| Sweep or live probe exits 4; a reader `search` or `view` exits 1 with `paused: true` | The pause holds every page load outside a dry run | As above. A `--dry-run` and `probe -- --mark-verified` still run |
| The loop stops by itself | Both sources halted for more than a day | Fix both causes, then `/loop /hunt-loop` again |

## Chrome driver

| Symptom | Cause | Fix |
|---|---|---|
| A tick, sweep, probe or reader exits 2 `cap: chrome-needs-bridge` | It was started directly under the chrome driver | `npm run -s browser -- start <command> -- <args>`, then serve its requests (the hunt-browser skill) |
| Exits 2 `cap: chrome-session-unconfirmed` | The source's sign-in in Chrome was never confirmed, or a login-lost abort cleared it (`data/state/browser-sessions.json`) | Sign in to the board in your own Chrome, then `npm run -s browser -- start jobs -- whoami` (or `dice -- whoami`) |
| Exits 3 with `browser: unavailable` | A bridge request got no answer in time, was failed (no browser connected, the extension idle), or its envelope failed the checks twice | No halt. `/chrome`, then Reconnect extension, and the next firing tries again |
| `browser -- done` exits 1 "write the envelope … first" | A `load` or `eval` was acknowledged before its `respond_to` file held the `get_page_text` copy | Copy from `JOBBA-ENVELOPE` to `JOBBA-END` into `respond_to`, then `done` again, or `done --failed "<why>"` |
| A request's envelope fails "hash mismatch" | The copy changed a character | Nothing: the command reads the page once more by itself. A second failure ends the run (exit 3) |
| `start` exits 3 `busy` | Another bridge run holds `data/bridge/active.json` | Serve it to its end (`npm run -s browser -- next`), or wait. A dead holder is cleared by itself |
| `eval` of the uploaded script errors "'unsafe-eval' is not an allowed source" | The evaluation ran after an `await` in the same call | Run `READ_JS` and `EVAL_JS` as two separate `javascript_tool` calls, as the request's steps list them |
| `--capture`, `--pause`, `--profile` or `--force-reap` refused (`chrome-unsupported-flag`) | They belong to the cloakbrowser driver | Add `--driver cloakbrowser` for that run |

## Browser profile

| Symptom | Cause | Fix |
|---|---|---|
| Exit 3, `profileBusy` | Another process held the browser profile in `data/browser/<platform>` for the whole lock wait (120 s, `CLOAK_LOCK_WAIT_MS`) | Run later; it is not counted against a cap. A crashed run's stale lock is cleared on the next start. Never `--force-reap` while another run may use the profile |
| The LinkedIn login window never takes the Enter | `npm run jobs -- login` ran through the agent's shell runner, which has no keyboard | The operator runs it in a real terminal. `npm run dice -- login` needs no Enter: it closes once signed in (10 minutes at most) |
| Signed-out pages on a Dice session that works in a browser | Dice serves its public header to a live session, and a cold browser renders the account menu late | Nothing: the Dice reader waits up to 15 s for the account menu, and the Dice tick confirms a sign-out on the home feed before it halts. On LinkedIn, run `npm run jobs -- whoami`; if it says signed out, the operator signs in by hand |

## Searches

| Symptom | Cause | Fix |
|---|---|---|
| Cards have ids but no title or company | The virtualized list did not render | Check the scroll container headed. Views still fill the fields |
| Many good roles get `scope-unconfirmed` | Expected before a view on fractional and AI-search queries | Views confirm the scope from the description |
| A real role was dropped | A prefilter rule | Find it in `data/state/jobs.json` (`prefilter.reasons`). Adjust `config/prefilter.json` with a prefilter test for the case |
| A search "returns" a handful of promoted jobs | LinkedIn's no-results page with "Jobs you may be interested in" filler | It is classified `empty`, and the filler is counted in `filler_count` (a `jobs -- search` or probe result). If it shows `ok` again, the empty marker moved: replay the capture |
| Results full of cloned listings (the same title in many cities, expert-network gigs) | One poster floods the query | Add the company to `company_drop` with a prefilter test. Repost detection already keeps clones out of the view queue. A `NOT <company>` in the query is a query change: only through a probe |
| The AI-search canary collects 1 card | The card selector broke | Replay a capture and re-pin `aiCard` |
| Classic queries come back as AI-search results, without remote or contract filtering | `/jobs/search/` redirects to the AI search and drops `f_WT`, `f_JT` and `sortBy` (`docs/platforms.md` "LinkedIn") | Move the classic queries to the AI search with `/hunt-probe`. Until then the prefilter's G2 is the only remote check |
| A query missed several ticks | Rotation, a halt or closed hours | Nothing to do while the gap stays under `window.cap_seconds`: it searches back to its own last ok run |
| `npm run jobs -- search` or `view` exits 1, "daily cap: ...", `capped: true` | The reader CLI spends the same daily caps as the ticks | Wait for the reset |
| `npm run triage -- record` exits 1 with `no-description: ...` | The posting has no description, and the row claims more than the evidence allows | Record that row with every gate `unclear`, `no-description` in `red_flags` and a score of at most 50. The valid rows were already recorded |
| `triage -- record` exits 1 with other `errors` | A row failed validation (job id, lane, score, a gate value, a list field) | Fix only the refused rows and record them again |

## Caps and verification

| Symptom | Cause | Fix |
|---|---|---|
| Exit 2, `refused`, "Limit reached" | A daily cap in `config/limits.json` is used up | Wait for the reset. `npm run jobs -- limits` and `npm run dice -- limits` show usage. There is no force flag; an override needs the operator's explicit instruction (`docs/runbook.md` "Halts, the pause and cap overrides") |
| Tick or dice-tick exits 2, `cap: ticks_per_day`, "Jitter gap" | The last tick was less than `ticks_per_day.jitterMin` minutes ago | Clears at `nextAllowedAt`. Schedule firings from the ticks' `next_tick_at`, which already respects the gap |
| Tick, dice-tick or sweep exits 2, `cap: not-verified` | The query set has no probe behind it (`verified: false`) | `/hunt-probe`, then `npm run probe -- --mark-verified <data/probes/...json>` |
| Apply exits 2, `channel <name> is not verified` | The channel's flag for this browser driver is false (`verified`, or `verified_chrome` under the chrome driver), including an ATS reached from a LinkedIn or Dice link | `npm run apply -- --job <id> --dry-run --headed`, the operator checks the screenshots, then `npm run apply -- verify --channel <name> --evidence <run dir>` |
| Apply exits 2, `paused: <reason>` | `config/pause.json` holds every real submit | Wait for the operator to lift it. Dry runs still run |
| Apply exits 2, `same-company: <id> <status>` | Another application at the same company was already sent (`config/apply.json` `companies.limit`) | Never re-run. Tell the operator |
| `triage -- decide --decision pursue` or `approve` exits 1, "company limit: `<id> <status>`" | Live roles at this company (approved or sent, or an opportunity file at `applied` or later) reached `companies.limit`. An agency posting counts against its `end_client` | Ask the operator which role to keep. On their word, `npm run triage -- hold --id <other id> --note "..."` frees an unsent sibling; then pursue again. A sent sibling cannot be held: the limit stands unless the operator changes `companies` (a `profile/decisions.md` row) |
| `triage -- hold` or `withdraw` exits 1, "job `<id>` is already `<status>`" | The application was already sent (`submitted`, `submitted-by-hand`, `already-applied` or `submit-unverified`) | Nothing to do: a sent application is never touched |
| Apply exits 2, `reason: submit-pending` | An earlier run asked for Submit and never finished (the process ended after the request was written to disk) | `npm run apply -- recover --job <id>`: it becomes `submit-unverified`. Read that run's screenshots, or ask the operator. Never retry |
| `triage -- not-sent` exits 1, "not-sent is only for a job at submit-unverified" | The job is in another state | Use it only after a `submit-unverified` run whose screenshot proves nothing was sent |
| Apply exits 5, `reason: ai-applicant-question` | The form asks whether an AI, a bot or an agent applies | The operator submits by hand, then `npm run triage -- applied --id <id>`. The runner never answers it |
| `npm run apply -- learn` exits 2, "an AI-applicant question is never learned" | The label is an AI-applicant question | Do not store an answer. The role is the operator's to submit |
| `npm run triage -- auto` exits 2 | `blockers` lists each reason (below) | Each blocker is a reason to ask, not to edit: the loop asks the operator. Tailoring clears the CV blockers; `approve-docs` on the operator's word clears the review blockers |

**`auto` blockers** (`autoApplyBlockers` in `scripts/lib/triage.mjs`, plus the `auto` command in `scripts/record-triage.mjs`):

| Blocker | Meaning |
|---|---|
| `auto-apply is off (config/apply.json auto_apply.enabled)` | The rule is off |
| `submissions paused: <reason>` | `config/pause.json` is paused |
| `not scored`, `already decided: <decision>`, `application already <status>` | Not a fresh triaged role |
| `LinkedIn shows it as applied` | The view saw the applied marker |
| `score <n> below <min_score>` | Under `auto_apply.min_score` |
| `gates not all pass: <gates>` | A gate is `fail` or `unclear` |
| `rate $<n>/hr under the $<floor>/hr IC floor` | The posted rate tops out under `preferences.money.ic_rate_floor` |
| `salary $<n> a year under the full-time floor` | A full-time hands-on role under `preferences.money.ft_salary_floor` |
| `tier reject` | The tier is `reject` |
| `apply type <type> is not auto-applied (<channels>)` | The apply type is not in `auto_apply.channels` |
| `channel <type> not verified` | Listed, but not verified (an `external` type counts as verified here; the runner checks the ATS at submit) |
| `no tailored CV for this job yet (/hunt-tailor)` | Per-job mode, no tailored build |
| `no existing CV for the archetype (or the lane pool, auto_apply.cv_pool)` | No CV file to send |
| `CV coverage <n>% below <min>%` | Under `auto_apply.min_cv_coverage` (`unknown` with no measured CV) |
| `tailored documents are waiting for review approval (approve-docs)` | Per-job mode with review `bikeshed`, set not approved |
| `letter approach <B or C> needs the operator's review (approve-docs)` | A B or C letter always waits for review |
| `company limit: <id> <status>, ...` | Live siblings at the same company |
| `needs a generated cover letter (--cover-pdf, scripts/build-cover.mjs)`, `cover letter not found: <path>` | `auto_apply.cover_letter.<type>` is `generated` and no letter PDF exists. `--dry-run` reports it too |

## Tracker, bikeshed and review documents

| Symptom | Cause | Fix |
|---|---|---|
| `npm run tracker` exits 1 with `privacy` | The page holds an email other than the application email, a phone number from `profile/person.json` or `profile/answers.json`, the standing annual rate, or the street address | Nothing was published. Find the source line (an opportunity note, a mail summary) and remove the value. A company field that holds an email already renders as its domain |
| Tracker exits 2; `cv-publish` exits 2; `tailor -- review` exits 4 | bikeshed is signed out | `npm run bikeshed -- login`. Never a global install or `npx`: the scripts read credentials only from `workspace/.secrets` |
| Tracker exits 3 | Update refused: the document is open in the editor, a suggestion is pending, or the base moved | Next firing |
| Tracker exits 4 | Open comment threads on the dashboard | Act on each, reply, resolve, publish again |
| `npm run tailor -- review` exits 3 | bikeshed refused the review document update: open in the editor, a pending suggestion, or a newer base | Resolve or withdraw the suggestion, close the editor, and run `review` again; it updates the same documents |
| `npm run tailor -- review` exits 1, "no bikeshed folder for reviews" | `config/tracker.json` has no `bikeshed.reviews_folder_id` (or `folder_id`) | The onboarding access phase creates it: `npm run bikeshed -- mkdir Reviews --parent <folder id>`, then record the id |
| `triage -- approve-docs` exits 1 for an `email-<thread id>` or recruiter role | No job state and no `data/applications/<id>/tailor.json`, or its tailor status is not `built` or `review` | Tailor it first (`npm run tailor -- prepare --jd <file> --company <c> --title <t>`, then the usual steps) |
| `cv-publish` exits 1 for one CV | No rendered HTML, private data in it, open comments on its document, or bikeshed refused | Rebuild with `npm run cv -- --variant <slug>`; resolve the comments; run again |
| A comment never reaches the agent | The watch is not running, or the thread is still empty | `npm run watch -- --once` shows what it sees. An empty thread prints `typing: true`: the text arrives later |

## Rendering and fonts

| Symptom | Cause | Fix |
|---|---|---|
| `npm run setup` warns "Chromium libraries missing" (Linux) | Shared libraries Chromium links against are absent | Run the `apt-get` or `dnf` line setup prints (`docs/setup.md` "Linux notes") |
| A CV or letter build exits 1, "no Chromium binary found" | The CloakBrowser binary was not downloaded | `npm run setup`. `CHROME_PATH` points at another Chromium if needed |
| A custom script hangs on `page.setContent` | The bundled Chromium build never finishes `page.setContent` | Write the HTML to a file and `page.goto()` its file URL, as `scripts/lib/pdf.mjs` does for every render |
| Build fails with `fonts: Type 3 font embedded`, `unnamed ... font` or `font ... not embedded` | Text fell back to a font outside the bundled set (emoji, rare symbols), or a workspace brand override names a font that is not in `brand/fonts` | Remove the character from the source, or add the font file next to the override. `npm run doctor` fails when `brand/fonts` holds fewer than 4 font files: restore it from git |
| Build fails on the page count or a sheet overflow | Content longer than `preferences.cv.pages` | Drop or shorten bullets in the variant. Never hand-edit a rendered file |
| Build fails on a repeated 5-word phrase | A highlight repeats an experience bullet | Reword the highlight |
| A CV, letter or brief build, or `onboard -- validate`, says `claim <id> is not usable (status <s>; ...)` | The cited row exists but its status is not `user-confirmed`, `public` or `CV` | Ask the operator to confirm the claim in `collateral/claim-bank.md`, or cite another. `build-brief` and `mail -- record` report the same case as `unknown claim` |

## Letters

`npm run cover -- --job <id>` exits 1 with `letter checks failed` and lists `errors` and `lint`, or with `PDF checks failed` and `problems`. Nothing to send until it exits 0. The approaches: `docs/tailoring.md` "Cover letters".

| Symptom | Cause | Fix |
|---|---|---|
| `no letter at data/applications/<id>/cover-letter.json` | The letter file is missing | Write it (`/hunt-tailor`), then build |
| `approach must be A, B, C or D` | `approach` is missing or unknown | Set one of the four |
| `approach <X>, but preferences tailoring.letter is <Y>` | A fixed `preferences.tailoring.letter` allows one approach only | Rewrite the letter in approach Y, or the operator changes the letter mode (a `profile/decisions.md` row) |
| `approach_why: one line on why this approach fits the posting` | `tailoring.letter` is `per-job` and the letter names no reason | Add `approach_why` |
| `approach A: one requirements map with at least 3 rows`, `approach A: no list`, `approach A: at most one ramp-up line` | A's structure | One `map` block of 3 or more rows, no `list`, at most one `rampup` paragraph |
| `approach B: one numbered list (ordered: true) of plan steps`, `2 to 4 plan steps`, `plan step <n> cites no claim` | B's structure | One ordered `list` of 2 to 4 steps, each citing a claim |
| `approach C: one list (ordered: false) of questions`, `2 to 4 questions`, `item <n> is not a question` | C's structure | One unordered `list` of 2 to 4 items, each ending in `?` |
| `approach <B or C>: after the list, a paragraph citing the record behind it` | B and C need the record after the list | Add a paragraph after the list that cites a claim |
| `approach <B or C>: no requirements map`, `a P.S. belongs to approach D` | A block from another approach | Remove it |
| `approach D: no map or list`, `2 to 4 paragraphs`, `at least one paragraph cites a claim`, `one P.S. at most`, `the P.S. comes last`, `the P.S. cites no claim` | D's structure | 2 to 4 plain paragraphs, one citing a claim, and at most one P.S., last, citing a claim |
| `<n> words; keep it between 100 and 260` | Length | Cut or add from claims |
| `em dash in the letter`, `semicolon in the letter` | House style | Rewrite the sentence |
| `... unknown claim <id>` or `claim <id> is not usable` | A claim outside the usable rows | Cite a usable claim |
| `lint` entries | The never-claim rules (`collateral/cv/never-claim.json`) matched | Rewrite the sentence |
| `PDF checks failed`: `<n> pages; a cover letter is one page`, `the page view prints as <n> pages`, a font problem, `lint(pdf) ...` | The render | Shorten the letter, or fix the font as in "Rendering and fonts" |
| `auto` blocks, or the runner refuses (exit 2), with "letter approach B (or C) needs the operator's review" | B and C always wait for review, whatever `tailoring.review` says | `tailor -- review` publishes it; `approve-docs` on the operator's word |

## Mail

| Symptom | Cause | Fix |
|---|---|---|
| `npm run mail -- pending` exits 2 | The mail reader is not signed in, or Google answered 401 | `npm run gws -- auth login --scopes https://www.googleapis.com/auth/gmail.readonly`. Only through `npm run gws`: a global gws or host gcloud credentials are never read |
| `npm run gws -- auth status` shows no client config, or doctor `gws OAuth client missing` | No OAuth client in `workspace/.secrets/gws/client_secret.json` (or the client id and secret in `workspace/.secrets/.env`) | Create a Desktop app client and `npm run onboard -- gws-client --file <json>` (`docs/setup.md` "10. Mail adapter") |
| `gws-client` exits 1 `not-desktop-client` | The downloaded client is of type Web application | Create another client of type **Desktop app** and download its JSON |
| The Google sign-in says "Access blocked" or the app is not verified | A testing app without your address under Test users, or Google's unverified-app screen for your own app | Add your address at https://console.cloud.google.com/auth/audience. On the unverified screen choose **Advanced**, then continue: it is your own app |
| `npm run mail -- pending` exits 2 about a week after the gws sign-in | A testing app's refresh token expires after 7 days | Run the sign-in again. A **Personal** app, where the console offers one, does not expire weekly |
| `/mcp` does not list the Gmail connector | Claude Code is signed in with an API key or a Console account, or the connector is not connected at claude.ai | `/status` shows the sign-in: use `/login` with your claude.ai plan. Connect Gmail at https://claude.ai/customize/connectors, then restart `claude` |
| `mail-guard --connector gmail` exits 1 "no read tool" | The connector's tool names are not the three expected reads | Check the names in `/mcp`; nothing was written. Never hand-pick a deny list |
| Doctor: bridge "without the write-tool guard" | `mail-guard` has not run, or `.claude/settings.local.json` lost its rules | `npm run onboard -- mail-guard --connector gmail --tools <the connector's tools>`, then restart `claude` |
| `pending` exits 6, `needs_fetch` (bridge) | Normal: the agent fulfils the named request with the connector's read tools, then runs the `next` command from the output | `docs/adapters.md` "The bridge handshake (inbox scan)" |
| Apply exits 5 with a mailed code that did not come (bridge) | Nobody answered the code request in `data/mail/requests/` within `config/apply.json` `code_wait_seconds` | Run the apply in the background and fulfil the request while it waits. A timed-out role is handed to the operator, who completes it by hand and runs `npm run triage -- applied --id <id>` |
| `record` exits 1 | A rate figure, a semicolon, an em dash, an unknown or unusable claim, a kind that needs or takes no draft, a bad `match`, a hands-on role under the IC floor, a sent reply for an unknown thread, or a probable match against an existing opportunity file | Fix the results file and run again. Nothing was written |

## Onboarding and workspace

| Symptom | Cause | Fix |
|---|---|---|
| Any command: "No workspace found" | No `profile/person.json` under `JOBBA_HOME` (default `workspace/`) | `/hunt-onboard`, or `npm run onboard -- init`, or point `JOBBA_HOME` at the workspace |
| `npm run onboard -- validate` exits 1 | Each problem names its file and message | Fix as listed below, then validate again |
| `person.json name is empty`, `application_email (or email) is not an email address` | Identity not filled | Interview phase |
| `schedule.tz ... is not an IANA time zone`, `schedule.<key> must be HH:MM` | Schedule typo | Use a zone such as `America/Chicago` and 24-hour `HH:MM` |
| `tailoring.review must be bikeshed or auto`, `tailoring.cv must be per-job or archetype`, `tailoring.letter must be per-job, A, B, C or D`, `cv.paper must be letter or a4` | An unknown option value | Use one of the listed values |
| `bad regex` in `prefilter.json`, `never-claim.json` or `location.onsite_metros` | A pattern that does not compile | Fix the pattern |
| `master.json ... cites unknown claim C<nn>` | A CV unit cites an id that is not in the Claims table (a typo) | Fix the id |
| `master.json ... claim C<nn> is not usable (status ...)` | The row is pending, retired or has another status | Confirm the claim with the operator, or cite another |
| `variants/<file> unknown role` or `unknown bullet` | A variant points at a key not in `master.json` | Fix the key |
| `verified.<channel> must be true or false`, `limits.json ... max must be a whole number`, `queries must be a list` | A hand edit broke the shape | Restore the value; channel flags change only through `npm run apply -- verify` |
| `npm run doctor` collateral row: `0 usable claims` (FAIL) or `N usable claims, M pending confirmation` (warn) | Only Claims-table rows with a usable status count | Claims phase of `/hunt-onboard` |
| `npm run check:pii` fails before a commit | A repo file holds a term from the workspace: from `profile/person.json` (name, display name, emails, phone, LinkedIn and website links), from `profile/answers.json` (`profile` name, email, phone, address, links; `facts.contracting_entity`), from `collateral/cv/master.json` (role companies, their clients, employers, `links` names), or a line of `profile/pii-extra.txt`. A `<placeholder>` value is skipped | Remove the value from the repo file. Personal data belongs only in the workspace. A term the operator has made public on purpose (the organization publishing the repo) goes in `profile/pii-allow.txt`, on the operator's word only |
| `npm run check:portable` fails | A host-only path, a `../` that leaves the repo, or a broken symlink | Use a repo- or workspace-relative path; `npm run skills:link` repairs skill links |
