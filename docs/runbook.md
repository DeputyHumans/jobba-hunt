# Runbook

The operating procedure for a live hunt. Paths: `scripts/...`, `templates/...` and `docs/...` are repo-relative. `profile/`, `config/`, `collateral/`, `pipeline/` and `data/` are workspace-relative (default `workspace/`, override `JOBBA_HOME`). Caps live in `config/limits.json`; hours, time zone and reset hour in `profile/preferences.json` `schedule`. This file never repeats their numbers.

## 1. Before the first live run (once)

| # | Item | Done when |
|---|---|---|
| 1 | Onboarding (`/hunt-onboard`) | `npm run doctor` is green apart from logins; `profile/onboarding.json` complete |
| 2 | Logins | `npm run jobs -- login` and `npm run dice -- login` in a real terminal, then `whoami` for each. A harness shell runner has no keyboard for the Enter step and leaves the profile locked |
| 3 | Query probes (`docs/query-probe-method.md`) | `npm run probe -- --mark-verified <data/probes/...json>` set `verified: true` in `config/searches.json` and `config/dice-searches.json`. Until then the ticks refuse (exit 2, `cap: not-verified`) |
| 4 | AI search filter codes | The operator opens `/jobs/search-results/` headed, clicks the filters, copies the URL. Automation never clicks filters |
| 5 | First tick, headed and watched | `npm run tick -- --headed`: canary `ok`, `guards: none` |
| 6 | Profile kits | `docs/kits/*.md` approved and entered by hand |
| 7 | Rubric calibrated | `/hunt-triage calibrate` passes `node scripts/check-calibration.mjs` |
| 8 | First apply per channel | A headed `--dry-run`, the operator checks the step screenshots, then `npm run apply -- verify --channel <name> --evidence <run dir>`. Never hand-edit `verified` |

## 2. The loop

Start with `/loop /hunt-loop` in a session that stays open, on a machine that stays awake. Each firing:

| Step | What happens | Check |
|---|---|---|
| 1 | `npm run -s tick`: one search, then views of new keep/review roles (at most `tick.views_per_tick`) | Exit code and `guards` in the last JSON line. Any abort halts LinkedIn until `halt_until` (section 5) |
| 1b | `npm run -s dice-tick`: the same for Dice, right after step 1, never in parallel. Own profile, caps and halt (section 8) | Exit code and `guards`. A Dice abort halts Dice only |
| 2 | `/hunt-triage tick` scores what is pending from both sources and updates today's digest | `pipeline/digests/YYYYMMDD-digest.md` |
| 2b | Per new tier A/B role: `/hunt-tailor` (`npm run tailor -- prepare / freeze / measure / build / review --job <id>`, `docs/tailoring.md`), or the archetype CV rule when `preferences.tailoring.cv` is `archetype` | The tailored set passed its gates. With `tailoring.review: bikeshed` its review documents are published |
| 3 | When `config/apply.json` `auto_apply.enabled`: `npm run triage -- auto --id <id>` per A/B role with documents. In per-job mode with `bikeshed` review it also needs `approve-docs`. Exit 0 approves under the rule; exit 2 lists the blockers | Each A/B role is auto-approved (the rule named in its note) or goes to step 4 |
| 4 | Push notification, then Apply / Watch / Skip, only inside the ask window. A pursue past `config/apply.json` `companies.limit` is refused and names the application that holds the company; `npm run triage -- hold --id <id> --note "..."` parks one on the user's word. An approved role the user no longer wants: `npm run triage -- withdraw --id <id> --note "..."` (never a sent one) | Every remaining A/B role has a decision |
| 4b | Each Apply: `npm run triage -- approve --id <id> --cv <pdf> [--cover-pdf <pdf>] --note "<the operator's words>"`, then `npm run apply -- --job <id> [--headed]`; act on the exit code (section 5) | Opportunity at `applied` with the confirmation screenshot, or the question or hand-off in front of the operator |
| 4c | Inbox (section 9) | Cards on the tracker. No question about mail in the session |
| 5 | `npm run -s tracker -- --publish --next-check "<YYYY-MM-DD HH:MM>"` | Exit 0, or the comment handling |
| 5b | `npm run watch` under a Monitor for the whole loop, re-armed on expiry. Each new comment is processed when it arrives | An empty thread is the operator still typing: leave it open |
| 6 | Schedule the next firing: the tick's `next_delay_seconds`, minus the time this firing took, at least 60 s | Inside the tick window; longer hops outside it |

**Hours.** Ticks run from `schedule.tick_start` to `tick_end` on `schedule.days` in `schedule.tz`. Questions are asked only from `ask_start` to `ask_end`, and only after the firing's ticks ran: a pending question blocks every later wakeup. Outside the ask window the loop notifies, leaves the roles on the tracker's "Needs you", and asks at the first in-window firing.

**Rotation** (`config/searches.json`, `config/dice-searches.json`):
- The canary runs every `tick.canary_every` ticks, over its 7-day window.
- The other queries take turns, oldest last run first. Each searches back to its own last ok run plus `window.buffer_hours` (`query_runs` in state), so a blocked or skipped tick costs latency, never coverage.
- `tick.min_interval_hours` holds a query to one run per N hours.

**Budget:**
- Searches, views and ticks per day: `config/limits.json` `linkedin_jobs` and `dice_jobs`. Ticks are spaced by `ticks_per_day.jitterMin`-`jitterMax` minutes.
- Page 2 is read when page 1 is full and at least `paging.new_share_for_next` of it is new.
- Views go newest posted first, at most `tick.views_per_tick` per tick. Views left over roll to the next tick.
- Sizing check: ticks in the window, plus page-2 loads, must fit under `searches_per_day`.

**Shared browser profile.** When another tool uses the same LinkedIn profile, the profile lock keeps them apart: a tick that finds it busy exits 3 and the loop waits. Never `--force-reap` while the other tool may run. A manual `npm run sweep` spends the same caps: not on a loop day unless the operator asks.

## 3. Weekly review

| Item | Command or rule |
|---|---|
| Board and metrics | `/hunt-status --write` writes `pipeline/digests/YYYYMMDD-status.md` |
| Rubric drift | The operator overrode more than 30% of tiers this week: add those roles to `data/calibration.json`, run `/hunt-triage calibrate` |
| Channel tripwire | Fewer than 3 tier A/B roles a week for 3 weeks running: open another lane or source, through a probe |
| Limiter log | `npm run jobs -- prune` drops entries older than 30 days |
| Query health | Per query, sum `ids` and `new` across the week's `data/raw/*-sweep.json` and `*-tick.json`. A query with 0 survivors for 2 weeks goes into the next probe, not straight out of the config |
| Classic search watch | `/jobs/search/` redirects to `/jobs/search-results/`, or the retirement banner gives a date: probe the classic queries on the AI endpoint |
| Account health | Any checkpoint, forced re-verification or unusual platform email this week: halve that platform's caps in `config/limits.json` before the next run |
| Action log | `npm run log -- --since <date>`: every override, halt clearing and verification has a `profile/decisions.md` row |

## 4. Change control

| Change | Required before commit |
|---|---|
| Selector or filter code | A `--headed` confirmation, the `docs/platforms.md` row updated, `npm test` green. A replay alone is "offline replay", never verified |
| Query set | A probe (`docs/query-probe-method.md`) whose decision rules were written before the data, a dated report, and the query-syntax rules still true |
| Scope (engagement types, location, lanes) | The same day, a probe that carries the change into the search filters. A scope change that never reaches `config/searches.json` silently misses roles |
| `config/prefilter.json` | A prefilter test covering the case that prompted it |
| `fit-profile.md` | Calibration passes |
| Caps or pacing | Lower any time. Raising one needs the operator's explicit OK, with a `profile/decisions.md` row (before, after, the operator's words) |
| Channel verification | Only `npm run apply -- verify --channel <name> --evidence <run dir>`, after the operator checked that headed dry run |
| CloakBrowser version | Pinned in `package.json`, wrapper and binary together. Change both or neither, then `npm run setup` |

## 5. Guards and actions

| Output | Meaning | Action |
|---|---|---|
| `aborted: checkpoint` | The platform challenged the session | **Stop 7 days.** Re-login by hand, halve the caps in `config/limits.json`, then one headed, watched tick before the loop restarts |
| `aborted: login-lost` | The session cookie is invalid | Re-login by hand. A same-day re-run is refused (cap). Resume after the reset |
| `aborted: canary-failed` | The AI-search canary returned 0 cards with no empty marker: selector rot or throttling | Next day: `npm run probe -- --file config/probes/canary-check.json --headed`, then `node scripts/replay-capture.mjs <its capture> --all`. Cards on screen but 0 parsed: re-pin `aiCard` in `JOBS_SEL`. Nothing on screen: throttling, pause 3 days |
| `aborted: canary-empty` | "No matching jobs" on the canary. Semantic search is never legitimately empty | The endpoint or its params changed. Run `canary-check.json` headed, compare with the UI, update `config/searches.json` through change control |
| `aborted: throttle-suspect` | Two narrow queries in a row returned 0 IDs with no marker | As `canary-failed` |
| `aborted: views-unreadable` | Two job pages in a row had no title or under 100 description characters | Capture one view (`npm run jobs -- view --id <id> --headed --capture`), replay it, re-pin the view selectors |
| `profileBusy` (exit 3) | Another process holds the browser profile | Run later. Not counted against a cap |
| `halted` (sweep exit 2, tick exit 5) | An earlier abort set `halt_until` | Wait. Fix the cause per its row. No override |
| Tick exit 4 | Outside the tick window | Normal. The loop hops to the next window |
| `refused` (exit 2) | A daily cap is used up | Wait for the reset. There is no override flag (section 6) |
| `budget_exhausted` | Searches or views ran out mid-run | Normal. The remaining views roll over |

**Apply runner exits** (`npm run apply -- --job <id>`):

| Exit | Outcome | Action |
|---|---|---|
| 0 | `submitted` | Create the opportunity file (`templates/opportunity.md`, `stage: applied`, `applied_on` today, no follow-up date) with the evidence screenshot |
| 2 | refused | Channel not verified: run `--dry-run --headed`, show the operator the screenshots, verify only on the operator's yes. Cap reached: next business day |
| 3 | profile busy | Next firing |
| 4 | `needs_answers` | Ask the operator each listed question, store with `npm run apply -- learn --label "..." --answer "..."`, re-run. A question asking whether an AI or bot is applying on someone's behalf is never answered No: the operator submits that role by hand. `optional-text`: draft a short answer from claims, write it to `data/applications/<id>/answers.json`, re-run |
| 5 | `manual` | Bot wall, CAPTCHA, unsupported site or account portal. Hand it to the operator with the `ats_url`, CV and letter; after the operator submits, `npm run triage -- applied --id <id>` |
| 6 | `submit-unverified` | **Never re-run.** Read the `after-submit` screenshot. A site confirmation: `npm run triage -- confirm --id <id> --evidence <png>`. Otherwise the operator checks the platform's applied list or the receipt email |
| 7 | already applied | Record it |

Never wrap the apply runner in a shell `timeout`: a kill after Submit is clicked leaves the role submit-unverified with no evidence. Use the harness's own tool timeout, in the background when the run may wait for the operator.

**Tracker exits:** 0 published or unchanged; 1 error or the privacy guard refused (nothing published, tell the operator); 2 not signed in to bikeshed (tell the operator once to run `npm run bikeshed -- login`, keep looping); 3 update refused (doc open in the editor, a pending suggestion, or the base moved: next firing); 4 open comment threads (act, reply, resolve, publish again).

## 6. Halts and recovery

- **Every abort halts its platform:** `halt_until` in `data/state/jobs.json` for LinkedIn, `state.sources.dice` for Dice. One platform's halt never touches the other's.
- **Duration:** until the next `schedule.reset_hour` in `schedule.tz`, or 7 days after a checkpoint. Every script honours it.
- **Early clearing:** only on the operator's explicit instruction in the session, never an agent's judgment. Each clearing gets a digest line, a `profile/decisions.md` row and an action-log entry.
- **Loop stop:** both platforms halted for more than a day.
- **Pause (the user's switch, not a halt):** `config/pause.json` `"paused": true` with `reason`, `since` and `by`. Live ticks view nothing (exit 4, next try in an hour), auto-apply stops, and the runner refuses real submits; dry runs still run. Set and lifted only on the user's word, each time with a `profile/decisions.md` row.
- **Cap override:** only on the operator's explicit instruction, only for the run the operator names. Point `JOBBA_LIMITS_LOG` at a copy of the real limiter log with only that cap's entries for today removed (every other cap stays in force), run, then merge the new entries into the real log tagged `cap_override`. Never a force flag, a same-day re-run after an abort, parallel searches or a retry loop.
- **After a checkpoint:** re-login by hand, halve the caps, one headed watched tick, then the loop.

## 7. State recovery

| Lost file | Cost | Recovery |
|---|---|---|
| `data/state/jobs.json` | Old roles are seen again. The pipeline itself lives in `pipeline/opportunities/` | Run on. Triage re-scores what is new |
| `data/state/limits-log.json` | Today's cap usage is forgotten | Run nothing more until the next reset |
| `data/tracker/state.json` | The last published hash | The next publish sends the page once. Doc ids stay in `config/tracker.json` |
| `data/mail/state.json` | The scan position | Set `config/mail.json` `first_scan_after` to the last scan date before the next `mail -- pending` |
| `data/log/actions.jsonl` | The audit trail | Append-only. Nothing replays it |

`data/` is not in any repository. `pipeline/`, `collateral/`, `profile/` and `config/` are backed up with a private `git init` inside the workspace (`templates/workspace/.gitignore`).

## 8. Dice

Dice runs in every firing after LinkedIn, for leadership and for hands-on senior, lead and principal roles (Lane H, `fit-profile.md`).

**Login.** The automation profile lives under `data/browser/`. The operator signs in once by hand with `npm run dice -- login` (headed); `npm run dice -- whoami` checks it. Profile edits happen in a normal browser, never in the automation profile.

**Search URL** (`scripts/lib/dice-url.mjs`, `config/dice-searches.json`): parameter table in `docs/platforms.md`. Never `"A" OR "B"`: the firewall answers 403 and the URL builder refuses it.

**Guards (Dice only):**

| Signal | Status | Action |
|---|---|---|
| HTTP 403 or "403 Forbidden" | `blocked` | Abort. Dice halted until the reset |
| A challenge page (captcha, "verify you are human") | `checkpoint` | Dice halted 7 days. The operator logs in by hand, then the Dice caps are halved |
| Signed out | `login` | Halts only after the home feed confirms it: Dice often serves its public header to a live session. Then `npm run dice -- login` |
| `job-search-no-results` | `empty` | Legitimate. Moves the query window |
| 0 cards, no marker | `suspect` | A canary suspect aborts. Two in a row abort |

**Caps:** `config/limits.json` `dice_jobs` and `dice_apply`, reset at `schedule.reset_hour`, LinkedIn's pacing.

**Prefilter and triage.** A Dice title passes on `title_leadership` or `title_ic`; `ic_title_drop` removes support desks, analysts and platforms outside the record. G1 reads the contract badges against `preferences.engagement.accept`. G2 reads the job page badge, never the search filter. The digest prints the posted rate.

**Manual sweep** (the operator's instruction only): `node scripts/dice-tick.mjs --sweep [--views <n>]` runs every configured query, reads page 2 when page 1 is full, then views kept roles up to `--views`. It skips the hours check, never the caps, guards or halt.

**Query probe.** A probe file with `"source": "dice"`: `npm run probe -- --file config/probes/<file>.json` (headed for the first run; `--into-state` also writes the cards into state for a one-time scan), then `npm run probe-report -- data/probes/<file>`. Its verdicts fill `queries`, and `npm run probe -- --mark-verified data/probes/<file>` sets `verified: true`. Until then `dice-tick` exits 2 (`not-verified`) and the loop treats it as a no-op.

**Dice Easy Apply (`dice-easy`).** The runner opens the wizard link, fills it from `profile/answers.json`, replaces the resume with the approved CV for this application only (Replace), puts the letter in the Cover Letter slot (never a CV), unticks follow, subscribe and job-alert opt-ins and refuses while one stays ticked, checks the review cards, and after the submit reads the profile resume to confirm it did not change. A link off Dice goes down the ATS path; an unverified ATS means manual. Details: `docs/platforms.md`.

## 9. Inbox

Design: `docs/inbox-scan-design.md`. Adapter: `config/mail.json` `adapter` (`gws`, `bridge` or `none`). Runs in every firing (loop step 4c).

| Step | Command | Writes |
|---|---|---|
| Export | `npm run -s mail -- pending` | `data/mail/pending-<stamp>.json`: signal mail with bodies, plus the operator's own replies. At most `max_per_run` messages a firing, oldest first. With nothing to judge it saves `data/mail/state.json`. `bridge`: `pending`, `pending --headers <response>` and `pending --bodies <response>`, each exit 6 `needs_fetch` until done (`docs/adapters.md`) |
| Judge | The session classifies, matches and drafts | `data/mail/results-YYYYMMDD-HHMM.json` |
| Record | `npm run -s mail -- record --file <results> --sent <pending file>` | Thread files and `README.md` in `pipeline/mail/`, opportunity stage-log rows, channel contact rows, then the scan state (never backwards). Deletes the pending file |
| Close | `npm run -s mail -- close --thread <id> --status closed\|no-reply --note "..."` | The thread's status and note |

| Problem | Fix |
|---|---|
| `pending` exits 2 | The mail reader is not signed in (gws: `npm run gws -- auth login --scopes https://www.googleapis.com/auth/gmail.readonly`). Tell the operator once; the loop carries on without mail |
| `pending` exits 6 (`bridge`) | Fulfil the named request with the connector's read tools, write the named response file, then run the `next` command from the output (`docs/adapters.md`, bridge handshake) |
| `pending` exits 1, or lists `thread_errors` | Exit 1: the error is in the JSON; report it once and carry on. A thread error is a thread the mailbox no longer returns: close its card with `mail -- close` |
| A hunt email never shows up | Check its sender and subject against `config/mail.json`. Add a staffing domain to `hunt_senders`. Never add a client domain there |
| Mail that should never be opened was opened | Add the sender or domain to `never_open`, then delete the pending file. Record it as `ignore` |
| A card stays after the operator replied | Sent detection reads the operator's sent mail after the newest email on the thread, so a reply in another thread is missed. Close it with `mail -- close` |
| `record` refuses | It names the thread and the reason: a rate figure, a semicolon, an em dash, an unknown claim, a role under the IC floor. Fix the result and re-run. Nothing was written |

**Work-sample challenge platforms** (a required build or video behind an account, not a form) go to the operator as `manual`. The loop never completes a challenge or records anything on the operator's behalf.

## 10. Data files

| Path | Content |
|---|---|
| `data/state/jobs.json` | One record per job ID: sightings, prefilter, detail, triage, status, halts |
| `data/state/limits-log.json` | Every page load, read by the caps |
| `data/raw/YYYYMMDD-HHMM-sweep.json`, `...-tick.json` | Per-run snapshot: per-query status and window, guards, survivors, views |
| `data/applications/<job_id>/` | Runner screenshots and `result.json` per run, dialog HTML on dry runs, tailoring (`tailor.json`, `jd.txt`, `jd.terms.txt`, `cv/<slug>.json`, `cover-letter.json` and the letter files), `answers.json` |
| `data/triage/` | Pending-triage exports, scored results, blind calibration copies |
| `data/tracker/` | The rendered dashboard, last published hash, `watch-state.json` |
| `data/mail/` | Pending, results, requests and responses, scan state |
| `data/captures/` | HTML and screenshots from `--capture`. They show the signed-in page: sanitize before any reuse |
| `data/probes/` | Probe results: every card, final URLs, views |
| `data/log/actions.jsonl` | The action log (`npm run log`) |
| `data/out/cv/` | Rendered CVs: `share/` and dated or list folders |

## 11. Search troubleshooting

| Symptom | Fix |
|---|---|
| Cards have IDs but no title or company | The virtualized list did not render. Check the scroll container headed. Views still fill the fields |
| Many good roles get `scope-unconfirmed` | Expected before a view on fractional queries. Views confirm the scope |
| A real role was dropped | Find it in `data/state/jobs.json` (`prefilter.reasons`). Adjust `config/prefilter.json` with a prefilter test for the case |
| A search "returns" a handful of promoted jobs | LinkedIn's no-results page with "Jobs you may be interested in" filler. It is classified `empty` and the filler counted in `filler_count`. If it shows `ok` again, the empty marker moved: replay the capture |
| Results full of cloned listings (the same title in many cities, expert-network gigs) | Add `NOT <company>` to the query and the company to `company_drop`, with a prefilter test. Repost detection keeps clones out of the view queue |
| The AI-search canary collects 1 card | The card selector broke. Replay a capture and re-pin `aiCard` |
| Classic search redirects or stops honouring quotes | Classic search is retired. Probe the classic queries on the AI endpoint; remote and structure filtering moves to the prefilter |
| A query missed several ticks | Nothing to do. It searches back to its own last ok run |
