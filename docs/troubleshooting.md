# Troubleshooting

Symptom, cause, fix. Guard-by-guard actions for the job boards are in `docs/runbook.md` section 5; selectors and site quirks in `docs/platforms.md`. Paths: repo-relative (`scripts/...`) or workspace-relative (`config/`, `data/`, `profile/`).

## Halts and checkpoints

| Symptom | Cause | Fix |
|---|---|---|
| Tick or dice-tick exits 1, `aborted: checkpoint` | The platform challenged the session | Stop that source for 7 days. Sign in by hand (`npm run jobs -- login` or `npm run dice -- login`), halve that source's caps in `config/limits.json`, then one `--headed` tick watched before the loop resumes |
| Exits 1, `aborted: login-lost` | The session cookie is no longer valid | Sign in by hand. A same-day re-run is refused; resume after `preferences.schedule.reset_hour` |
| Exits 1, `aborted: canary-failed`, `canary-empty`, `throttle-suspect` or `views-unreadable` | Selector rot, a changed endpoint, or throttling | `docs/runbook.md` section 5, row by row |
| Tick exits 5, sweep exits 2 with `halted` | An earlier abort set `halt_until` | Wait. Only the operator clears a halt early, and the clearing goes into the digest and `profile/decisions.md` |
| The loop stops by itself | Both sources halted for more than a day | Fix both causes, then `/loop /hunt-loop` again |

## Browser profile

| Symptom | Cause | Fix |
|---|---|---|
| Exit 3, `profileBusy` | Another process holds the browser profile in `data/browser/<platform>` | Run later; it is not counted against a cap. A crashed run's stale lock is cleared on the next start. Never `--force-reap` while another run may use the profile |
| A login window never takes the Enter | The command ran through the agent's shell runner, which has no keyboard | Run `npm run jobs -- login` in a real terminal |
| Signed-out pages on a session that works in a browser | Dice serves its public header to a live session; a cold browser renders slowly | Nothing: the Dice tick confirms on the home feed and the runner waits up to 15 s for the account menu. On LinkedIn, `npm run jobs -- whoami`; if it says signed out, sign in by hand |

## Caps and verification

| Symptom | Cause | Fix |
|---|---|---|
| Exit 2, `refused` | A daily cap in `config/limits.json` is used up | Wait for the reset. `npm run jobs -- limits` shows usage. There is no force flag; an override needs the operator's explicit instruction (`docs/runbook.md` section 6) |
| Tick, dice-tick or sweep exits 2, `cap: not-verified` | The query set has no probe behind it (`verified: false`) | `/hunt-probe`, then `npm run probe -- --mark-verified <data/probes/...json>` |
| Apply exits 2, channel not verified | The channel's `verified` flag is false | `npm run apply -- --job <id> --dry-run --headed`, the operator checks the screenshots, then `npm run apply -- verify --channel <name> --evidence <run dir>` |
| `npm run triage -- auto` exits 2 | Blockers listed: auto-apply off, score, a gate, channel, coverage, no tailored CV, documents awaiting `approve-docs` | Each blocker is a reason to ask, not to edit: the loop asks the operator |

## Tracker, bikeshed and review documents

| Symptom | Cause | Fix |
|---|---|---|
| `npm run tracker` exits 1 with `privacy` | The page holds an email other than the application email, the answer-bank phone, the standing annual rate or the street address | Nothing was published. Find the source line (an opportunity note, a mail summary) and remove the value |
| Tracker exits 2; `cv-publish` exits 2; tailor review exits 4 | bikeshed is signed out | `npm run bikeshed -- login`. Never a global install or `npx`: the scripts read credentials only from `workspace/.secrets` |
| Tracker exits 3 | Update refused: the document is open in the editor, a suggestion is pending, or the base moved | Next firing |
| Tracker exits 4 | Open comment threads on the dashboard | Act on each, reply, resolve, publish again |
| `npm run tailor -- review` exits 3 | bikeshed refused the review document update: open in the editor, a pending suggestion, or a newer base | Resolve or withdraw the suggestion, close the editor, and run `review` again; it updates the same documents |
| `npm run tailor -- review` exits 1, "no bikeshed folder for reviews" | `config/tracker.json` has no `bikeshed.reviews_folder_id` (or `folder_id`) | The onboarding access phase creates it: `npm run bikeshed -- mkdir Reviews --parent <folder id>`, then record the id |
| `cv-publish` exits 1 for one CV | No rendered HTML, private data in it, open comments on its document, or bikeshed refused | Rebuild with `npm run cv -- --variant <slug>`; resolve the comments; rerun |
| A comment never reaches the agent | The watch is not running, or the thread is still empty | `npm run watch -- --once` shows what it sees. An empty thread prints `typing: true`: the text arrives later |

## Rendering and fonts

| Symptom | Cause | Fix |
|---|---|---|
| `npm run setup` warns "Chromium libraries missing" (Linux) | Shared libraries Chromium links against are absent | Run the `apt-get` or `dnf` line setup prints (`docs/setup.md`, Linux notes) |
| A CV or letter build exits 1, "no Chromium" | The CloakBrowser binary was not downloaded | `npm run setup`. `CHROME_PATH` points at another Chromium if needed |
| A custom script hangs on `page.setContent` | The bundled Chromium build never finishes `page.setContent` | Write the HTML to a file and `page.goto()` its file URL, as `scripts/lib/pdf.mjs` does for every render |
| Build fails with `fonts: Type 3 font embedded`, `unnamed ... font` or `font ... not embedded` | Text fell back to a font outside the bundled set (emoji, rare symbols), or a workspace brand override names a font that is not in `brand/fonts` | Remove the character from the source, or add the font file next to the override. `npm run doctor` fails when `brand/fonts` holds fewer than 4 font files: restore it from git |
| Build fails on the page count or a sheet overflow | Content longer than `preferences.cv.pages` | Drop or shorten bullets in the variant. Never hand-edit a rendered file |
| Build fails on a repeated 5-word phrase | A highlight repeats an experience bullet | Reword the highlight |

## Mail

| Symptom | Cause | Fix |
|---|---|---|
| `npm run mail -- pending` exits 2 | The mail reader is not signed in, or Google answered 401 | `npm run gws -- auth login --scopes https://www.googleapis.com/auth/gmail.readonly`. Only through `npm run gws`: a global gws or host gcloud credentials are never read |
| `npm run gws -- auth status` shows no client config | No OAuth client in `workspace/.secrets/gws/client_secret.json` (or the client id and secret in `workspace/.secrets/.env`) | `docs/setup.md` step 10 |
| `pending` exits 6, `needs_fetch` (bridge) | Normal: the agent fulfils the named request with the connector's read tools, then runs the `next` command from the output | `docs/adapters.md` |
| Apply exits 5 with a mailed code that did not come (bridge) | Nobody answered the code request in `data/mail/requests/` within `config/apply.json` `code_wait_seconds` | Run the apply in the background and fulfil the request while it waits. A timed-out role is handed to the operator, who completes it by hand and runs `npm run triage -- applied --id <id>` |
| `record` exits 1 | A rate figure, a semicolon, an em dash, an unknown claim, or an email role under the IC floor | Fix the results file and rerun. Nothing was written |

## Onboarding and workspace

| Symptom | Cause | Fix |
|---|---|---|
| Any command: "No workspace found" | No `profile/person.json` under `JOBBA_HOME` (default `workspace/`) | `/hunt-onboard`, or `npm run onboard -- init`, or point `JOBBA_HOME` at the workspace |
| `npm run onboard -- validate` exits 1 | Each problem names its file and message | Fix as listed below, then validate again |
| `person.json name is empty`, `application_email ... is not an email address` | Identity not filled | Interview phase |
| `schedule.tz ... is not an IANA time zone`, `schedule.<key> must be HH:MM` | Schedule typo | Use a zone such as `America/Chicago` and 24-hour `HH:MM` |
| `tailoring.review must be bikeshed or auto`, `tailoring.cv must be per-job or archetype`, `cv.paper must be letter or a4` | An unknown option value | Use one of the listed values |
| `bad regex` in `prefilter.json`, `never-claim.json` or `location.onsite_metros` | A pattern that does not compile | Fix the pattern |
| `master.json ... cites unknown claim C<nn>` | A CV unit cites an ID that is not in the Claims table (still pending, or a typo) | Confirm the claim in the bank, or fix the ID |
| `variants/<file> unknown role` or `unknown bullet` | A variant points at a key not in `master.json` | Fix the key |
| `verified.<channel> must be true or false`, `limits.json ... max must be a whole number`, `queries must be a list` | A hand edit broke the shape | Restore the value; channel flags change only through `npm run apply -- verify` |
| `npm run check:pii` fails before a commit | A file in the repo holds a value from the workspace (`person.json`, `answers.json`, the employers in `master.json`, `profile/pii-extra.txt`) | Remove the value from the repo file. Personal data belongs only in the workspace |
| `npm run check:portable` fails | A host-only path, a `../` that leaves the repo, or a broken symlink | Use a repo- or workspace-relative path; `npm run skills:link` repairs skill links |
