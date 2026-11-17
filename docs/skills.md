# Skills

Each skill is a procedure in `.agents/skills/<name>/SKILL.md`: when it applies, the steps, the commands and their exit codes, and what it must never do. Every step a skill takes is an npm script with a JSON last line, so the procedures run in any harness that can read a file and run a command.

## Where skills live

| Location | Role |
|---|---|
| `.agents/skills/<name>/` | Canonical. The only copy that is edited |
| `.claude/skills/<name>` | A committed relative symlink into `.agents/skills/<name>`, so Claude Code finds every skill |
| `npm run skills:link` | Rebuilds the symlinks: keeps correct ones, replaces wrong ones, removes links to skills that are gone, never touches a real directory. `--check` reports only (exit 1 when anything is off). `npm run setup` runs it; `npm run doctor` checks it |

**Other harnesses.** `AGENTS.md` is the harness-neutral entry: it points at `CLAUDE.md` for the rules and maps each skill to its commands. A harness that loads skills from `.agents/skills/` finds them directly. One that loads none reads the SKILL.md for the task and follows it. Three features need Claude Code: the self-scheduling loop (ScheduleWakeup), push notifications, and the Monitor that keeps the comment watch running. Elsewhere, run one loop firing by hand or from the harness's own scheduler, and poll `npm run watch -- --once`.

## Dependency summary

| Dependency | Class | Install |
|---|---|---|
| Node, npm packages, Chromium, bikeshed and gws CLIs, fonts | Bundled | `./bin/bootstrap` (`docs/setup.md`) |
| Signed-in browser profiles | Per workspace | `npm run jobs -- login`, `npm run dice -- login` (by hand) |
| bikeshed sign-in | Per workspace | `npm run bikeshed -- login` |
| Mail adapter | Optional | `docs/adapters.md` |
| 1Password CLI | Optional | https://developer.1password.com/docs/cli/get-started/ |
| Python 3.8+ | Optional | System `python3`, or `uv run` (https://docs.astral.sh/uv/) |
| Web search and fetch | Harness | Built into most harnesses |
| firecrawl, Perplexity | Optional | The harness's MCP settings |

## Hunt skills

### hunt-onboard

| | |
|---|---|
| Purpose | Builds a ready workspace from the operator's CVs, letters and answers, phase by phase, resumable (`docs/onboarding.md`) |
| Triggers | `/hunt-onboard`; "set up the hunt", "onboard me"; any command failing with "No workspace found" |
| Commands | `npm run setup`, `npm run doctor [-- --preflight]`, `npm run onboard -- init / status / mark --phase <p> / ingest --file <f> / validate / git-init / mail-guard --deny <tools>`, `npm run jobs -- login`, `npm run dice -- login`, `npm run bikeshed -- login`, `npm run gws -- auth login`, `npm run cv -- --all`, `npm run cv-publish`, `npm run tracker -- --publish`, `npm run probe` |
| Dependencies | Bundled tools; the operator at the keyboard for logins |

### hunt-loop

| | |
|---|---|
| Purpose | One loop firing: LinkedIn and Dice ticks, triage, tailoring, the auto-apply rule, questions, applies, the inbox scan, the tracker, the next wakeup |
| Triggers | `/loop /hunt-loop`; "run one hunt tick" |
| Commands | `npm run tick`, `npm run dice-tick`, `npm run triage -- auto / decide / approve / approve-docs / applied / confirm`, `npm run tailor -- <step> --job <id>`, `npm run cover -- --job <id>`, `npm run apply -- --job <id>` (and `learn`, `verify`), `npm run mail -- pending / record / close`, `npm run tracker -- --publish`, `npm run watch` |
| Dependencies | Claude Code for self-scheduling, push notifications and the Monitor; bundled tools; signed-in profiles; bikeshed (or publisher `local`) |

### hunt-triage

| | |
|---|---|
| Purpose | Scores every viewed, unscored role against `fit-profile.md`, records it (the script computes the tier), writes the digest. `calibrate` mode checks the rubric blind against `data/calibration.json` |
| Triggers | After a tick or sweep; "review new roles", "score jobs", "show the digest"; `/hunt-triage calibrate` after any rubric change |
| Commands | `npm run triage -- pending / record --file <f> / list / decide`, `node scripts/check-calibration.mjs --file <results>` |
| Dependencies | None beyond the workspace. Subagents for batches above 10 roles, when the harness has them |

### hunt-tailor

| | |
|---|---|
| Purpose | A CV and letter for one job from the claim bank, measured against the posting's frozen terms, built with every check, routed to review (`docs/tailoring.md`) |
| Triggers | Called by `/hunt-loop`, inbox outreach replies and `/hunt-recruiter`; "tailor a CV for job <id>" |
| Commands | `npm run tailor -- prepare / freeze / measure / build / review / status --job <id>`, `npm run cover -- --job <id>`, `npm run triage -- approve-docs --id <id>` |
| Dependencies | Bundled tools; `authentic-prose`; bikeshed for review mode `bikeshed` |

### hunt-kit

| | |
|---|---|
| Purpose | Company research with sources, a fit matrix with honest odds, the CV pick, an intro note, a claim-source table and a submission checklist, all in the opportunity file. It never applies or sends |
| Triggers | A role the operator decided to pursue; "prepare an application", "write an intro note" for a job |
| Commands | `npm run cv -- --match <job_id>` |
| Dependencies | The harness's web search and fetch. firecrawl or Perplexity are used only when the harness has them |

### hunt-status

| | |
|---|---|
| Purpose | The board by stage from `pipeline/opportunities/`, due actions, three metrics, stage updates, and the proposal handoff to `pipeline/proposals/<client>/` |
| Triggers | "where does the hunt stand", "what is due"; a reported reply, screening call, NDA, proposal, win or loss |
| Commands | `npm run triage -- list`, `npm run jobs -- limits`, `npm run log` |
| Dependencies | None |

### hunt-probe

| | |
|---|---|
| Purpose | Tests candidate queries against decision rules written before the data, writes the dated report, and changes the query set only through it (`docs/query-probe-method.md`) |
| Triggers | Onboarding phase 9; a query-set change; a scope change; a query with 0 survivors for 2 weeks; canary failures |
| Commands | `npm run probe -- --file <probe> [--dry-run] [--headed]`, `npm run probe-report -- <files>`, `npm run probe -- --mark-verified <result> [--report <path>]`, `node scripts/replay-capture.mjs` |
| Dependencies | A signed-in browser profile; probe page loads count against the day's caps |

### hunt-interview

| | |
|---|---|
| Purpose | A brief before a call and a debrief after it, from `templates/interview-brief.md` and `templates/interview-debrief.md`: facts with URLs, claims only |
| Triggers | A scheduled screen or interview; "prep me for the call with <company>"; notes from a finished call |
| Commands | `npm run brief -- <brief.md> [--glossary <json>] [--write-claims]` renders the brief as the designed HTML page next to it |
| Dependencies | The harness's web search and fetch |

### hunt-recruiter

| | |
|---|---|
| Purpose | A recruiter's curated role list: one tailored CV per role in the list's own folder, and an index and analysis page with no recruiter name or process text. Never a direct apply |
| Triggers | A list of roles a recruiter sent |
| Commands | `npm run cv -- --dir pipeline/recruiter/<list>/cv --all`, `npm run cv -- --match <jd.txt> --terms <terms> --dir <list>/cv --candidate <slug>`, `npm run cv-publish -- --dir pipeline/recruiter/<list>/cv`, `npm run recruiter-pages -- --dir pipeline/recruiter/<list> --publish` |
| Dependencies | bikeshed (publisher `local` writes the pages only) |

## Writing skills (vendored)

### authentic-prose

| | |
|---|---|
| Purpose | Revises a draft so it reads as the operator wrote it, matched to `profile/voice.md`, without adding facts. Returns the revision and a short self-audit |
| Triggers | Every outbound sentence: intro notes, letter paragraphs, CV summaries and highlights, screening answers, mail drafts |
| Commands | None. Optional: `python3 .agents/skills/authentic-prose/scripts/metrics.py <file>` (a diagnostic vector; `--before old.txt --after new.txt` for deltas) |
| Dependencies | None. The metrics script needs Python 3.8+ (stdlib only): system `python3`, or `uv run` |

### humanizing-prose

| | |
|---|---|
| Purpose | Diagnoses an AI fingerprint in a draft, asks targeted questions to fill substance gaps, and returns voice variants with rubric scores. Refuses to fabricate experience |
| Triggers | A draft that still reads machine-made after `authentic-prose`; the operator asks for it |
| Commands | None |
| Dependencies | None |

## bikeshed skills (vendored, Apache-2.0)

They describe the bikeshed CLI as `bikeshed <cmd>`. In this repo that is always `npm run bikeshed -- <cmd>`: the wrapper keeps the credentials in `workspace/.secrets`. Install notes in them that mention a global install or `npx` do not apply here.

| Skill | Purpose | Commands |
|---|---|---|
| `bs-publish` | Publishing and revising documents: Markdown, HTML, bundles, folders, versions, guarded writes | `npm run bikeshed -- publish / update / get / versions` |
| `bs-comment` | Reading anchored comments, revising the passage, replying and resolving | `npm run bikeshed -- comments / reply / resolve / comment` |
| `bs-folder` | Where a document goes; listing, creating and filing into folders | `npm run bikeshed -- folders / mkdir / mv` |
| `bs-share` | Who can read, suggest, edit or approve; visibility and expiry | `npm run bikeshed -- access / visibility` |

Dependencies: the bundled bikeshed CLI and a sign-in (`npm run bikeshed -- login`). Hunt documents stay private, in the hunt folder, never the root.
