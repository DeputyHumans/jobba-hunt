# Adapters

The three pluggable edges of the system: mail, publisher and notifications. Each is picked in workspace config, has one contract in `scripts/lib/adapters/` (notifications in `scripts/lib/notify.mjs`), and runs with its credentials inside the project folder. Paths: repo-relative (`scripts/...`) or workspace-relative (`config/`, `data/`, `.secrets/`).

## In-folder isolation

Every entrypoint that starts a browser or one of the project's CLIs (bikeshed, gws) imports `scripts/lib/env.mjs` before it starts one: directly, or through `scripts/cloak-core.mjs`, `scripts/rate-limiter.mjs`, `scripts/lib/state.mjs` or an adapter. `check:pii`, `check:portable`, `npm test` and `skills:link` start neither and do not import it. An explicit environment variable always wins over its defaults.

| What | Where | How |
|---|---|---|
| CloakBrowser binary | `.cache/cloakbrowser` (repo) | `CLOAKBROWSER_CACHE_DIR` default |
| Browser profiles | `data/browser/<platform>` | `CLOAK_PROFILE_DIR` default |
| Secrets file | `.secrets/.env` | `KEY=VALUE` lines loaded once, never overriding the shell |
| bikeshed CLI | `.secrets/xdg` | `childEnv('bikeshed')` sets `XDG_CONFIG_HOME` for the child process only, unless `BIKESHED_TOKEN` is set |
| gws CLI | `.secrets/gws` and `.secrets/gws-home` | `childEnv('gws')` sets `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`, the file keyring, and an in-folder `HOME`, `XDG_CONFIG_HOME` and `CLOUDSDK_CONFIG`. It deletes `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_WORKSPACE_CLI_TOKEN`, `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` and the host `CLOUDSDK_CONFIG`, so host gcloud or application-default credentials are never picked up |

The operator signs in through the same environment: `npm run bikeshed -- <args>` and `npm run gws -- <args>` (`scripts/tool.mjs`). A global install or a bare `npx` would keep credentials in the home folder, where no script looks.

## Mail (`config/mail.json` `adapter`)

Read-only, whatever the adapter (`AGENTS.md` "Mail (any adapter)"). Used by the inbox scan (`npm run mail`, `docs/inbox-scan-design.md`) and by the apply runner's code waits.

| Adapter | Reads through | Credentials |
|---|---|---|
| `gws` | The bundled Google Workspace CLI: `JOBBA_GWS_BIN`, else `gws.bin` in `config/mail.json`, else `node_modules/.bin/gws`. `list` and `get` only | `.secrets/gws` (`npm run gws -- auth login --scopes https://www.googleapis.com/auth/gmail.readonly`) |
| `bridge` | The agent, with the harness mail connector's read tools, through request and response files. Claude's Gmail connector: headers from `search_threads`, bodies from `get_message`, threads from `get_thread` | The connector's own; every other tool denied by `npm run onboard -- mail-guard --connector gmail` (`--deny <tools>` for another connector) |
| `none` | Nothing | None |

**Contract** (`scripts/lib/adapters/mail.mjs`): `openMail({ cfg })` returns `{ kind, list(q, {max}), headers(id), body(id), thread(threadId), fetchRecent(opts) }`.
- `fetchRecent({ query, after, max = 5, purpose, job_id, wait_seconds })` resolves `[{ id, threadId, from, fromAddr, subject, date, text }]`, newest first, or `[]`. A bridge timeout returns `[]` with `timedOut: true`.
- `gws`: any verb other than `list` and `get` throws `MailWriteRefused` before a process starts. Sign-in failures throw `MailAuthError` (the scan exits 2).
- `bridge`: `list`, `headers`, `body` and `thread` throw `MailNeedsFetch`: scripts never fetch.
- `none`: every read returns empty at once.

### The bridge handshake (inbox scan)

Headers first stays in code: the script decides what to open, the agent only fetches what it is asked for. Every call exits 6 `needs_fetch` until there is nothing left to fetch; the output names the request file, the response file and the `next` command.

| # | Command | Request (`data/mail/requests/<id>.json`) | The agent writes (`data/mail/responses/<id>.json`) |
|---|---|---|---|
| 1 | `npm run mail -- pending` | `kind: "headers"`: the query, the time to list after, a maximum | `{ "id", "messages": [{ "id", "threadId", "from", "to", "subject", "date", "labels" }] }`, headers only, newest first, never a body |
| 2 | `npm run mail -- pending --headers <response file>` | The script computes signals and `never_open` from the headers alone. With no signal it finishes here (exit 0). Otherwise `kind: "bodies"`: the signal message ids, and the threads to check for sent replies | `{ "id", "bodies": { "<message id>": "<plain text>" }, "threads": { "<thread id>": [{ "id", "from", "date", "labels", "text" }] } }` |
| 3 | `npm run mail -- pending --bodies <response file>` | None | The usual pending file, `data/mail/pending-<stamp>.json`; exit 0 |

Request and response files are deleted once read, because they hold mail text.

### Code waits (apply runner)

A mailed security code, a sign-in code or an account verification link: `fetchRecent` with the sender's query and the time of the request.
- The runner waits up to `config/apply.json` `code_wait_seconds` (default 180) in all.
- `gws`: list then get, polled until that deadline.
- `bridge`: one `kind: "fetch"` request with an `expires_at` and instructions; the agent answers `{ "id", "messages": [{ "id", "threadId", "from", "subject", "date", "text" }] }`, or `[]` when nothing matches. Run the apply in the background so the agent can answer while it waits. (`bridge.wait_seconds` is the default for a fetch that names no wait.)
- `none`, or a timeout: the role is handed to the operator (apply exit 5). Never a guess.

### Config keys

| Key | Meaning |
|---|---|
| `adapter` | `gws`, `bridge` or `none` |
| `me` | The one mailbox read; the sender of the operator's own replies |
| `gws.bin` | CLI override (`JOBBA_GWS_BIN` wins) |
| `bridge.wait_seconds`, `bridge.max_list` | Default wait for a fetch request that names none (180); most headers listed per request |
| `query`, `max_per_run`, `first_scan_after` | What is listed, how many per firing, where the first scan starts |
| `hunt_senders`, `subject_strong`, `subject_words`, `security` | Hunt signals |
| `never_open` (`domains`, `senders`) | Never opened, whatever the signal |
| `noise` (`senders`, `subjects`) | Dropped after the header read |

## Publisher (`config/tracker.json` `publisher`)

| Publisher | Tracker | Review documents | Comments |
|---|---|---|---|
| `bikeshed` (default) | One private document updated in place, in the hunt folder, never the root | Each tailored CV and letter as its own private document in the `Reviews` subfolder | `npm run watch` polls the tracker and every review document |
| `local` | `data/tracker/tracker.html` only; every publish reports `published: false` | None: review happens in the session (`npm run tailor -- review` lists the files) | None |

**Contract** (`scripts/lib/adapters/publish.mjs`): `trackerPublisher({ cfg })` returns `{ kind, cfg, publish({ html, file, st, title }), comments(doc), reply(doc, thread, text), resolve(doc, thread) }`. `cfg` is the flat bikeshed block of `config/tracker.json` (`folder_id`, `doc_id`, `url`, `letters_folder_id`, `reviews_folder_id`). `publish` resolves a status: `created`, `updated`, `unchanged`, `comments`, `auth`, `refused`, `no-folder`, `error`, or `local`.

**bikeshed calls** (`scripts/lib/adapters/bikeshed.mjs`): `bikeshedRun(args)` and `bikeshedRunSync(args)` run the project's CLI with `childEnv('bikeshed')` and return `{ code, stdout, stderr }` (127: CLI missing, run `npm ci`). `isAuthError(r)` tells a signed-out CLI from other failures. Tests inject a fake runner.

**Config keys:** `publisher`; `title` (the tracker's page and document title); `bikeshed.folder_id`, `doc_id`, `url`, `letters_folder_id`, `reviews_folder_id`; `watch.enabled`, `watch.poll_seconds` (30); `silent_days` (5 business days before an application counts as silent); `read_card_days` (5 business days a "Read it on <board>" card stays on Needs you). CV documents: `config/cv-bikeshed.json` (`folder_id`, `docs`). Review documents: `data/tracker/review-docs.json`, one document per job and part (`cv`, `letter`).

**Comment watch** (`npm run watch`): one JSON line per new thread or comment, `{ doc, kind, job_id?, part?, thread_id, section, quote, text, author, at }`. `kind` is `tracker` or `review`; a review event carries its `job_id` and `part` (`cv` or `letter`). An empty thread prints once with `typing: true`. Comments the agent sent through the CLI are never printed. A failed poll prints `{ doc, kind, error: "auth" | "failed", message }` once. Dedupe state: `data/tracker/watch-state.json`. It never replies or resolves: the agent does. `--once` polls once (exit 2 when every document failed on sign-in).

## Notifications (`scripts/lib/notify.mjs`)

| Host | Command |
|---|---|
| macOS | `osascript` (`display notification`) |
| Linux | `notify-send --app-name=jobba-hunt` |
| Anything else, a missing notifier, or `preferences.notify.desktop: "off"` | A `[notify]` line on stderr |

`notify(title, message)` never throws and never blocks. Scripts use it for waits the operator must see (a bot check in a headed run). The loop's push notifications to a phone are a harness feature (Claude Code), not this module.
