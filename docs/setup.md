# Setup

From a clean machine to a ready workspace, on macOS, Debian/Ubuntu or Fedora. Run the steps in order. Each step ends with a checkpoint: do not go on until it passes. The rules every step follows are in `AGENTS.md`.

Paths: repo-relative (`scripts/...`, `bin/...`) or workspace-relative (`workspace/...`, the default workspace location; `JOBBA_HOME` moves it).

## What the host needs

| Class | Item | Notes |
|---|---|---|
| Required | git | Step 1. On macOS it comes with Apple's Command Line Tools (about 1.3 GB) |
| Required | Node.js 22.13 or newer | The minimum is `package.json` `engines.node` (pdfjs-dist needs 22.13). `.nvmrc` says 22. Step 2 |
| Required | An agent harness: Claude Code, or another that reads `AGENTS.md` | Step 6. Claude Code needs macOS 13 or newer and a paid Claude plan or a Console account. The claude.ai connectors (the Gmail connector) need a paid plan signed in through `/login` |
| Required | macOS, or a Linux desktop session with a display | Logins, first dry runs and bot checks happen in a visible browser window. A headless server cannot do them |
| Required | About 0.5 GB of disk | The bundled Chromium (about 350 MB) and `node_modules` (about 150 MB), measured on macOS. Plus the Command Line Tools on a new Mac |
| Bundled | Chromium (CloakBrowser), playwright-core, the bikeshed CLI, the Google Workspace CLI (`gws`), pdf-lib, pdfjs-dist, docx, marked, OFL fonts | Installed into this folder by `./bin/bootstrap`. Nothing is installed globally |
| Optional | Python 3.8+ (`python3`, or `uv run`) | `authentic-prose`'s optional `scripts/metrics.py` (stdlib only) |
| Optional | A mail connector in the agent harness | Mail adapter `bridge` (step 10) |
| Optional | firecrawl or Perplexity tools in the harness | Richer company research in `/hunt-kit`. Without them it uses the harness's own web search and fetch |

## One-line install (macOS)

On macOS 13 or newer, one command does steps 1 to 4 and installs the agent (step 6). The Mac needs nothing installed first, not even git:

```sh
curl -fsSL https://raw.githubusercontent.com/DeputyHumans/jobba-hunt/main/bin/install | sh
```

| What `bin/install` does | Skipped when |
|---|---|
| Apple's Command Line Tools (git): opens Apple's install dialog and waits up to 60 minutes for it | A real git is installed |
| Creates the shell profile (`$HOME/.zshrc`, or `$HOME/.bash_profile` for bash) | It exists |
| nvm v0.41.0, then `nvm install 22` | Node 22.13 or newer is on `PATH` |
| Claude Code (native installer), and `$HOME/.local/bin` on `PATH` in the profile | `claude` is on `PATH` |
| Clones the project over HTTPS into `$HOME/jobba-hunt` | The folder is already a checkout: it is fast-forwarded |
| `./bin/bootstrap` | Never |

- **Settings:** `JOBBA_DIR` (another folder), `JOBBA_REF` (another branch), `JOBBA_CLT_TIMEOUT_MINUTES` (default 60). Pass them to `sh`: `curl -fsSL … | JOBBA_DIR="$HOME/code/jobba-hunt" sh`.
- **Exit codes:** 0 done; 1 a step failed (the message names the fix: fix it and run the line again); 2 not macOS, macOS older than 13, or run as root.
- It never uses sudo or Homebrew and installs nothing outside your home folder. It is safe to run again.

**Checkpoint:** it ends with "Installed. Next:". Open a new Terminal window, then go on with step 5.

## 1. Install git

| OS | Command |
|---|---|
| macOS | `xcode-select --install`. A dialog opens: click Install, accept the license and wait until it finishes. The Command Line Tools also bring `python3` (the optional row above) |
| Debian/Ubuntu | `sudo apt-get install -y git` |
| Fedora | `sudo dnf install -y git` |

On macOS, install the Command Line Tools before nvm: nvm's installer fails without them.

**Checkpoint:** `git --version` prints a version.

## 2. Install Node

Pick one route. On a new Mac, use nvm.

| OS | Route | Commands |
|---|---|---|
| Any | nvm | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh \| bash`, open a new shell, then `nvm install 22`. On macOS, run `touch $HOME/.zshrc` first: a new account has none, and the installer only edits a profile that exists. nvm makes the first version it installs the default for new shells |
| Any | fnm | Install fnm and its shell setup line from https://github.com/Schniz/fnm, open a new shell, then `fnm install 22 && fnm default 22` |
| macOS | Homebrew, when it is already installed | `brew install node@22`. The formula is keg-only: add it to `PATH` as brew's output says |
| Debian/Ubuntu | NodeSource | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt-get install -y nodejs` |
| Fedora | dnf | `sudo dnf install -y nodejs`. Check the version below: a release may ship Node older than 22.13 |

**Checkpoint:** `node -v` prints v22.13.0 or newer, and `npm -v` prints a version.

## 3. Clone

```sh
git clone https://github.com/DeputyHumans/jobba-hunt.git
cd jobba-hunt
```

Any folder works: no path in the project depends on where it lives.

**Checkpoint:** `ls -a` shows `bin/`, `scripts/`, `templates/`, `package.json` and `.nvmrc`.

## 4. Bootstrap

```sh
./bin/bootstrap
```

What it does, in order:
1. Detects the OS and refuses anything but macOS and Linux.
2. Checks git. With Node missing, it prints the install options for Node 22 (from `.nvmrc`) and stops. With Node older than `package.json` `engines.node`, it stops with the nvm line. It never installs system packages.
3. Runs `npm ci` (dependencies into `node_modules/`).
4. Runs `node scripts/setup.mjs` (the same as `npm run setup`). A setup failure stops bootstrap here.
   - Checks the npm dependencies and the bikeshed and gws CLIs.
   - Downloads the CloakBrowser Chromium into `.cache/cloakbrowser`, never the home folder: 140 MB, about 350 MB on disk (`npm run setup -- --skip-browser` skips it). The CloakBrowser banner it prints offers a key: the project needs none.
   - Links the skills: each `.claude/skills/<name>` is a relative symlink into `.agents/skills/<name>`.
   - Sets `git config core.hooksPath .githooks`. The pre-commit hook runs `check:portable` and `check:pii` on staged files.
   - On Linux, probes Chromium's shared libraries, `notify-send` and a display. When any library is missing, it prints the full Debian/Ubuntu and Fedora install lines ("Linux notes" below).
   - Ends with "Setup done".
5. Runs `npm run doctor -- --preflight`. Its result does not stop bootstrap: read its rows.
6. Ends with "Next: open this folder in your agent (for Claude Code: claude) and run /hunt-onboard."

It is idempotent: re-run it after a pull, a Node upgrade or a failed download.

**Checkpoint:** setup printed "Setup done", bootstrap ended with "Next: ...", and `npm test` passes. `npm test` runs against a temporary copy of the synthetic workspace in `tests/fixtures/workspace`, never yours.

## 5. Preflight

```sh
npm run doctor -- --preflight
```

It checks Node (against `package.json` `engines.node`), git, the npm dependencies (marked included), the Chromium download, the bundled fonts, the skill links, the git hook, the bikeshed and gws CLIs, the display and `notify-send` (Linux), the optional tools (`op`, `python3`) and path portability. Each row that is not `ok` prints its fix. The doctor applies nothing.

**Checkpoint:** exit 0, no `FAIL` rows. `warn` and `info` rows are allowed.

## 6. Install and open the agent

Claude Code runs every skill, and the loop's self-scheduling, notifications and comment watch need it (`AGENTS.md` "Skills"). Install it with the native installer:

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

The installer puts `claude` in `$HOME/.local/bin` and does not add that folder to `PATH`. Add it to the shell profile, then open a new shell:

| Shell | Command |
|---|---|
| zsh (the macOS default) | `echo 'export PATH="$HOME/.local/bin:$PATH"' >> $HOME/.zshrc` |
| bash | `echo 'export PATH="$HOME/.local/bin:$PATH"' >> $HOME/.bashrc` |

Claude Code needs macOS 13 or newer and a Pro, Max, Ultra, Team, Enterprise or Console account. The free Claude plan does not include it. With a Console account (an API key) the claude.ai connectors, such as Gmail, do not load: they need a paid plan signed in through `/login`. Details: https://code.claude.com/docs/en/setup.

Then run `claude` in the repo folder. The first start signs in through the browser and asks whether you trust the folder. It loads `CLAUDE.md`, a one-line import of `AGENTS.md`, and the skills through `.claude/skills/`. Another harness: install it from its own docs and start it from `AGENTS.md`.

**Checkpoint:** `claude --version` prints a version, and the harness lists `hunt-onboard` among its skills (Claude Code: type `/hunt-` and see the list).

## 7. Onboard

```
/hunt-onboard
```

It creates `workspace/` from `templates/workspace/`, ingests the CVs and letters, reviews every claim with the operator, runs the interview, and walks through steps 8 to 11 below in its Access phase. It resumes where it stopped.

The skill runs the conversation and writes the content. `npm run onboard -- <command>` creates, checks and tracks the workspace. In the tables below, `profile/`, `sources/`, `collateral/`, `config/`, `data/` and `fit-profile.md` are in the workspace.

### Commands

| Command | Does | Exit |
|---|---|---|
| `npm run onboard -- init` | Creates the workspace from `templates/workspace/` and never overwrites an existing file. Creates `data/`, `data/log/` and `.secrets/`. Marks the `init` phase | 0 |
| `npm run onboard -- status` | The phases done, with timestamps, and `next`, the first phase not done | 0 |
| `npm run onboard -- mark --phase <name>` | Records a finished phase: `preflight`, `init`, `ingest`, `claims`, `interview`, `answers`, `calibration`, `access`, `cvs`, `searches`, `ready` | 0; 2 on an unknown phase |
| `npm run onboard -- ingest --file <path> [--file <path> ...]` | Copies PDF, DOCX, TXT or MD sources into `sources/` and writes their page-tagged text next to them (`<name>.txt`) | 0; 1 on a missing file or an unsupported type; 2 usage |
| `npm run onboard -- validate` | Checks every workspace file for shape and consistency. `docs/troubleshooting.md` "Onboarding and workspace" lists the common messages | 0 clean; 1 problems |
| `npm run onboard -- git-init` | Makes the workspace its own private git repository. Its `.gitignore` comes from the template | 0 |
| `npm run onboard -- mail-guard --deny <tool,tool,...>` | Writes `permissions.deny` for a mail connector's non-read tools into `.claude/settings.local.json` | 0; 2 usage |

An unknown command prints the usage and exits 2.

### Phases

| # | Phase (`mark` name) | What happens | Asks the operator | Writes |
|---|---|---|---|---|
| 0 | Preflight (`preflight`) | `npm run setup`, then `npm run doctor -- --preflight` | Nothing, unless a check fails | Nothing in the workspace |
| 1 | Init (`init`) | `npm run onboard -- init`, which marks the phase. Offers `npm run onboard -- git-init` | Whether to keep the workspace in its own private git repository | The workspace skeleton |
| 2 | Ingest (`ingest`) | The operator's CVs, cover letters, profile export and links go to `sources/` (`npm run onboard -- ingest`). Text is read from the `.txt` twins. Material under NDA is never ingested | The documents and links | Draft `collateral/cv/master.json`; candidate claims in the Pending table of `collateral/claim-bank.md`, each sourced `src:<file>#p<n>`; candidate voice samples for `profile/voice.md` |
| 3 | Claims (`claims`) | Candidates shown one by one. A confirmed claim moves to the Claims table with status `CV` or `user-confirmed`. Only Claims-table rows with status `user-confirmed`, `public` or `CV` are usable (`AGENTS.md` "Honesty") | Confirm, edit or reject each claim; anything never to say | `collateral/claim-bank.md` (Claims and Never claim), `collateral/cv/never-claim.json` |
| 4 | Interview (`interview`) | Questions in rounds of at most 4 ("Interview topics" below) | The topics below | `profile/person.json`, `profile/preferences.json`, `profile/answers.json`, `fit-profile.md`, `config/prefilter.json`, `config/apply.json`, `profile/decisions.md` |
| 5 | Answers (`answers`) | Q01-Q21 drafted from claims through `authentic-prose`. `npm run apply -- check-answers` lists the answer-bank values still empty | Confirm each answer | `collateral/screening-answers.md`, `profile/answers.json` (single values, and `learned` through `npm run apply -- learn`) |
| 6 | Calibration (`calibration`) | 5-15 roles with known verdicts; a blind `/hunt-triage calibrate` must pass `scripts/check-calibration.mjs` | The roles and the expected verdict for each | `data/calibration.json` |
| 7 | Access (`access`) | Steps 8 to 11 of this file: LinkedIn and Dice logins by hand in a real terminal, then `whoami`; the mail adapter; `npm run bikeshed -- login`, then the private folder, its `Reviews` and `Letters` subfolders and the tracker document; ATS accounts | Each sign-in; the mail adapter and publisher choices | `config/mail.json`; `config/tracker.json` (`bikeshed.folder_id`, `reviews_folder_id`, `letters_folder_id`, then `doc_id` and `url` from the first publish); `config/cv-bikeshed.json` `folder_id` |
| 8 | Baseline CVs (`cvs`) | Archetype variants from `master.json`, built with `npm run cv -- --all` and published with `npm run cv-publish`. Then one `/hunt-tailor` rehearsal against a calibration posting, never sent | Approve each render (in bikeshed) | `collateral/cv/variants/`, `collateral/cv-map.md`, `config/cv-bikeshed.json` `docs`, `data/out/cv/` |
| 9 | Searches (`searches`) | Candidate queries per lane, then `/hunt-probe` for each platform the operator uses. `verified: true` comes only from a probe (`npm run probe -- --mark-verified`) | Judgment calls the probe report flags | `config/searches.json`, `config/dice-searches.json`, `config/probes/`, a report in `workspace/docs/probes/` |
| 10 | Ready (`ready`) | `npm run onboard -- validate` exits 0 and `npm run doctor` shows no `FAIL` rows | Nothing | `profile/onboarding.json` complete. Tells the operator to start `/loop /hunt-loop`, and that each channel's first application is a headed dry run they check |

### Interview topics

| Topic | Default | Lands in |
|---|---|---|
| Identity and contact: name, display name, file prefix, email, application email, phone, location, workplace line, links, phone on CV | `show_phone_on_cv: false` | `profile/person.json` (`workplace` is the CV's contact line, for example "Remote (US)"); `answers.json` `profile` |
| Work authorization, sponsorship, legal entity, contract types, start date | None | `answers.json` `facts` (`work_authorization`, `work_authorization_type`, `sponsorship`, `contracting_entity`, `contract_types`, `start_date`); `preferences.engagement.accept` |
| EEO self-identification | `decline` for each | `answers.json` `eeo`; a `decisions.md` row for any other value |
| Lanes, titles, seniority, engagement types, domains, buyer, capacity | Both lanes | `preferences.lanes`, `preferences.engagement.accept`, `fit-profile.md` |
| Location, home metro, travel, relocation | `remote_required: true`, no metros | `preferences.location`; `answers.json` `facts.relocation`, `facts.remote` and the address fields; `fit-profile.md` G2 |
| Standing form rates, the IC rate floor, the full-time salary floor and target | Floors `null` (off) | `answers.json` `facts.rate_hourly`, `facts.rate_annual`; `preferences.money` |
| Exclusions: stacks, title words, companies | Empty | `config/prefilter.json` `stack_title_drop`, `ic_title_drop`, `company_drop`, `onsite_metro_markers` |
| Schedule and ask window, time zone, reset hour | Weekdays, ticks 08:00-18:00, questions 09:00-18:00, caps reset at 04:00, in the operator's time zone | `preferences.schedule` |
| Platforms: LinkedIn, Dice | Both | Which probes the Searches phase runs |
| Letter approach: per job, or a fixed A, B, C or D (`docs/tailoring.md` "Cover letters") | `per-job` | `preferences.tailoring.letter`; a `decisions.md` row |
| Tailoring: per-job or archetype CVs; review in bikeshed or auto-send | `per-job`, `bikeshed` | `preferences.tailoring.cv`, `preferences.tailoring.review`; a `decisions.md` row for `archetype` or `auto` |
| Auto-apply: off, or on with thresholds and channels | Off | `config/apply.json` `auto_apply` (`enabled`, `min_score`, `channels`, `min_cv_coverage`, `cover_letter`, `cv_pool`); a `decisions.md` row when switched on |
| The per-company limit | `limit` 1, no agencies, no aliases | `config/apply.json` `companies` (`limit`, `agencies`, `aliases`); a `decisions.md` row for a change |

The mail adapter and the publisher are asked in the Access phase, not here.

### Fresh-install posture

What `templates/workspace/` ships, before the operator changes anything:

| Setting | Value |
|---|---|
| Channels | Every channel unverified (`config/apply.json` `verified`) |
| Query sets | `verified: false` in `config/searches.json` and `config/dice-searches.json`: ticks refuse until a probe verifies them |
| Auto-apply | Off (`config/apply.json` `auto_apply.enabled: false`) |
| Per-company limit | 1 (`config/apply.json` `companies.limit`) |
| The pause | Off (`config/pause.json` `paused: false`) |
| Tailoring | `preferences.tailoring`: `cv` `per-job`, `letter` `per-job`, `review` `bikeshed` |
| Caps | As shipped in `templates/workspace/config/limits.json` |
| ATS accounts | Never created by the runner; a sign-in or sign-up page goes to the operator |
| Mail | Adapter `none` |
| Publisher | `bikeshed` (`config/tracker.json` `publisher`) |
| EEO answers | `decline` |

### Resuming

`profile/onboarding.json` records a timestamp per finished phase. `npm run onboard -- status` prints `next`, the first phase without one. `/hunt-onboard` reads it and starts there. An interrupted phase runs again from its start, and files written before the interruption are kept (`init` never overwrites). Re-running a finished phase is allowed: ask for it by name. `npm run onboard -- validate` and `npm run doctor` can run at any point.

**Checkpoint for step 7:** `npm run onboard -- status` shows `"next": null`, `npm run onboard -- validate` exits 0, and `npm run doctor` shows no `FAIL` rows.

## 8. First logins (LinkedIn, Dice)

By hand, in a real terminal, not through the agent:

```sh
npm run jobs -- login     # headed window: sign in to LinkedIn, then press Enter in the terminal
npm run dice -- login     # headed window: sign in to Dice; it closes once signed in
```

A harness shell runner has no keyboard for the Enter step and leaves the profile locked. The sessions live in `workspace/data/browser/linkedin` and `workspace/data/browser/dice`.

**Checkpoint:** `npm run jobs -- whoami` and `npm run dice -- whoami` report signed in. Each loads one page; neither counts against a daily cap.

## 9. bikeshed sign-in

The dashboard, the CV renders and the review documents live in private bikeshed documents. Sign in through the project's wrapper:

```sh
npm run bikeshed -- login
```

The browser opens for the sign-in (`--paste` takes a token instead). The wrapper (`scripts/tool.mjs`) runs the pinned CLI from `node_modules/.bin` with `XDG_CONFIG_HOME` set to `workspace/.secrets/xdg`, so the credentials land in the workspace, where every script looks.

**Never a global install or a bare `npx`/`npm exec`** (`AGENTS.md` "Tools"). Those store the token in the home folder's config directory, which the scripts never read, and a global CLI may not be the pinned version. A token in `workspace/.secrets/.env` (`BIKESHED_TOKEN=...`) works too.

The Access phase of `/hunt-onboard` then creates a private folder and its `Reviews` and `Letters` subfolders. It records their ids in `workspace/config/tracker.json` (`bikeshed.folder_id`, `reviews_folder_id`, `letters_folder_id`) and the folder id in `workspace/config/cv-bikeshed.json` (`folder_id`). The first `npm run tracker -- --publish` creates the tracker document and records `doc_id` and `url`.

**Checkpoint:** `npm run bikeshed -- folders --json` lists the folder, and `npm run tracker -- --publish` exits 0.

To run without bikeshed, set `"publisher": "local"` in `workspace/config/tracker.json`: the dashboard is written to `workspace/data/tracker/tracker.html`, with no comments and no review documents.

## 10. Mail adapter

`workspace/config/mail.json` `adapter`, plus `me` (the one mailbox the scan reads). The mail rules are in `AGENTS.md` "Mail (any adapter)". Details: `docs/adapters.md`.

### `gws`: the bundled Google Workspace CLI

1. In the Google Cloud Console, in a project of the operator's: enable the Gmail API, configure the OAuth consent screen (add the operator as a test user), and create an OAuth client of type Desktop app.
2. Save its JSON as `workspace/.secrets/gws/client_secret.json`, or put `GOOGLE_WORKSPACE_CLI_CLIENT_ID=...` and `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET=...` in `workspace/.secrets/.env`.
3. Sign in with the read-only Gmail scope only:

   ```sh
   npm run gws -- auth login --scopes https://www.googleapis.com/auth/gmail.readonly
   ```

The wrapper gives the CLI its config dir (`workspace/.secrets/gws`, file keyring) and an in-folder home (`workspace/.secrets/gws-home`), and strips the host credential variables. Host gcloud or application-default credentials are never picked up. Sign in through `npm run gws` only.

**Checkpoint:** `npm run doctor` shows `gws adapter credentials present`, and `npm run mail -- pending --dry-run` exits 0.

### `bridge`: the harness's mail connector

For a harness with a Gmail (or other mail) connector. Scripts never fetch: they write request files and the agent fulfils them with the connector's read tools.

1. List the connector's tools in the harness.
2. Deny every tool that is not a read (send, draft, label, archive, delete, modify, mark read):

   ```sh
   npm run onboard -- mail-guard --deny <tool,tool,...>
   ```

   It writes `permissions.deny` into `.claude/settings.local.json` (gitignored).
3. Set `"adapter": "bridge"` in `workspace/config/mail.json`.

**Checkpoint:** `npm run mail -- pending --dry-run` exits 6 (`needs_fetch`) and names a request file under `workspace/data/mail/requests/`. Delete that request file afterwards.

### `none`

No inbox scan. Mailed codes at apply time hand the role to the operator.

**Checkpoint:** `npm run doctor` shows `mail adapter: none`.

## 11. ATS accounts

The runner never creates an ATS account, never types a password and never stores one. A Workday or iCIMS portal that asks for a sign-in, a new account or an email verification hands the role to you (exit 5, with the `ats_url`).

1. Run the apply in a headed window: `npm run apply -- --job <id> --dry-run --headed`.
2. Sign in, or create the account, by hand in that window. The browser profile keeps the session.
3. Run the apply again.

A `config/vault.json` left from an older install is unused: delete it. `npm run onboard -- validate` refuses `config/apply.json` `accounts.create: true`.

**Checkpoint:** none.

## 12. Ready

```sh
npm run doctor
```

**Checkpoint:** no `FAIL` rows. Then start the loop in the agent with `/loop /hunt-loop` (`docs/runbook.md` "The loop"). Each channel's first application is a headed dry run the operator checks before `npm run apply -- verify` (`docs/runbook.md` "Before the first live run").

## A second host

1. Install git, Node and the agent, clone the repo and run `./bin/bootstrap` (steps 1-6).
2. Bring the workspace: `git clone` the private workspace repository into `workspace/` (made with `npm run onboard -- git-init`), or copy the folder. Elsewhere on disk: point `JOBBA_HOME` at it.
3. Sign in again. The workspace repository leaves out the browser sessions (`data/browser/`) and `.secrets/`. Repeat steps 8, 9 and 10 as needed.
4. **One machine runs the loop.** Two loops would double the traffic on the same accounts against caps meant for one, and their job state and limiter logs would drift apart.

**Checkpoint:** `npm run doctor` on the second host shows no `FAIL` rows.

## Linux notes

| Need | Check | Fix |
|---|---|---|
| Chromium shared libraries | `npm run setup` lists any missing library | Setup prints both lines when any library is missing. Debian/Ubuntu: `sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libasound2`. Fedora: `sudo dnf install -y nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXrandr mesa-libgbm pango alsa-lib` |
| Desktop notifications | `command -v notify-send` | Debian/Ubuntu: `sudo apt-get install -y libnotify-bin`. Fedora: `sudo dnf install -y libnotify`. Without it, notifications go to the terminal |
| A display | `DISPLAY` or `WAYLAND_DISPLAY` is set | Run from a desktop session. Logins, headed dry runs and bot checks need a visible window |
