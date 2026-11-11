# Setup

From a clean machine to a ready workspace, on macOS, Debian/Ubuntu or Fedora. Each step ends with a checkpoint: do not go on until it passes.

Paths: repo-relative (`scripts/...`, `bin/...`) or workspace-relative (`workspace/...`, the default workspace location; `JOBBA_HOME` moves it).

## What the host needs

| Class | Item | Notes |
|---|---|---|
| Required | Node.js 20 or newer (`.nvmrc` pins 22) | Step 1 |
| Required | git | Step 2 |
| Required | macOS, or a Linux desktop session with a display | Logins, first dry runs and bot checks happen in a visible browser window. A headless server cannot do them |
| Required | About 1.5 GB of disk | Mostly the bundled Chromium |
| Bundled | Chromium (CloakBrowser), playwright-core, the bikeshed CLI, the Google Workspace CLI (`gws`), pdf-lib, pdfjs-dist, docx, OFL fonts | Installed into this folder by `./bin/bootstrap`. Nothing is installed globally |
| Optional | 1Password CLI (`op`) | Vault adapter `op` (step 11) |
| Optional | Python 3.8+ (`python3`, or `uv run`) | `authentic-prose`'s optional `scripts/metrics.py` (stdlib only) |
| Optional | A mail connector in the agent harness | Mail adapter `bridge` (step 10) |
| Optional | firecrawl or Perplexity tools in the harness | Richer company research in `/hunt-kit`. Without them it uses the harness's own web search and fetch |

## 1. Install Node

Pick one route. nvm and fnm read `.nvmrc` from the repo folder.

| OS | Route | Commands |
|---|---|---|
| Any | nvm | Install nvm from https://github.com/nvm-sh/nvm, open a new shell, then in the repo folder: `nvm install && nvm use` |
| Any | fnm | Install fnm from https://github.com/Schniz/fnm, then in the repo folder: `fnm install && fnm use` |
| macOS | Homebrew | `brew install node@22`. The formula is keg-only: add it to `PATH` as brew's output says |
| Debian/Ubuntu | NodeSource | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt-get install -y nodejs` |
| Fedora | dnf | `sudo dnf install -y nodejs`. Check the version below: an older release may ship Node under 20 |

**Checkpoint:** `node -v` prints v20 or newer, and `npm -v` prints a version.

## 2. Install git

| OS | Command |
|---|---|
| macOS | `xcode-select --install` |
| Debian/Ubuntu | `sudo apt-get install -y git` |
| Fedora | `sudo dnf install -y git` |

**Checkpoint:** `git --version` prints a version.

## 3. Clone

```sh
git clone <repository URL> jobba-hunt
cd jobba-hunt
```

Any folder works: no path in the project depends on where it lives.

**Checkpoint:** `ls` shows `bin/`, `scripts/`, `templates/`, `package.json` and `.nvmrc`.

## 4. Bootstrap

```sh
./bin/bootstrap
```

What it does, in order:
1. Detects the OS and refuses anything but macOS and Linux.
2. Checks git, and Node against `.nvmrc`. With Node missing or older than 20, it prints the install options from step 1 and stops. It never installs system packages.
3. Runs `npm ci` (dependencies into `node_modules/`).
4. Runs `npm run setup`:
   - downloads the CloakBrowser Chromium into `.cache/cloakbrowser` (never the home folder; `--skip-browser` skips it);
   - links the skills: each `.claude/skills/<name>` is a relative symlink into `.agents/skills/<name>`;
   - sets `git config core.hooksPath .githooks` (the pre-commit hook runs `check:portable` and `check:pii`);
   - on Linux, probes Chromium's shared libraries, `notify-send` and a display, and prints one copy-paste `apt-get` or `dnf` line for whatever is missing (Linux notes below).
5. Runs `npm run doctor -- --preflight`.

It is idempotent: re-run it after a pull, a Node upgrade or a failed download.

**Checkpoint:** setup ends with "Setup done", and `npm test` passes (it runs against the synthetic workspace in `tests/fixtures/workspace`, never yours).

## 5. Preflight

```sh
npm run doctor -- --preflight
```

It checks Node, git, the npm dependencies, the Chromium download, the bundled fonts, the skill links, the git hook, the display, `notify-send` (Linux), the optional tools and path portability. Every red row carries its fix.

**Checkpoint:** exit 0, no `FAIL` rows. `warn` and `info` rows are allowed.

## 6. Open the agent

Open the repo folder in the agent harness. For Claude Code: `claude` in the repo folder. It loads `CLAUDE.md` and the skills through `.claude/skills/`. Another harness starts from `AGENTS.md` (`docs/skills.md`).

**Checkpoint:** the harness lists `hunt-onboard` among its skills (Claude Code: type `/hunt-` and see the list).

## 7. Onboard

```
/hunt-onboard
```

It creates `workspace/` from `templates/workspace/`, ingests the CVs and letters, reviews every claim with the operator, runs the interview, and walks through steps 8 to 11 below at its access phase. Phase by phase: `docs/onboarding.md`. It resumes where it stopped.

**Checkpoint:** `npm run onboard -- status` shows `"next": null`, `npm run onboard -- validate` exits 0, and `npm run doctor` shows no `FAIL` rows.

## 8. First logins (LinkedIn, Dice)

By hand, in a real terminal, not through the agent:

```sh
npm run jobs -- login     # headed window: sign in to LinkedIn, then press Enter in the terminal
npm run dice -- login     # headed window: sign in to Dice; it closes once signed in
```

A harness shell runner has no keyboard for the Enter step and leaves the profile locked. The sessions live in `workspace/data/browser/linkedin` and `workspace/data/browser/dice`.

**Checkpoint:** `npm run jobs -- whoami` and `npm run dice -- whoami` report signed in. Each costs one page load against the day's caps.

## 9. bikeshed sign-in

The dashboard, the CV renders and the review documents live in private bikeshed documents. Sign in through the project's wrapper:

```sh
npm run bikeshed -- login
```

The browser opens for the sign-in (`--paste` takes a token instead). The wrapper (`scripts/tool.mjs`) runs the pinned CLI from `node_modules/.bin` with `XDG_CONFIG_HOME` set to `workspace/.secrets/xdg`, so the credentials land in the workspace, where every script looks.

**Never a global install or a bare `npx`/`npm exec`.** Those store the token in the home folder's config directory, which the scripts never read, and a global CLI may not be the pinned version. A token in `workspace/.secrets/.env` (`BIKESHED_TOKEN=...`) works too.

The access phase of `/hunt-onboard` then creates a private folder, its `Reviews` and `Letters` subfolders and the tracker document, and records their ids in `workspace/config/tracker.json` (`bikeshed.folder_id`, `reviews_folder_id`, `letters_folder_id`, `doc_id`).

**Checkpoint:** `npm run bikeshed -- folders --json` lists the folder, and `npm run tracker -- --publish` exits 0.

To run without bikeshed, set `"publisher": "local"` in `workspace/config/tracker.json`: the dashboard is written to `workspace/data/tracker/tracker.html`, with no comments and no review documents.

## 10. Mail adapter

`workspace/config/mail.json` `adapter`, plus `me` (the one mailbox the scan reads). Details: `docs/adapters.md`.

### `gws`: the bundled Google Workspace CLI

1. In the Google Cloud Console, in a project of the operator's: enable the Gmail API, configure the OAuth consent screen, and create an OAuth client of type Desktop app.
2. Save its JSON as `workspace/.secrets/gws/client_secret.json`, or put `GOOGLE_WORKSPACE_CLI_CLIENT_ID=...` and `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET=...` in `workspace/.secrets/.env`.
3. Sign in with the read-only Gmail scope only:

   ```sh
   npm run gws -- auth login --scopes https://www.googleapis.com/auth/gmail.readonly
   ```

The wrapper gives the CLI its config dir (`workspace/.secrets/gws`, file keyring) and an in-folder home (`workspace/.secrets/gws-home`), and strips host credential variables. Host gcloud or application-default credentials are never picked up. Sign in through `npm run gws` only.

**Checkpoint:** `npm run gws -- auth status` shows the client config and credentials present, and `npm run mail -- pending --dry-run` exits 0.

### `bridge`: the harness's mail connector

For a harness with a Gmail (or other mail) connector. Scripts never fetch: they write request files and the agent fulfils them with the connector's read tools.

1. List the connector's tools in the harness.
2. Deny every tool that is not a read (send, draft, label, archive, delete, modify):

   ```sh
   npm run onboard -- mail-guard --deny <tool,tool,...>
   ```

   It writes `permissions.deny` into `.claude/settings.local.json` (gitignored).
3. Set `"adapter": "bridge"` in `workspace/config/mail.json`.

**Checkpoint:** `npm run mail -- pending --dry-run` exits 6 (`needs_fetch`) and names a request file under `workspace/data/mail/requests/`.

### `none`

No inbox scan. Mailed codes at apply time hand the role to the operator.

**Checkpoint:** `npm run doctor` shows `mail adapter: none`.

## 11. Vault

`workspace/config/vault.json` `adapter`.

| Adapter | Setup | Effect |
|---|---|---|
| `none` (default) | Nothing | No ATS account is ever created; account portals go to the operator |
| `op` | Install the 1Password CLI (https://developer.1password.com/docs/cli/get-started/) and sign it in. Set `op.account`, `op.vault` and `op.tag` in `vault.json`, and `accounts.create: true` in `workspace/config/apply.json` | The runner creates ATS accounts with passwords op generates, stored before the sign-up form is sent |

**Checkpoint:** `npm run doctor` shows the vault row ok.

## 12. Ready

```sh
npm run doctor
```

**Checkpoint:** no `FAIL` rows. Then start the loop in the agent with `/loop /hunt-loop` (`docs/workflow.md`). Each channel's first application is a headed dry run the operator checks before `npm run apply -- verify`.

## A second host

1. Clone the repo and run `./bin/bootstrap` (steps 1-5).
2. Bring the workspace: `git clone` the private workspace repository into `workspace/` (made with `npm run onboard -- git-init`), or copy the folder. Elsewhere on disk: point `JOBBA_HOME` at it.
3. Sign in again: browser sessions (`data/browser/`) and `.secrets/` are machine-local and excluded from the workspace repository. Repeat steps 8, 9 and 10 as needed.
4. **One machine runs the loop.** Each host keeps its own limiter log, so two loops would double the traffic on the same accounts against caps meant for one.

**Checkpoint:** `npm run doctor` on the second host shows no `FAIL` rows.

## Linux notes

| Need | Check | Fix |
|---|---|---|
| Chromium shared libraries | `npm run setup` lists any missing library | Debian/Ubuntu: `sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libasound2`. Fedora: `sudo dnf install -y nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXrandr mesa-libgbm pango alsa-lib`. Setup prints the line for what is missing |
| Desktop notifications | `command -v notify-send` | Debian/Ubuntu: `sudo apt-get install -y libnotify-bin`. Fedora: `sudo dnf install -y libnotify`. Without it notifications go to the terminal |
| A display | `DISPLAY` or `WAYLAND_DISPLAY` is set | Run from a desktop session. Logins, headed dry runs and bot checks need a visible window |
