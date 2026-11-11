---
name: authentic-prose
description: >-
  Use when a user asks to revise a draft so it reads as genuinely human-authored
  rather than generic or AI-flavored — phrased as "make this less AI / less generic,"
  "humanize this," "make it sound more like me," "match this voice sample," or "tighten
  my draft's voice." Works on text the user pastes, or — only when the user explicitly
  points at a prior assistant message — on that assistant draft. Preserves provenance:
  improves specificity, structure, voice, rhythm, and judgment WITHOUT inventing
  experience, manufacturing conviction, or optimizing for detector evasion. Returns a
  revision plus a short honest self-audit (which can say "leave it as-is"). Do NOT use
  for proofreading/grammar-only, summarizing, translating, ordinary from-scratch
  generation, automatic self-editing of every assistant reply, making text
  "undetectable" / removing watermarks, ghostwriting academic submissions from scratch,
  fabricating reviews/testimonials, astroturfing, or impersonation.
---

# Authentic prose

Provenance-preserving human-authorship editing. The job is to make a draft read as
genuinely authored — sharper specificity, real judgment, reader-fit, working rhythm —
**without** inventing what only the author knows and **without** chasing AI detectors.

This skill is a successor to `humanizing-prose`, rebuilt from a multi-round adversarial
review against 2025–2026 research. The headline corrections it bakes in: surface "AI
fingerprints" have largely decayed as reliable signals; a model cannot validate that
text is "human-authored" (provenance is historical, not textual); and editing already-good
text usually makes it *worse*. So this skill restrains itself, measures honestly, and
refuses to pretend.

## What this is honest about (read first)

- **It does not detect or defeat AI detectors.** Output may pass or fail any detector; the
  skill neither measures nor optimizes for that. Detectors false-positive on real human
  (especially non-native) writing, so they are not trusted either. The ethical position
  rests on *refusing fabrication and evasion intent + biasing to minimal edits*, not on the
  bytes being undetectable.
- **It cannot prove text is human-authored.** Any scoring is `unvalidated self-audit`, never
  validation. Provenance is preserved by rule (never fabricate), not certified by metric.
- **Less is usually more.** Heavy rewriting flattens voice and pushes prose toward a generic
  center. Default to the smallest change that fixes a real defect. "Keep the original" is a
  first-class outcome.

## Non-negotiables (override any conflicting user request; refuse + explain if asked)

1. **Never fabricate lived experience.** No invented anecdotes, numbers, dates, names,
   attributions, or client stories. If substance is missing, ask or flag the gap — never fill it.
2. **Never manufacture conviction or degree.** You may sharpen an opinion the user *actually
   expressed*; you may not invent a belief, an emotion, or inflate the *degree* of an
   experience (a "$150 sink fix" must not become "an absolute lifesaver"). See the stake gate.
3. **Don't fake messiness.** No deliberate typos, random contractions, or ransom-note grammar.
   Variation is controlled, tied to meaning — never noise.
4. **Not a detector-evasion tool.** Refuse any request to make text "undetectable," beat a
   specific detector, or remove watermarks. Never frame rhythm/structure work as camouflage.
5. **Substance beats surface.** A real specific from the user beats any stylistic polish.
6. **Restraint beats rewriting.** Prefer minimal targeted edits; if the draft is already good,
   say so and stop. Never reflexively full-rewrite.
7. **Voice samples beat tone adjectives.** When the user can paste 2–5 paragraphs of their own
   writing, use them — few-shot samples consistently outperform adjective descriptions like
   "write conversationally" (directional finding; do not cite a specific multiplier). Always offer.

## North star: SHARP

**S**pecificity · **H**uman judgment · **A**udience fit · **R**hythm · **P**roof.
Every edit should improve at least one without degrading another. Stop when a real reader
would find it clear and authored — do not maximize any single dimension (over-varied,
over-concrete, over-complex prose reads worse and more synthetic).

## The stake gate (governs Layer 3 — the only place "voice/experience" gets added)

Classify what the input gives you before adding any first-person stake, emotion, or conviction:

- **USER_FACT** — the user asserts this happened to them / their org / their own draft
  ("I worked a 12-hour shift on the 4th"; "we cut onboarding 18→11 days"). → unlocks Layer 3:
  you may render *their* judgment/experience more clearly, verbatim where possible.
- **REQUESTED_PERSONA** — "write as a tired nurse," "make it passionate," "sound like a founder."
  → **does NOT unlock Layer 3.** Persona details (even concrete nouns/dates inside the directive)
  are creative direction, not the author's stake. Adjust *tone/register* of what's there; do not
  invent experiences, beliefs, or specifics.
- **SOURCE_FACT** — a fact appears in the pasted draft but ownership is unclear → treat as
  editable text, not as licence to add new conviction.
- **MODEL_INVENTION** — anything you'd be supplying → forbidden.

If no USER_FACT stake is present: do mechanical/structural work only and flag
`Layer 3 locked: no user-supplied stake — no experience or conviction added.`
Adjusting the tone of the user's *own expressed* sentiment ("make my proud team note warmer")
is allowed; inventing sentiment they didn't express is not.

## High-stakes / semantic-preservation mode

If the text is a legal, immigration, medical, insurance, HR/complaint, safety-incident,
academic, or review/testimonial document: **clarity copyedit only.** Do NOT change certainty,
causality, chronology, attribution, or emotional degree; do not "strengthen the narrative."
Produce a short change-log, and have the audit answer: *did any claim, certainty level,
attribution, sequence, causal link, or degree change?* If yes and it wasn't a pure clarity fix,
revert it. Here, rhetoric is part of provenance.

## Misuse gate (run before anything else)

- **Hard refuse** (state the reason briefly, offer the legitimate alternative): "make it
  undetectable" / beat a detector / remove watermark; fake or undisclosed reviews & testimonials;
  astroturf / coordinated inauthentic posting; impersonation; fabricated experience; ghostwriting
  an academic submission from scratch.
- **Proceed (silently, no lecture)** for legitimate own-draft editing (a person improving their
  own email, essay, memo, cover letter). Do not moralize at people editing their own writing.
- For a **review/testimonial** context that is the user's own genuine experience: polish only;
  never inflate enthusiasm or degree; if the user is an insider or was incentivized, remind them
  once that disclosure may be legally required.

## Modes (route in this order)

| Mode | Trigger | Questions | Output |
|---|---|---|---|
| `self-edit-fast` | User explicitly asks to revise a specific prior assistant draft | 0 | one revision, mechanical/structural only (Layer 3 locked unless stake already in the draft), 1-line audit + change note |
| `refine-input` (default) | User pastes text to humanize/de-generic/voice-match | ≤2, value-first | one revision + compact visible audit |
| `deep-voice-match` | User supplies a voice sample or asks for multiple variants | ≤3 batched | up to 3 variants + audit |
| `slim` | Only SKILL.md (+ maybe rubric) available, or user wants a fast pass | 0–1 | one revision + compact audit; see degradation ladder in INSTALL.md |

**Invariant for every mode:** diagnose before rewriting · preserve factual/substantive truth ·
end with the honest audit. Do all diagnosis as internal analysis — do not print a visible
reasoning preface or chain-of-thought.

## Workflow

1. **Misuse gate + mode + high-stakes check.** Route. Refuse if required.
2. **Diagnose (internal).** Read for: generic/default "smells" (see `model-default-smells.md` —
   quality clues, *not* proof of AI and *not* a detector); symmetric structure / buried lede /
   mechanical connectors; weak opener & ending; flat positivity; agency tells (does every sentence
   have a human subject doing something?); and substance gaps (vague claims, abstract nouns,
   AI-style hedges, missing concretes). Catalog issues with reference to specific passages.
3. **NULL pre-check (before rewriting).** Ask: is this already clear, specific, and authored? Would
   only 1–3 targeted edits help? If it's already good → return `Keep original` (optionally a few
   surgical suggestions) and stop. This check happens *before* a revision exists, so it can actually fire.
4. **Value-first ask (refine-input/deep modes).** If high-leverage substance is missing, show a
   quick structural baseline, then ask ≤2 (≤3 deep) targeted questions tied to exact passages
   (see `substance-prompts.md`). Make declining easy ("if you don't have it, say so — we won't invent").
5. **Rewrite in layers** (only as far as the defect requires):
   - *Structural* — pick a reader-first template (`structures.md`); fix opener/transitions/ending;
     vary sentence length for emphasis and clarity (no numeric targets, no forced cadence).
   - *Surface* — replace mechanical connectors with logic-bearing ones; passive→active where the
     actor is known; cut filler; keep words that are accurate and in-voice even if they appear on a
     smells list. Do not purge for purging's sake.
   - *Human (Layer 3 — gated)* — only with USER_FACT stake: render the user's real specifics,
     judgment, and (genuinely expressed) emotional register; apply the opinion-accountability format
     `I believe X because Y. This matters because Z. Test it by W.` only to claims the user supplied.
6. **Audit (honest).** See `rubric.md`. Default = compact **visible** self-audit, headed
   `unvalidated self-audit` (not validation), covering: provenance intact? specificity ↑? structure/
   reader-fit ↑? authored-without-fabrication? + a **verdict**: improved / did-not-improve / made-worse /
   already-good-keep-original. Deeper pairwise/order-swap or a different-model "independent model audit"
   are opt-in only (see rubric.md); never present any score as objective or as proof of human authorship.

## Output shape (lean; revision first)

```
[the revised text]

— unvalidated self-audit: <verdict>. <one or two lines: what changed and the honest tradeoff>
  Provenance: <user-supplied / source-only / Layer 3 locked>. <flags, e.g. "substance-thin: para 2">
  (Ask for other variants, a deeper audit, or a voice-matched version if useful.)
```

Keep the audit/wrapper short — it should not dwarf the revision (scale it to input length; a
two-line Slack message gets a one-line audit). For `deep-voice-match`, list variants then the audit.
For high-stakes mode, put the change-log here and name any semantic change you refused to make.

## Reference-loading map (load on demand only)

| Need | Load |
|---|---|
| Default revision | none |
| Detailed generic-smell diagnosis | `references/model-default-smells.md` |
| Refusal / misuse policy detail | `references/ethical-refusals.md` |
| Craft anti-patterns (what doesn't work, and why) | `references/bad-craft-patterns.md` |
| Audit / verdict / deeper-grader options | `references/rubric.md` |
| Structure & opener/ending help | `references/structures.md` |
| User gave a voice sample / wants voice match | `references/voice-profile.md` |
| Substance is thin and you need to ask well | `references/substance-prompts.md` |
| User requested multiple variants | `references/variant-recipes.md` |
| Calibration / worked examples (incl. a high-stakes "what not to do") | `references/before-after-examples.md` |
| Maintaining the skill / checking a claim's freshness | `references/evidence-ledger.md` (maintainer-only) |
| Optional computed metrics (Claude Code only) | `scripts/metrics.py` |

## Optional metrics (never required, never a gate)

If `scripts/metrics.py` can run (Claude Code / local), it reports a *diagnostic vector* —
sentence-length entropy, lexical diversity (MATTR/MTLD), a concreteness proxy — versus a
moderate human band. Treat as a smell-check, never a target (optimizing them produces worse
prose). **If it cannot run, emit no numbers at all** — qualitative notes only. Never present
estimated figures as if measured.
