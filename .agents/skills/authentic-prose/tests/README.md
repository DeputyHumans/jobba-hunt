# Regression tests (development-time gates)

These are **dev/maintainer** gates, not runtime behavior. They exist to keep two honest claims true:
the skill *restrains itself on good text*, and it *actually helps bad text* (with "made-worse" allowed
as a result). Run them before release and on every model-version bump; record outcomes in
`references/evidence-ledger.md` (proof-of-life log).

## How to run (manual protocol — no harness required)

For each file, invoke the skill on its contents and record the verdict the audit returns.

### Gate 1 — Restraint (known-good)
Run every file in `known-good/`. Each is genuinely good human writing the skill should **leave alone**.
- **Pass condition:** ≥80% return `already-good — keep original` or only minimal targeted suggestions
  (no full rewrite). The non-native sample must NOT be "corrected" into generic prose — that's the
  failure the 61% detector-false-positive finding warns about.
- **If it fails:** the skill over-edits. Ship in advisory-only mode and say so, or fix the NULL pre-check.

### Gate 2 — Improvement (known-bad)
Run every file in `known-bad/`. Each is genuinely AI-flavored.
- **Measure, don't assume:** for each, judge whether the revision actually reads more authored — ideally
  with (a) the self-audit, (b) a *different-family* model, (c) 2–3 blind human readers. Record the rate at
  which the self-audit's "improved" disagrees with humans, and any `made-worse` outcomes.
- **Pass condition:** majority genuinely improved with no fabricated substance, no semantic drift, and at
  least the self-audit↔human disagreement rate logged. `made-worse` and `no-change` are first-class results,
  not bugs to hide.

### Gate 3 — Proof-of-life
Confirm at least one real `keep-original` (from Gate 1) and one real `made-worse` (a deliberately
over-aggressive run on a good passage) actually fire, and log them in the evidence ledger. A verdict that
never fires is decoration.

## Adding cases
Keep the corpus diverse: registers (email, essay, memo, post), native and **non-native** English, short and
long, and at least a few high-stakes documents (legal/medical/review) to exercise semantic-preservation mode.
Aim to grow `known-good/` to ≥20 and `known-bad/` to ≥20 before treating the gates as meaningful;
percentile bands for `scripts/metrics.py` should be computed from `known-good/`.
