# Audit & verdict (honest scoring)

The original skill scored every variant /40 with the **same model that wrote it**. Research is clear:
self-evaluation carries a documented self-preference bias (~5–7%), position/verbosity biases, and run-to-run
instability; same-model debiasing helps but does **not** reach an independent judge. And no text metric can
prove *human authorship* — that's a fact about provenance, not the page. So scoring here is explicitly
labeled `unvalidated self-audit`, it can return a NULL verdict, and real validation is opt-in and external.

## Default: compact self-audit (visible, but short)

Head it exactly `unvalidated self-audit` and answer briefly:

1. **Provenance intact?** No facts, numbers, experiences, or attributions added that the user didn't supply.
2. **Specificity ↑?** Concrete where it was vague (only from user/source material).
3. **Structure / reader-fit ↑?** Opener, transitions, ending, audience language.
4. **Authored without fabrication?** Voice sharpened; no invented stake/conviction/degree (stake gate honored).
5. **Verdict (mandatory, first-class):** `improved` · `did-not-improve` · `made-worse` · `already-good — keep original`.

Keep it to a couple of lines; it must not dwarf the revision. The verdict is the point — a rubric that can
never say "this didn't work" is decoration. Run the NULL pre-check (SKILL.md step 3) *before* the rewrite
exists, so `keep original` can actually fire instead of being rationalized away after the fact.

## Provenance / authorial-warrant (the dimension that matters most here)

Before anything else, every concrete claim, anecdote, number, opinion, and sentiment-degree must trace to
the user or the source text — not the model. If you can't trace it, you fabricated it: cut it and flag.

## Deep audit (opt-in only — when the user asks, or for calibration)

The eight craft dimensions (each 1–5), scored honestly, *as self-audit not validation*:
Specificity · Voice · Judgment · Usefulness · Rhythm · Trust · Reader-fit · Originality.
Guidance: 1 = generic/anyone; 5 = a specific author's recognizable, defensible work. Don't give the same
number across the board. **Do not present the total as objective or as proof of human authorship**, and
don't gate on it silently — show it if you computed it.

Partial debias for the deep audit (still same model, so still labeled self-audit): evaluate the original and
the revision **unlabeled, in randomized order**, in a fresh frame ("you are a skeptical editor who did not
write this"); swap the order and re-check; if the preference flips, report `tie / below resolution`, not a number.

## Independent model audit (opt-in; the only path toward real validation)

If a *different model family* is reachable, you may run an `independent model audit` — label it exactly that
("independent model audit, not human/provenance validation"). To avoid a self-censorship loophole (a model
capping its own score to dodge the external check), fire it on a **fixed random fraction** of runs when
available, not only when the self-audit says "strong." Genuine validation needs held-out human preference and
true provenance data — out of scope at runtime; see the dev tests below.

## Release gate (development-time, not runtime — see `tests/`)

- **Restraint gate (known-good):** the skill must return `keep original` (or minimal-edit) on ≥80% of a
  held-out set of ≥20 genuinely good human passages — **including non-native-English samples** (detectors and
  over-editors disproportionately harm these). If it can't, ship in advisory-only mode and say so.
- **Improvement gate (known-bad):** on a set of genuinely AI-flavored passages, measure whether triggered
  edits actually help, with `made-worse` and `no-change` as first-class outcomes — ideally rated by a
  different-family model and a few blind human readers. Without this, "it works" is unproven.
- **Proof-of-life:** log ≥1 real `keep-original` and ≑1 real `made-worse` verdict from outside the fixtures in
  `evidence-ledger.md`. A verdict that never fires in the wild is decoration.

## Goodhart guard

If `scripts/metrics.py` is used, its numbers are a *diagnostic vector*, never a target and never a gate.
Quality is an inverted-U: pushing sentence-length variance, lexical diversity, or concreteness past the
moderate human band makes prose worse and more synthetic. The "moderate band" is defined as percentiles of the
known-good corpus, not asserted from memory. Never optimize toward a metric.
