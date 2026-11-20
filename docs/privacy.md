# Privacy

What counts as personal data in a hunt, where it lives, what may leave the machine, and the guards that keep the repository clean. The rules are in `AGENTS.md` "Data and privacy" and "Mail (any adapter)"; this file is the mechanism.

## What is personal, and where it lives

Everything personal lives in the workspace: `workspace/` in the repo, gitignored, or the folder `JOBBA_HOME` names. The repository itself holds no personal data: code, templates, synthetic test fixtures and docs only.

| Data | Workspace path |
|---|---|
| Identity, contact, links | `profile/person.json` |
| Form answers: phone, address, work authorization, standing rates, EEO | `profile/answers.json` |
| Floors, schedule, scope | `profile/preferences.json` |
| Voice samples, standing decisions, extra privacy terms | `profile/voice.md`, `profile/decisions.md`, `profile/pii-extra.txt` |
| Original CVs, letters, profile exports | `sources/` |
| Claims, CV model, variants, answers, kits | `collateral/`, `docs/kits/`, `fit-profile.md` |
| Opportunities, mail threads, interview briefs, recruiter lists, proposals | `pipeline/` |
| Mailbox address, never-open domains, tracker doc ids, vault account | `config/` |
| Browser sessions, captures, application screenshots and filled-field records, mail exports, state, logs | `data/` |
| Sign-ins: bikeshed (`xdg/`), gws (`gws/`, `gws-home/`), `.env` | `.secrets/` |

Each apply run folder (`data/applications/<id>/<stamp>-dry-run` or `-submit`) holds full-page screenshots of the filled form and one `step<N>-fields-filled.json` per form step. That file keeps names, email addresses and screening answers as typed. Only fields labelled phone, mobile, birth date, street or address line are masked.

`.cache/` in the repo holds downloaded binaries only, nothing personal.

## Credentials stay in the folder

| Tool | Where its credentials live | Why it cannot use the host's |
|---|---|---|
| bikeshed CLI | `.secrets/xdg/` (or `BIKESHED_TOKEN` in `.secrets/.env`) | Every call runs the pinned CLI from `node_modules/.bin` with `XDG_CONFIG_HOME` pointed into the workspace (`scripts/lib/env.mjs` `childEnv`) |
| gws CLI | `.secrets/gws/` (OAuth client and tokens, file keyring) | Every call gets an in-folder `HOME`, `XDG_CONFIG_HOME` and `CLOUDSDK_CONFIG` under `.secrets/gws-home/`, and the host credential variables (`GOOGLE_APPLICATION_CREDENTIALS` and the CLI's own token variables) are removed. Host gcloud or application-default credentials are never read |
| Browser sessions | `data/browser/<platform>/` | CloakBrowser profiles inside the workspace; the binary in the repo's `.cache/` |
| 1Password | The operator's own vault | Read and written only through `op`, with the account, vault and tag in `config/vault.json` |

Sign in only through the wrappers: `npm run bikeshed -- login` and `npm run gws -- auth login --scopes https://www.googleapis.com/auth/gmail.readonly` (`scripts/tool.mjs`). A global install or a bare `npx`/`npm exec` would store the credentials in the home folder, outside the workspace, where no script looks, and would share them with every other tool on the host. Steps: `docs/setup.md` "bikeshed sign-in" and "Mail adapter".

## What never leaves the workspace

- No workspace file is committed to the repository, copied into `tests/fixtures/`, or pasted into an issue, a pull request or a request to an outside service.
- Passwords exist only in the vault (`config/vault.json`, adapter `op`). Never on argv, in `data/`, in logs or in screenshots.
- The action log (`data/log/actions.jsonl`) holds short values only: never bodies, answers, addresses or passwords.
- EEO answers default to `decline` and change only on the operator's explicit word (`profile/decisions.md`).
- The floors in `preferences.money` never appear on the tracker.
- Company research sends search tools only public names (company, role), never the operator's data.
- Material under NDA stays outside the workspace too. An opportunity file links to it and never copies it.

## What does leave, and where to

| Channel | What | Rule |
|---|---|---|
| Applications | The approved CV, letter and form answers | Only through the apply runner, only to a verified channel, only after an approval (`AGENTS.md` "Platform safety") |
| bikeshed | Tracker, CV renders, review documents, sent letters, interview briefs, recruiter pages | Private documents in the hunt folder, never the root. The tracker, CV renders and recruiter pages pass their guards first (below) |
| Mail adapter | Read requests to the operator's own mailbox | Read-only ("Mail rules" below) |
| Job boards | Searches and job views | Read-only, paced, capped |

## Guards

| Guard | Runs | Catches |
|---|---|---|
| `npm run check:pii` | `.githooks/pre-commit` on staged files only (`--staged`; `npm run setup` sets `core.hooksPath`), and on demand over every file git tracks or does not ignore | Terms from the active workspace ("check:pii terms" below) in any non-binary file outside `workspace/`. Exit 1 on a hit |
| `npm run check:pii -- --history` | On demand, and before the repository is pushed anywhere public | The same terms in every non-binary blob any ref ever held (deleted files and committed `workspace/` files included) and in every commit message. A hit means the history needs a rewrite before it is published |
| `npm run check:portable` | `npm test` (`tests/check-portable.test.mjs`) and the pre-commit hook | Host-only paths in tracked files (absolute home-directory paths on macOS, Linux or Windows, the tilde shorthand, a home-directory lookup outside the path layer), any parent-directory reference that resolves outside the repo, any symlink that leaves it or dangles |
| Tracker privacy guard | Every `npm run tracker`, before publishing | Any email address except the application email; the phone in `profile/person.json` or in the answer bank; the standing annual rate; the street address. A hit publishes nothing and exits 1. A company field that holds an email address renders as its domain only, so a recruiter's address never reaches the page |
| CV publish guard | Every `npm run cv-publish` | Any email address except the application email, and any phone number except the one the CV shows. A hit skips that CV and exits 1 |
| CV and letter lint | Every build | The never-claim patterns, a phone number by default. A CV that shows the phone (`profile/person.json` `show_phone_on_cv`, or a variant's `contact.phone: "profile"`) exempts that one number, in the lint and in `npm run cv-publish`; any other number still fails |
| Recruiter pages | `npm run recruiter-pages` | Anyone named in `never_show`, any email address except the application email, any phone number, any script on a page. A hit writes nothing and exits 1 |
| Captures | By hand before reuse | `data/captures/` shows the signed-in page. Before a capture becomes a fixture: strip the nav, the operator's name and photo, `trackingId` and `refId` values, and every other job's text; replace employers and ids with synthetic ones |

### check:pii terms

`scripts/check-pii.mjs` builds its terms from the active workspace:

| Source | Terms |
|---|---|
| `profile/person.json` | `name`, `display_name`, `email`, `application_email`, `phone`, the LinkedIn and website links |
| `profile/answers.json` | `profile`: `full_name`, `last_name`, `email`, `phone`, `street_address`, `address_full`, `linkedin`, `website`; `facts.contracting_entity` |
| `collateral/cv/master.json` | Each role's company and client names, each employer name, each link name |
| `profile/pii-extra.txt` | One term per line; lines starting with `#` are skipped |
| `profile/pii-allow.txt` | Not a source: one term per line that the operator made public on purpose, such as the organization that publishes the repository. Each drops only the term equal to it, ignoring case. A wider term that contains it, such as an email address at that organization, stays a term. Only the operator adds a line, with a `profile/decisions.md` row |

- A term shorter than 4 characters is skipped (7 for a phone, 3 for `pii-extra.txt`).
- A template placeholder such as `<employer>` is skipped, so a workspace not yet onboarded raises nothing.
- A phone number also matches on its last 7 digits, with the punctuation removed.
- A synthetic workspace (one inside `tests/`, or one holding a `.synthetic` file, like the test runner's copy) is never a source of terms. With no workspace, the check passes.

## Mail rules

The rules are in `AGENTS.md` "Mail (any adapter)". How the code holds them:

- **Read-only, one mailbox** (`config/mail.json` `me`). A write verb is refused in code before any process starts (`docs/adapters.md` "Mail"). The operator sends every reply.
- **Headers first.** The script decides from the headers alone which bodies to open. `never_open` beats every signal.
- **No links.** The one exception: the sign-up verification link of an ATS account the runner just created, on that ATS's own host, within minutes of sign-up.
- **Codes.** An apply-time code is read only from the newest matching mail since the request.
- **Drafts** carry claims only, `[RATE]` for any rate and `[TIMES]` for call times.
- **Storage.** Raw bodies stay under `data/mail/`. Bridge request and response files are deleted once read. `pipeline/mail/` holds summaries, drafts and the operator's own sent text.

Full design: `docs/inbox-scan-design.md`.

## Backing up a workspace

`npm run onboard -- git-init` makes the workspace its own git repository. Its `.gitignore` comes from `templates/workspace/.gitignore` and leaves out:

- browser profiles (`data/browser/`);
- raw run snapshots and captures (`data/raw/`, `data/captures/`);
- dry-run folders (`data/applications/*/*-dry-run/`);
- `.secrets/`;
- `sources/`, only when that line is uncommented.

Everything else in `data/` goes into that repository: the job state, the limiter log, the action log, submit run folders with their screenshots and `step<N>-fields-filled.json`, mail exports and rendered CVs. Keep that repository and any remote it has private.

On a second host: clone the code, run `./bin/bootstrap`, then clone or copy the private workspace and point `JOBBA_HOME` at it if it lives elsewhere. Sign in again (`docs/setup.md` "A second host").
