# Evidence ledger (maintainer-only — do NOT load during normal editing)

Every empirical claim the skill leans on, with a source, a date, a confidence, and a review trigger.
The point is to make staleness *operational*, not aspirational. A dated header that nobody updates is
worse than none. **Rule:** when a row is past its review-by date, the skill must stop treating that
claim as current — for fingerprint/detector claims that means: do not call any pattern an "AI signal,"
only "reads generic."

Review cadence: detector/fingerprint/LLM-judge/stylometry rows → **≤6 months** (sooner if a major model
or detector ships); craft/quality rows → 12–18 months; legal/FTC → on regulatory change. Re-run the
`tests/` gates on every model-version bump.

| # | Claim (as used in the skill) | Source(s) | Date | Confidence | Review by | If stale |
|---|---|---|---|---|---|---|
| 1 | Surface fingerprints (perplexity, burstiness, em-dash, lexical tells) have collapsed as standalone discriminators for frontier models; some are anti-tells | 2025–26 detection reviews; RAID benchmark notes; GPTZero "hundreds of factors"; ScienceDirect writing-assessment 2026 | 2026-06 | High | 2026-12 | downgrade smells to "reads generic" only |
| 2 | "delve" spiked post-ChatGPT, peaked 2024, declined 2025; public anti-detection advice is changing human/model usage (em-dash avoidance) | ScienceDirect S2666920X2500147X; arXiv 2506.21817; Stanford Daily "The Great Smoothing" 2026 | 2026-06 | Med-High | 2026-12 | mark affected lexical rows aesthetic-only |
| 3 | Detectors moved to LLM-judge / embedding / watermark-provenance / authorship-consistency; text-only detection "systematically defeated"; detector false-positives on human (esp. non-native) writing ~61%+ | rolli.ai 2026; Intl AI Safety Report 2026; Stanford HAI 2023 (non-native FP ~61%, one detector 97%) | 2026-06 | High | 2026-12 | keep the "neither evade nor trust detectors" stance regardless |
| 4 | LLM self-evaluation has self-preference bias (~5–7%), position (~40% order-inconsistency), verbosity (~15%), style-bias 0.76–0.92, run-to-run instability; same-model debiasing < independent judge; independent judges ~80% human agreement | Wataoka & Takahashi (Self-Preference Bias); "Breaking the Mirror" NeurIPS 2025; "Rating Roulette" EMNLP 2025; Deepchecks; Agent-as-Judge survey arXiv 2508.02994 | 2026-06 | High | 2026-12 | keep "unvalidated self-audit" labeling; do not claim validation |
| 5 | The predecessor skill's "up to 23.5× style-matching from samples vs adjective prompts" is untraceable; few-shot samples beat adjective prompts but gains are in percentage points | Searches over TinyStyler, Prompt-and-Rerank, style-transfer/personalization lit; IBM/Google/Prompting-Guide few-shot guidance | 2026-06 | High | 2027-06 | keep the directional claim only; never cite a multiplier |
| 6 | Validated lightweight quality signals (syntactic variety/Coh-Metrix, MATTR/MTLD not raw TTR, QA-completeness, concreteness) correlate with human quality but only as a vector; all Goodhart-prone; quality is an inverted-U | Crossley & McNamara; 2021 syntactic-complexity study; 2025 lexical-diversity reviews; PROPOR 2026 QA metrics | 2026-06 | Med-High | 2027-06 | keep "diagnostic vector, never a target" |
| 7 | Over-editing burstiness/diversity makes prose worse & more AI-like; heavy editing of already-good human text moves it toward the LLM center | 2024 AI-vs-human stylometry; editor/proofreading analyses (papercheck, youraicopyeditor) 2025–26 | 2026-06 | Med-High | 2027-06 | keep minimal-edit bias + NULL verdict |
| 8 | Runtime code execution works in Claude Code but is NOT portable (claude.ai/API/locked-down may disallow); ship a non-code fallback | Anthropic Agent Skills article; Sonnet 4.6 GA notes; Datadog skills-security writeup | 2026-06 | High | 2027-06 | keep metrics optional; no numbers if no code |
| 9 | Anthropic Skills = 3-level progressive disclosure; SKILL.md soft budget <5k tokens; description needs what+when+trigger+negative triggers | platform.claude.com best-practices; resources.anthropic.com guide; agentskills.io spec | 2026-06 | High | 2027-06 | re-check budget/format on spec updates |
| 10 | FTC reviews/testimonials rule (eff. Oct 2024) + §5 "means-and-instrumentalities / knew-or-should-have-known" can reach tool providers; refusing fabrication + not marketing rating-boosts + preserving genuine opinion = low exposure; manufacturing enthusiasm/degree is the grey zone | ftc.gov press release & 16 CFR Part 465; Goodwin, Sidley, Alston, Kingspry analyses 2024–26 | 2026-06 | High | on FTC change | keep stake gate + hard refuses |

## Proof-of-life log (the audit must demonstrably fire, not just exist)

Record real runtime verdicts here so the NULL/made-worse verdicts are shown to be alive, not decoration:

- _[date] keep-original fired on: <short description of a genuinely good human passage left unchanged>_
- _[date] made-worse fired on: <description of a revision the audit caught regressing the original>_

(Seed these from the `tests/` runs, then add real cases as they occur.)
