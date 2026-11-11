# Onboarding

What `/hunt-onboard` asks and writes, phase by phase, and how it resumes. The skill runs the conversation and writes the content; `npm run onboard -- <command>` creates, checks and tracks the workspace. Paths are workspace-relative unless they start with `scripts/` or `templates/`.

## Commands

| Command | Does | Exit |
|---|---|---|
| `npm run onboard -- init` | Creates the workspace from `templates/workspace/`. Never overwrites an existing file. Creates `data/`, `data/log/`, `.secrets/` | 0 |
| `npm run onboard -- status` | The phases done, with timestamps, and the next one | 0 |
| `npm run onboard -- mark --phase <name>` | Records a finished phase | 0; 2 on an unknown phase |
| `npm run onboard -- ingest --file <path> [--file <path> ...]` | Copies PDF, DOCX, TXT or MD sources into `sources/` and writes their page-tagged text next to them (`<name>.txt`) | 0; 1 on a missing file; 2 usage |
| `npm run onboard -- validate` | Checks every workspace file for shape and consistency (`docs/troubleshooting.md` lists each message) | 0 clean; 1 problems |
| `npm run onboard -- git-init` | Makes the workspace its own private git repository | 0 |
| `npm run onboard -- mail-guard --deny <tool,tool,...>` | Writes `permissions.deny` for a mail connector's non-read tools into `.claude/settings.local.json` | 0; 2 usage |

## Phases

| # | Phase (`mark` name) | What happens | Asks the operator | Writes |
|---|---|---|---|---|
| 0 | Preflight (`preflight`) | `npm run setup`, then `npm run doctor -- --preflight` | Nothing, unless a check fails | Nothing in the workspace |
| 1 | Init (`init`) | `npm run onboard -- init`. Offers `npm run onboard -- git-init` | Whether to keep the workspace in its own private git repository | The workspace skeleton |
| 2 | Ingest (`ingest`) | The operator's CVs, cover letters, profile export and links go to `sources/` (`npm run onboard -- ingest`). Text is read from the `.txt` twins | The documents and links | Draft `collateral/cv/master.json`; candidate claims in the Pending table of `collateral/claim-bank.md`, each sourced `src:<file>#p<n>`; candidate voice samples for `profile/voice.md` |
| 3 | Claims (`claims`) | Candidates shown in batches. Nothing unconfirmed is ever usable | Confirm, edit or reject each claim; anything never to say | `collateral/claim-bank.md` (Claims and Never claim), `collateral/cv/never-claim.json` |
| 4 | Interview (`interview`) | Questions in rounds of at most 4 (topics below) | The topics below | `profile/person.json`, `profile/preferences.json`, `profile/answers.json`, `fit-profile.md`, seeds for `config/prefilter.json`, `profile/decisions.md` |
| 5 | Answers (`answers`) | Q01-Q21 drafted from claims through `authentic-prose` | Confirm each answer | `collateral/screening-answers.md`, `profile/answers.json` `learned` |
| 6 | Calibration (`calibration`) | 5-15 roles with known verdicts; a blind `/hunt-triage calibrate` must pass `scripts/check-calibration.mjs` | The roles and the expected verdict for each | `data/calibration.json` |
| 7 | Access (`access`) | Logins by hand in a real terminal (`npm run jobs -- login`, `npm run dice -- login`, then `whoami`); the mail adapter; `npm run bikeshed -- login`, then the private folder, its `Reviews` and `Letters` subfolders and the tracker document; the vault | Each sign-in; the mail and vault choices | `config/mail.json`, `config/tracker.json`, `config/vault.json`, `config/apply.json` `accounts` |
| 8 | Baseline CVs (`cvs`) | Archetype variants from `master.json`, built with `npm run cv -- --all` and published with `npm run cv-publish`. Then one `/hunt-tailor` rehearsal against a calibration posting | Approve each render (in bikeshed) | `collateral/cv/variants/`, `collateral/cv-map.md`, `config/cv-bikeshed.json`, `data/out/cv/` |
| 9 | Searches (`searches`) | Candidate queries per lane, then `/hunt-probe` for LinkedIn and Dice. `verified: true` comes only from a probe (`npm run probe -- --mark-verified`) | Judgment calls the probe report flags | `config/searches.json`, `config/dice-searches.json`, `config/probes/`, a probe report |
| 10 | Ready (`ready`) | `npm run doctor` with no `FAIL` rows | Nothing | `profile/onboarding.json` complete. Prints `/loop /hunt-loop` and the rule that each channel's first apply is a headed dry run the operator checks |

## Interview topics (phase 4)

| Topic | Lands in |
|---|---|
| Identity and contact; display name and file prefix | `person.json` |
| Work authorization, sponsorship, legal entity, contract types | `answers.json` `facts`, `preferences.engagement.accept` |
| EEO self-identification (each defaults to `decline`) | `answers.json` `eeo` |
| Lanes, titles, seniority, engagement types, domains, buyer, capacity | `preferences.lanes`, `fit-profile.md` |
| Location, home metro, travel, relocation | `preferences.location`, `answers.json` |
| Standing form rates, the IC rate floor, the full-time salary floor and target | `answers.json` `facts.rate_*`, `preferences.money` |
| Exclusions (stacks, title words, companies) | `config/prefilter.json` |
| Schedule and ask window, time zone, reset hour | `preferences.schedule` |
| Platforms (LinkedIn, Dice, which mail adapter, vault) | `config/` |
| Cover-letter approach (`docs/cover-letter-approaches.md`) | `decisions.md` |
| Tailoring: per-job or archetype; review in bikeshed or auto-send | `preferences.tailoring`, `decisions.md` |
| Auto-apply: off, or on with thresholds and channels | `config/apply.json` `auto_apply`, `decisions.md` |

## Fresh-install posture

Every channel unverified; auto-apply off until the operator opts in; tailored-document review on (`bikeshed`); caps conservative (`templates/workspace/config/limits.json`); account creation off without a vault.

## Resuming

`profile/onboarding.json` records a timestamp per finished phase. `npm run onboard -- status` prints `next`, the first phase without one. `/hunt-onboard` reads it and starts there; an interrupted phase runs again from its start, and files written before the interruption are kept (`init` never overwrites). Re-running a finished phase is allowed: ask for it by name. `npm run onboard -- validate` and `npm run doctor` can run at any point.
