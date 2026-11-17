# AGENTS.md

Entry point for any coding agent (Codex, OpenCode, Cursor, Pi, Antigravity, Claude Code and others).

1. **Rules.** `CLAUDE.md` holds the operating rules for every agent, whatever the harness: platform safety, honesty, voice, tailored documents, mail, questions, privacy. Read it before any command.
2. **Skills.** The procedures are in `.agents/skills/<name>/SKILL.md`. A harness that loads skills from `.agents/skills/` finds them there; Claude Code finds them through the `.claude/skills/` symlinks. If your harness does not load skills, read the SKILL.md file for the task and follow it.
3. **Commands.** Every step is an npm script with a JSON last line and documented exit codes. Run from the repo root.

## Skill to command map

| Skill | Commands it runs | Harness features it needs |
|---|---|---|
| `hunt-onboard` | `npm run setup`, `npm run doctor`, `npm run onboard -- init / status / mark / ingest / validate / git-init / mail-guard`, `npm run jobs -- login`, `npm run dice -- login`, `npm run cv -- --all`, `npm run cv-publish`, `npm run tracker -- --publish`, `npm run probe` | asks the operator questions (any chat works) |
| `hunt-loop` | `npm run tick`, `npm run dice-tick`, `npm run triage -- auto / decide / approve / approve-docs / hold`, `npm run tailor -- <step> --job <id>`, `npm run cover`, `npm run apply`, `npm run mail -- pending / record / close`, `npm run tracker -- --publish`, `npm run watch` | **Claude Code**: ScheduleWakeup (self-scheduling), PushNotification, Monitor (comment watch). Elsewhere: run one firing by hand or from your own scheduler |
| `hunt-triage` | `npm run triage -- pending / record / list`, `node scripts/check-calibration.mjs` | none |
| `hunt-tailor` | `npm run tailor -- prepare / freeze / measure / build / review / status --job <id>`, `npm run cover -- --job <id>`, `npm run triage -- approve-docs --id <id>` | none |
| `hunt-kit` | `npm run cv -- --match <id>` | web search and fetch |
| `hunt-status` | `npm run jobs -- limits`, `npm run log` | none |
| `hunt-probe` | `npm run probe -- --file <probe> [--dry-run] [--headed]`, `npm run probe-report -- <files>` | none |
| `hunt-interview` | `npm run brief -- <brief.md>` | web search and fetch |
| `hunt-recruiter` | `npm run cv -- --dir <list>/cv ...`, `npm run cv-publish -- --dir ...`, `npm run recruiter-pages -- --dir <list> --publish` | none |
| `authentic-prose`, `humanizing-prose` | none (`python3 .agents/skills/authentic-prose/scripts/metrics.py` optional) | none |
| `bs-publish`, `bs-comment`, `bs-folder`, `bs-share` | `npm run bikeshed -- <args>` | none |

## Before you change code
- `npm test` runs every test against the synthetic workspace in `tests/fixtures/workspace/`. Keep it green.
- `npm run check:portable` and `npm run check:pii` must pass. Both run in the pre-commit hook.
- Never add personal data, host paths or real employer data to the repo. Tests use the synthetic persona (Jordan Example, Acme Corp and friends).
