# Architecture

How the repository is laid out, how every path and config value is resolved, where state lives, and how scripts talk to agents and tests. The rules agents follow are in `AGENTS.md`; this file is the mechanism.

## Two roots

| Root | Holds | Tracked |
|---|---|---|
| The repository (`CODE_ROOT`) | Code, skills, templates, brand, docs, synthetic tests | Yes. No personal data, no host paths |
| The workspace (`HOME`: `JOBBA_HOME`, default `<repo>/workspace`) | Everything about one operator's hunt | No. Gitignored; optionally its own private repository (`npm run onboard -- git-init`) |

## Repository layout

```
README.md  CLAUDE.md  AGENTS.md  LICENSE  NOTICE  package.json  package-lock.json  .nvmrc
bin/bootstrap                 POSIX sh first run: host check, npm ci, setup, doctor --preflight
.githooks/pre-commit          check:portable and check:pii on staged files
.agents/skills/<name>/        canonical skills
.claude/skills/<name>         relative symlinks into .agents/skills/<name>
.claude/settings.json         permissions for npm run and node scripts; shell timeouts
scripts/                      entrypoints (one CLI each)
scripts/lib/                  libraries: path, env, config, profile, state, action log, CV, PDF, DOCX, apply, mail, tracker
scripts/lib/adapters/         mail, vault, publish, bikeshed
brand/                        tracker.css, recruiter-pages.css, cv/template.css, cv/cover.css, OFL fonts and licences
templates/workspace/          the blank workspace that onboarding copies
templates/*.md                process templates (opportunity, digest, probe report, interview brief and debrief, review doc)
docs/                         process and operator docs
tests/  tests/fixtures/       node:test suites; synthetic DOM fixtures; tests/fixtures/workspace (synthetic persona)
.cache/                       gitignored: the CloakBrowser Chromium
workspace/                    gitignored: the operator's workspace
```

## Workspace layout

```
profile/      person.json  preferences.json  answers.json  voice.md  decisions.md  onboarding.json
.secrets/     xdg/ (bikeshed)  gws/  gws-home/  .env
sources/      the operator's original CVs, letters, exports, and their extracted .txt
collateral/   claim-bank.md  cv-map.md  intro-templates.md  screening-answers.md  cv/{master.json, never-claim.json, variants/}
config/       searches.json  dice-searches.json  prefilter.json  apply.json  mail.json  tracker.json  vault.json  limits.json  cv-bikeshed.json  probes/
fit-profile.md  docs/kits/  brand/ (optional overrides of single repo brand files)
pipeline/     opportunities/  digests/  mail/  recruiter/  interviews/  proposals/  channels/
data/         state/  raw/  browser/  captures/  applications/<id>/  triage/  mail/  tracker/  probes/  out/cv/  log/actions.jsonl  calibration.json
```

## Path layer (`scripts/lib/paths.mjs`)

| Name | Value |
|---|---|
| `CODE_ROOT` | The repository, from the module's own location |
| `HOME` | `JOBBA_HOME`, else `<repo>/workspace` |
| `DATA_DIR` | `JOBBA_DATA_DIR`, else `<HOME>/data` |
| `PROFILE_DIR`, `CONFIG_DIR`, `COLLATERAL_DIR`, `CV_SRC`, `PIPELINE_DIR`, `SECRETS_DIR`, `SOURCES_DIR` | Under `HOME` |
| `CV_OUT`, `LOG_DIR` | `<DATA_DIR>/out/cv`, `<DATA_DIR>/log` |
| `TEMPLATES_DIR`, `CACHE_DIR`, `BIN_DIR`, `BRAND_DIR` | Under `CODE_ROOT` |

- **`brandFile(...p)`**: the workspace's `brand/` copy of a file when it exists, else the repo's.
- **Brand settings:** `preferences.brand` sets the page title, the accent colour and the wordmark text. An optional logo mark lives only in the workspace, as `brand/mark.json` (`scripts/lib/brand-mark.mjs`). It is a square frame plus a filled seal in the accent: `{ "viewBox", "frame": { x, y, size, strokeWidth }, "seal": { x, y, size } }`. When a mark exists, the tracker, recruiter pages and prep briefs draw it next to the wordmark. The wordmark then stacks one word per line, and a trailing full stop takes the accent colour. The shipped pack has no mark.
- **`resolveArgPath(p)`**: a CLI path argument. `$JOBBA_HOME/...` and `$JOBBA_DATA_DIR/...` resolve to those roots; an absolute path is kept; a relative one resolves against `CODE_ROOT` first, then `HOME`.
- **`display(p)`**: the spelling every script prints and stores: repo-relative inside the repo, `$JOBBA_HOME/...` inside the workspace, `$JOBBA_DATA_DIR/...` inside a separate data dir. Never an absolute path. `resolveArgPath(display(p))` gets the file back.
- **`toolBin(name)`**: `node_modules/.bin/<name>`, unless `JOBBA_<NAME>_BIN` is set.
- **Portability:** only `paths.mjs` and `env.mjs` may compute roots or look up the OS home directory. `npm run check:portable` fails on home paths, the tilde shorthand, a home-directory lookup anywhere else, `../` that leaves the repo, bare `'..'` joins outside the path layer, and symlinks that leave the repo or dangle.

`scripts/lib/env.mjs` sets the in-folder runtime defaults (`docs/adapters.md`, In-folder isolation).

## Config

- **Merge** (`scripts/lib/config.mjs` `loadConfig(name)`): the shipped default in `templates/workspace/config/<name>` with the workspace file over it. Objects merge key by key; arrays and scalars from the workspace win. Keys starting with `_` are comments.
- **Schedule:** `loadSearchConfig('searches.json' | 'dice-searches.json')` injects `tick.{tz, days, start, end}` from `profile/preferences.json` `schedule`, the single source for every time window. The limiter and the halts use `schedule.tz` and `schedule.reset_hour`.
- **Profile** (`scripts/lib/profile.mjs`): `person()`, `preferences()`, `answers()` merge the workspace file over the template. Helpers: `tz()`, `schedule()`, `money()`, `tiers()`, `filePrefix()`, `cvFileBase(share)`, `coverFileBase(slug)`, `applicationEmail()`, `operatorName()`. Libraries read them lazily, so tests inject values.
- **No workspace:** a command that needs one stops with "No workspace found. Run /hunt-onboard ...".
- **Writes:** `writeJsonAtomic` (temp file, then rename). Channel verification changes only through `npm run apply -- verify`.

## State and logs

| File | Owner | Content |
|---|---|---|
| `data/state/jobs.json` | `scripts/lib/state.mjs` | One record per job id (LinkedIn's numeric id, or `dice-<guid>`): sightings, prefilter, detail, triage, decision, application, tailoring review state; per-source halts (`halt_until`, `sources.dice`); per-query runs. Written atomically |
| `data/state/limits-log.json` | `scripts/rate-limiter.mjs` | Every page load and application, the source for cap enforcement. `JOBBA_LIMITS_LOG` points it elsewhere for an authorized override |
| `data/log/actions.jsonl` | `scripts/lib/actions-log.mjs` | One line per state change: `{ at, actor, action, source?, job_id?, detail?, ref? }`, actor `script`, `agent` or `user`, action a dotted verb (`tick.done`, `triage.recorded`, `apply.submitted`, `docs.review-published`). Short values only: never a body, password, address or answer. Read with `npm run log -- [--since 2d] [--job <id>] [--limit n] [--json]`; the tracker shows recent activity from it. `JOBBA_ACTIONS_LOG` overrides the path |
| `data/applications/<id>/` | apply runner, tailoring | Per-run folders with `result.json` and screenshots; `tailor.json`, `jd.terms.txt`, `cv/<slug>.json`, `cover-letter.json`, letter files |
| `data/tracker/` | tracker, watch, tailoring | `tracker.html`, `state.json` (last published hash), `review-docs.json`, `watch-state.json` |

## Script contract

- **One JSON object on the last stdout line** of every CLI (`out()` and `fail()` in `scripts/cloak-core.mjs`), with `success` and the result. Human-readable progress goes to stderr or earlier lines. Agents parse the last line only.
- **Exit codes** are documented in each script's header comment and in the skills. Common meanings: 0 done; 1 error or a check failed. Beyond that each script defines its own: the ticks use 2 refused (cap or `not-verified`), 3 profile busy, 4 outside the window, 5 halted; the apply runner 2 refused by a gate, 3 profile busy, 4-7 outcomes; the tracker, `cv-publish` and `mail` use 2 for signed out; the tracker and tailor review use 3 for an update bikeshed refused; tailor review uses 4 for signed out; mail uses 6 for `needs_fetch`; onboard and tailor use 2 for usage. Read the header before acting on a code.
- **Read-only platforms.** The job-board drivers (`scripts/linkedin-jobs.mjs`, `scripts/dice-jobs.mjs`) never click anything that writes. Only `scripts/apply-job.mjs` submits, behind its gates.
- **Gates before the browser.** Caps, halts, approvals and channel verification are checked before any browser starts. Callers never wrap a script in a retry loop.

## Tests

- `npm test` runs `scripts/run-tests.mjs`: every `tests/*.test.mjs` under `node --test`, with `JOBBA_HOME=tests/fixtures/workspace`, a fresh temporary `JOBBA_DATA_DIR` removed afterwards, and `TZ=UTC`. A test never reads or writes a real workspace. One file: `node scripts/run-tests.mjs tests/<file>.test.mjs`.
- **The synthetic workspace** (`tests/fixtures/workspace/`): the persona Jordan Example (`jordan@example.com`, `(555) 555-0100`), synthetic employers (Acme Corp, Globex, Initech, Umbrella Labs, Hooli, Soylent Systems), synthetic job ids and Dice GUIDs.
- **DOM fixtures** (`tests/fixtures/*.html`) keep each platform's real structure with identifying text and ids replaced. They are where selector knowledge is tested offline (`docs/platforms.md`, "offline replay").
- **Config in tests** comes from `templates/workspace/config/` or `tests/fixtures/`, never a real workspace. Preference-bound assertions inject their values.
- `check:portable` and `check:pii` run in the pre-commit hook; `check:pii` takes its terms from the active workspace and never from the synthetic one.
