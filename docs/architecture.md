# Architecture

How the repository is laid out, how every path and config value is resolved, where state lives, and how scripts talk to agents and tests. The rules agents follow are in `AGENTS.md`; this file is the mechanism.

## Two roots

| Root | Holds | Tracked |
|---|---|---|
| The repository (`CODE_ROOT`) | Code, skills, templates, brand, docs, synthetic tests | Yes. No personal data, no host paths |
| The workspace (`HOME`: `JOBBA_HOME`, default `<repo>/workspace`) | Everything about one operator's hunt | No. Gitignored; optionally its own private repository (`npm run onboard -- git-init`) |

## Repository layout

```
README.md  AGENTS.md  LICENSE  NOTICE  package.json  package-lock.json  .nvmrc
CLAUDE.md                     the one line @AGENTS.md: Claude Code's import stub
bin/bootstrap                 POSIX sh first run: host check, Node against package.json engines, npm ci, setup, doctor --preflight
.githooks/pre-commit          check:portable and check:pii on staged files
.agents/skills/<name>/        canonical skills
.claude/skills/<name>         relative symlinks into .agents/skills/<name>
.claude/settings.json         allows npm run, npm test and node scripts/; denies shell timeout and gws auth export (it prints decrypted credentials); Bash timeouts
scripts/                      entrypoints: one per npm script, plus check-calibration.mjs and replay-capture.mjs (run with node)
scripts/cloak-core.mjs        browser launch, profile locks, argument parsing, out() and fail()
scripts/rate-limiter.mjs      the daily caps and the limiter log
scripts/lib/                  libraries (below)
scripts/lib/adapters/         mail, vault, publish, bikeshed (docs/adapters.md)
brand/                        tracker.css, recruiter-pages.css, brief.css, cv/template.css, cv/cover.css, OFL fonts and licences
templates/workspace/          the blank workspace that onboarding copies
templates/*.md                process templates (opportunity, digest, probe report, interview brief and debrief, review doc)
docs/                         process and operator docs (index: AGENTS.md "Where things are")
tests/  tests/fixtures/       node:test suites; synthetic DOM fixtures; tests/fixtures/workspace (synthetic persona)
.cache/                       gitignored: the CloakBrowser Chromium
workspace/                    gitignored: the operator's workspace
```

`scripts/lib/`:

| Area | Files |
|---|---|
| Paths, environment, config | `paths.mjs`, `env.mjs`, `config.mjs`, `profile.mjs`, `node-version.mjs` (the Node minimum from `package.json` `engines.node`) |
| State and logs | `state.mjs`, `actions-log.mjs`, `pause.mjs` (`config/pause.json`) |
| Search, prefilter, triage | `search-url.mjs`, `dice-url.mjs`, `extract.mjs`, `dice-extract.mjs`, `prefilter.mjs`, `guards.mjs`, `sweep-core.mjs`, `tick-plan.mjs`, `window.mjs`, `probe-metrics.mjs`, `triage.mjs`, `company.mjs` (the per-company limit), `rate.mjs` (posted pay) |
| CVs, letters, briefs | `cv.mjs`, `cv-pages.mjs`, `pdf.mjs`, `docx.mjs`, `docx-text.mjs`, `cover.mjs`, `letters.mjs`, `brief.mjs` (interview briefs, through marked), `brand-mark.mjs` |
| Apply runner | `apply-forms.mjs`, `apply-dom.mjs`, `apply-click.mjs`, `no-bg-jit.mjs` |
| Mail | `mail.mjs`, `mail-scan.mjs` |
| Pages and notifications | `tracker.mjs`, `recruiter-pages.mjs`, `notify.mjs` |

## Workspace layout

```
profile/      person.json  preferences.json  answers.json  voice.md  decisions.md  onboarding.json  pii-extra.txt  pii-allow.txt (both optional)
.secrets/     xdg/ (bikeshed)  gws/  gws-home/  .env
sources/      the operator's original CVs, letters, exports, and their extracted .txt
collateral/   claim-bank.md  cv-map.md  intro-templates.md  screening-answers.md  cv/{master.json, never-claim.json, variants/}
config/       searches.json  dice-searches.json  prefilter.json  apply.json  mail.json  tracker.json  vault.json  limits.json
              cv-bikeshed.json  pause.json  probes/
docs/         kits/ (profile kits)  probes/ (probe reports)
fit-profile.md
brand/        optional overrides of single repo brand files, and the optional mark.json
pipeline/     opportunities/  digests/  mail/  recruiter/  interviews/  proposals/  channels/
data/         state/  raw/  browser/  captures/  applications/<id>/  triage/  mail/  tracker/  probes/
              out/cv/  cv-preview/  cv-bikeshed/  letters-bikeshed/  recruiter/  log/actions.jsonl  calibration.json
```

## Path layer (`scripts/lib/paths.mjs`)

| Name | Value |
|---|---|
| `CODE_ROOT` | The repository, from the module's own location |
| `HOME` | `JOBBA_HOME`, else `<repo>/workspace` |
| `DATA_DIR` | `JOBBA_DATA_DIR`, else `<HOME>/data` |
| `PROFILE_DIR`, `CONFIG_DIR`, `COLLATERAL_DIR`, `CV_SRC`, `PIPELINE_DIR`, `SECRETS_DIR`, `SOURCES_DIR` | Under `HOME` |
| `OUT_DIR`, `CV_OUT`, `LOG_DIR` | `<DATA_DIR>/out`, `<DATA_DIR>/out/cv`, `<DATA_DIR>/log` |
| `TEMPLATES_DIR` | `<repo>/templates/workspace` |
| `CACHE_DIR`, `BIN_DIR`, `SCRIPTS_DIR`, `BRAND_DIR` | `<repo>/.cache`, `<repo>/node_modules/.bin`, `<repo>/scripts`, `<repo>/brand` |

- **`brandFile(...p)`**: the workspace's `brand/` copy of a file when it exists, else the repo's.
- **Brand settings:** `preferences.brand` sets the masthead kicker (`title`), the accent colour (`accent`) and the wordmark text (`wordmark`, else `person.json` `display_name`). The tracker's page title comes from `config/tracker.json` `title`, not from `preferences.brand`.
- **Logo mark:** optional, and only in the workspace, as `brand/mark.json` (`scripts/lib/brand-mark.mjs`). It is a square frame plus a filled seal in the accent: `{ "viewBox", "frame": { x, y, size, strokeWidth }, "seal": { x, y, size } }`. When a mark exists, the tracker, recruiter pages and prep briefs draw it next to the wordmark. The wordmark then stacks one word per line, and a trailing full stop takes the accent colour. The shipped pack has no mark.
- **`resolveArgPath(p)`**: a CLI path argument. `$JOBBA_HOME/...` and `$JOBBA_DATA_DIR/...` resolve to those roots; an absolute path is kept; a relative one resolves against `CODE_ROOT` when that file exists, then `HOME`.
- **`display(p)`**: the spelling every script prints and stores: repo-relative inside the repo, `$JOBBA_HOME/...` inside the workspace, `$JOBBA_DATA_DIR/...` inside a separate data dir. Never an absolute path. `resolveArgPath(display(p))` gets the file back.
- **`toolBin(name)`**: `node_modules/.bin/<name>`, unless `JOBBA_<NAME>_BIN` is set.
- **Portability:** only `paths.mjs` and `env.mjs` may compute roots or look up the OS home directory. `npm run check:portable` fails on home paths, the tilde shorthand, a home-directory lookup anywhere else, `../` that leaves the repo, bare `'..'` joins outside the path layer, and symlinks that leave the repo or dangle.

`scripts/lib/env.mjs` sets the in-folder runtime defaults (`docs/adapters.md` "In-folder isolation").

## Config

- **Merge** (`scripts/lib/config.mjs` `loadConfig(name)`): the shipped default in `templates/workspace/config/<name>` with the workspace file over it. Objects merge key by key; arrays and scalars from the workspace win. Keys starting with `_` are comments.
- **The pause** (`scripts/lib/pause.mjs` `readPause()`): reads the workspace `config/pause.json` alone, with no template merge. No file, or `paused: false`, means not paused. What it stops: `AGENTS.md` "Platform safety".
- **Schedule:** `loadSearchConfig('searches.json' | 'dice-searches.json')` injects `tick.{tz, days, start, end}` from `profile/preferences.json` `schedule`, the single source for every time window. The limiter and the halts use `schedule.tz` and `schedule.reset_hour`.
- **Profile** (`scripts/lib/profile.mjs`): `person()`, `preferences()`, `answers()` merge the workspace file over the template. Helpers: `tz()`, `schedule()`, `money()`, `tiers()`, `filePrefix()`, `cvFileBase(share)`, `coverFileBase(slug)`, `applicationEmail()`, `operatorName()`, `formatPhone(phone, country)` (adds the answer bank's country code) and `cvPhone()` (the number a CV may show: `person.json` `phone`, else the answer bank's). Libraries read them lazily, so tests inject values.
- **No workspace:** a command that needs one stops with "No workspace found. Run /hunt-onboard ...".
- **Writes:** `writeJsonAtomic` (temp file, then rename). Channel verification changes only through `npm run apply -- verify`.

## State and logs

| File | Owner | Content |
|---|---|---|
| `data/state/jobs.json` | `scripts/lib/state.mjs` | One record per job id (LinkedIn's numeric id, or `dice-<guid>`): sightings, prefilter, detail, triage, decision, application, tailoring review state; per-source halts (`halt_until`, `sources.dice`); per-query runs. Written atomically |
| `data/state/limits-log.json` | `scripts/rate-limiter.mjs` | Every page load and application, the source for cap enforcement. `JOBBA_LIMITS_LOG` points it elsewhere for an authorized read-cap override |
| `data/state/cap-overrides.json` | `scripts/rate-limiter.mjs` (read) | Dated apply-cap overrides the operator gave: `[{ date, platform, action, max, by }]`. Only today's date counts; a use past the standing cap is tagged `cap_override` |
| `data/log/actions.jsonl` | `scripts/lib/actions-log.mjs` | One line per state change: `{ at, actor, action, source?, job_id?, detail?, ref? }`, actor `script`, `agent` or `user`, action a dotted verb (`tick.done`, `triage.recorded`, `apply.submitted`, `docs.review-published`). Short values only: never a body, password, address or answer. Read with `npm run log -- [--since 2d] [--job <id>] [--limit n] [--json]`; the tracker shows recent activity from it. `JOBBA_ACTIONS_LOG` overrides the path |
| `data/applications/<id>/` | apply runner, tailoring | One folder per run (`<stamp>-dry-run`, `<stamp>-submit`) with `result.json`, screenshots and `step<N>-fields-filled.json` (each step's fields and values: names, emails and answers unmasked; phone, mobile, birth-date, street and address-line fields masked). Tailoring: `tailor.json`, `jd.txt`, `jd.terms.txt`, `cv/<slug>.json`, `cover-letter.json`, letter files. Job-scoped answers: `answers.json` |
| `data/tracker/` | tracker, watch, tailoring | `tracker.html`, `state.json` (last published hash), `review-docs.json` (review documents per job and part), `watch-state.json` |
| `data/out/cv/` | `npm run cv` | Dated builds (`<YYYYMMDD>/`), ready-to-attach copies (`share/`), and a recruiter list's CVs (`<list>/`) |
| `data/cv-preview/` | `npm run cv` | Page PNGs of each CV for visual checks |
| `data/cv-bikeshed/` | `npm run cv-publish` | Versions and hashes of the published CV documents (`state.json`, `<list>.json`). A recruiter list's 7-day share links (`<list>-share-links.json`) are read by `npm run recruiter-pages` |
| `data/letters-bikeshed/state.json` | tracker (`scripts/lib/letters.mjs`) | The documents of sent cover letters |
| `data/recruiter/` | `npm run recruiter-pages` | A recruiter list's rendered pages |
| `data/mail/` | `npm run mail` | Scan state, pending files, bridge request and response files |
| `data/triage/`, `data/probes/`, `data/raw/`, `data/captures/`, `data/calibration.json` | triage, probe, sweep and ticks, the drivers' `--capture`, onboarding | Pending triage batches, probe results, raw run snapshots, page captures, the calibration set |

## Script contract

- **The last stdout line** of every pipeline command is one JSON object (`out()` and `fail()` in `scripts/cloak-core.mjs`), with `success` and the result. Human-readable progress goes to stderr or earlier lines. Agents parse the last line only. `AGENTS.md` "Command contract" lists the pipeline commands and the exceptions.
- **Exit codes** are documented in each script's header comment and in the skills. Common meanings: 0 done; 1 error or a check failed. Beyond that each script defines its own. Read the header before acting on a code.

| Script | Codes beyond 0 and 1 |
|---|---|
| `tick`, `dice-tick` | 2 refused (a cap, or `not-verified`); 3 profile busy; 4 outside the tick window or paused; 5 halted |
| `sweep` | 2 refused (a cap, a halt, or `not-verified`); 3 profile busy; 4 paused |
| `probe` | 2 refused; 3 profile busy; 4 paused; 5 halted |
| `apply` | 2 refused by a gate; 3 profile busy; 4 needs answers; 5 handed to the operator, or a closed posting; 6 `submit-unverified`; 7 already applied on the platform |
| `tracker` | 2 signed out of bikeshed; 3 update refused by bikeshed; 4 open comments on the document |
| `cv-publish` | 2 signed out of bikeshed |
| `mail` | 2 mail reader not signed in; 6 `needs_fetch` (bridge) |
| `tailor` | 2 usage; 3 update refused by bikeshed; 4 signed out of bikeshed |
| `triage -- auto` | 2 blocked by the auto-apply rule |
| `onboard` | 2 usage |
| `watch -- --once` | 2 every document failed on sign-in |

- **Read-only platforms.** The job-board drivers (`scripts/linkedin-jobs.mjs`, `scripts/dice-jobs.mjs`) never click anything that writes. Only `scripts/apply-job.mjs` submits, behind its gates.
- **Gates before the browser.** A tick or sweep checks the pause, the tick window, halts, caps and the query set's `verified` flag before any browser starts. The apply runner checks the decision and approval, the pause, one submit per job, the per-company limit, the halt, the review of a B or C letter and the apply page-load cap first. It checks the channel's `verified` flag and that channel's applications cap as soon as the page shows which channel it is, before any field is filled. Callers never wrap a script in a retry loop.

## Tests

- `npm test` runs `scripts/run-tests.mjs`. It copies `tests/fixtures/workspace` to a temporary directory and sets:
  - `JOBBA_HOME` to that copy, and `JOBBA_DATA_DIR` to a second temporary directory;
  - `TZ=UTC`;
  - `JOBBA_NO_BROWSER=1`: `openContext` in `scripts/cloak-core.mjs` throws, so no test reaches a job board.

  It runs every `tests/*.test.mjs` under `node --test`, then deletes both directories. A test never reads or writes a real workspace. One file: `node scripts/run-tests.mjs tests/<file>.test.mjs`.
- **The synthetic workspace** (`tests/fixtures/workspace/`, marked by its `.synthetic` file): the persona Jordan Example (`jordan@example.com`, `(555) 555-0100`), synthetic employers (Acme Corp, Globex, Initech, Umbrella Labs, Hooli, Soylent Systems), synthetic job ids and Dice GUIDs.
- **DOM fixtures** (`tests/fixtures/*.html`) keep each platform's real structure with identifying text and ids replaced. They are where selector knowledge is tested offline (`docs/platforms.md`, "offline replay").
- **Config in tests** comes from `templates/workspace/config/` or `tests/fixtures/`, never a real workspace. Preference-bound assertions inject their values.
- `check:portable` runs in `npm test` (`tests/check-portable.test.mjs`) and in the pre-commit hook. `check:pii` runs in the pre-commit hook; it takes its terms from the active workspace and never from a synthetic one (`docs/privacy.md` "Guards").
