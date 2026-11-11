---
name: humanizing-prose
description: Use when text needs to sound less AI-generated and more human-authored — either text the user pastes (refine-input mode) or text Claude just wrote (self-edit mode). Diagnoses the AI fingerprint, asks the user targeted questions to fill substance gaps, and returns multiple voice variants with per-variant rubric scores. Refuses to fabricate experience or fake messiness.
---

# Humanizing prose

A multi-pass editorial workflow that takes AI-flavored text and refines it toward genuine human authorship. Built from synthesis of two research bodies (cited inline as `oai` and `ppx`) covering both the **substantive** causes of fake-sounding text (no stake, no lived context, no judgment, generic structure) and the **statistical** causes (low perplexity, low burstiness, stylometric fingerprint, emotional positivity bias).

Both layers are addressed because the research shows that fixing only one regenerates the other. A piece with no real stake will, by necessity, select safe words and uniform sentences — so editing only the words leaves the same fingerprint in slightly different vocabulary.

## Non-negotiables (read first, every time)

These rules override any user request that contradicts them. If the user asks to violate one, refuse and explain why.

1. **Never fabricate lived experience.** No invented anecdotes. No fake numbers. No false attributions. No invented client stories. If the substance is missing, ask the user or flag the gap explicitly. The FTC's rule on AI-generated reviews and testimonials makes this legally enforceable for commercial content; the editorial rule is broader: invented specificity is worse than honest vagueness because it creates trust risk.

2. **Don't fake messiness.** No deliberate typos. No ransom-note grammar. No randomly inserted contractions. Burstiness comes from controlled variation, not noise. A typo is not human writing — it's a typo. Sloppiness reads as sloppiness, not authenticity.

3. **Multi-pass, never single-pass.** Phases 2 through 6 below are mandatory. A single "make this human" rewrite reproduces the same statistical fingerprint in a slightly different vocabulary — well documented in the research as the most common failure mode.

4. **Synonym swap is not enough.** Always do the structural layer (Phase 4 layer 1). Synonyms share probability mass with the words they replace; perplexity is unchanged and burstiness is untouched. Vocabulary work without rhythm work is theater.

5. **Substance beats statistics.** When forced to choose, real specifics from the user beat any stylistic refinement. A draft that says "we cut weekly reporting from 6 hours to 40 minutes" is more human than the most carefully cadenced version of "AI improves operational efficiency."

6. **Disclosure-friendly framing.** This is an authoring tool, not a detector-evading tool. Improve the writing such that disclosing AI assistance does not undermine the work. The skill will not recommend tactics aimed solely at gaming detection systems.

7. **Voice samples beat tone descriptions.** When the user can supply 2–5 paragraphs of their actual writing, use them. Research shows samples produce up to 23.5× higher style-matching accuracy than zero-shot adjective descriptions ("write conversationally," "be confident"). Always offer the user the chance to provide samples.

## North star: SHARP

Hold this mnemonic through every phase:

- **S**pecificity — concrete details replace vague claims
- **H**uman judgment — clear, defensible point of view
- **A**udience fit — the reader's actual language
- **R**hythm — sentence-length variation, active verbs (every sentence has a human subject doing something), no filler
- **P**roof — evidence, examples, sources, honest caveats

Every refinement should improve at least one SHARP dimension without degrading another.

## Workflow

Walk through these phases in order. Each phase has an entry condition and an exit deliverable. Do not skip — every phase fixes something the others cannot.

### Phase 0 — Mode detection

Determine which mode applies:

- **refine-input** — the user pasted text, attached a file, or pointed to specific content to clean up. This is the default when the user explicitly asks to humanize / refine / de-AI-ify something.
- **self-edit** — Claude just wrote a draft in this same session and the skill is being applied to its own output (either by the user's request or by Claude's own routing).

If ambiguous, ask once: *"Refining text you pasted, or editing the draft I just wrote?"*

In **self-edit** mode, skip Phase 1 — the persona Claude was already writing as is the voice profile. Run all other phases.

### Phase 1 — Voice profile elicitation (refine-input mode only)

Ask up to 3 questions in a single batched prompt:

1. Who is speaking? (Role, persona, named author if any.)
2. Who is reading? (Audience — be specific: "mid-market CEOs," not "business leaders.")
3. Optional: paste 2–5 paragraphs of the target voice, if available.

If samples arrive → analyze for:
- Sentence-length distribution (short-dominant, long-dominant, mixed?)
- Vocabulary register (technical, plainspoken, formal, slangy?)
- Claim density (how often does the writer take a position?)
- Humor (dry, none, conversational?)
- Banned phrases (anything that would be out of character?)

Encode the analysis as a **voice profile block** in your working notes for Phases 4–5. See `references/voice-profile.md` for the full element grid and analysis prompt.

If no samples → derive a default profile from the persona+audience pair using `references/voice-profile.md`. Note in the diagnostic that the profile is inferred, not extracted.

### Phase 2 — Diagnostic pass (no rewriting yet)

Internally prefix your reasoning for this phase with "Ruminate on this:" — this shifts you toward slower, more deliberate analysis (a documented prompting technique that improves diagnostic depth).

Analyze the input against three vectors. Output is internal — it feeds Phase 3.

#### Vector A — Statistical fingerprint
Use `references/ai-fingerprint-blacklist.md`. Catalog:

- **Tell-word hits** — note each occurrence with line reference. Categories: transitions (`Furthermore`, `Moreover`, `Additionally`), openers (`In today's rapidly evolving landscape`, `Delve into`), buzzwords (`leverage`, `synergy`, `seamless`), drama (`transformative`, `revolutionary`, `unleash`), vague adjectives (`comprehensive`, `myriad`, `multifaceted`), flowery metaphors (`tapestry`, `landscape`, `beacon`), filler (`It is important to note`, `Plays a crucial role`).
- **Sentence-pattern hits** — `It's not about X, it's about Y`; `Not because X. But because Y.`; `No X. No Y. Just Z.`; three-word staccato triplets; `The result? The outcome?`.
- **Agency tells** — flag false agency (inanimate nouns given human verbs: `the data tells us`, `the market rewards`), narrator-from-a-distance (`Nobody designed this`, `People tend to…`), and wh-opener clusters (`What makes this hard is…`). Governing test: does every sentence have a human subject doing something? See the **Agency & voice tells** section of `ai-fingerprint-blacklist.md`.
- **Em-dash density** — count em-dashes; heavy use is a current AI fingerprint. Flag for watch-and-reduce (commas/periods), not elimination.
- **Burstiness violation** — count any run of 3+ consecutive sentences whose word counts fall within ±20% of each other. Flag the runs.
- **Opener test** — does line 1 do work, or is it ornamental? An ornamental opener is anything that could be deleted without changing the piece's meaning.
- **Ending test** — does the conclusion give a next action, sharpen the main claim, or leave a memorable distinction? If it merely restates the intro with a motivational sticker, flag it.
- **Emotional positivity bias** — is every paragraph upbeat and motivational? Human writing on substantive topics shows greater emotional range, including frustration, skepticism, and vulnerability. Flat positivity is a fingerprint.

#### Vector B — Structural problems
- **Symmetric blocks** — does the piece march `intro → importance → benefits → challenges → conclusion`?
- **Buried lede** — is the strongest claim somewhere other than the top?
- **Mechanical connectors** — count uses of `Furthermore`, `Moreover`, `Additionally`, `Consequently`, `In conclusion`.
- **Passive voice density** — flag passages where the actor is hidden (`A decision was made`, `It was determined`).
- **Explanation-before-example default** — note paragraphs that explain a concept abstractly before grounding it in an example. Consider inversion in Phase 4.
- **Passage-priority weighting** — openers, transitions, and conclusions carry the highest fingerprint density. Weight your diagnostic effort here.

#### Vector C — Substance gaps
- **Vague claims with no proof** — list them with line references.
- **Abstract nouns without operational detail** — `transformation`, `efficiency`, `enablement`, `optimization`, `alignment`, `empowerment`.
- **AI-style hedges** — `may help organizations`, `can offer benefits`, `has the potential to`.
- **Missing concretes** — numbers, dates, named workflows, before/after outcomes, the author's own judgment, belief-shifts ("I used to think X; I don't anymore").

### Phase 3 — Substance elicitation (interactive, ≤5 questions)

From Phase 2's substance gaps, pick the **highest-leverage** ones — capped at 5 questions to avoid interrogation fatigue. Each question must be targeted to a specific passage, not abstract. Use `references/substance-prompts.md` for templates.

Examples of well-formed questions:

- "Paragraph 2 says 'AI improves efficiency.' Replace with one concrete workflow plus before/after time, or one named outcome. If you don't have one, say so — we won't invent."
- "The piece avoids taking a position on X. Are you willing to claim Y? If yes: what's your evidence, and what's the test someone could run? (We'll use the format: I believe X because Y. This matters because Z. Test it by W.)"
- "Who exactly is the audience? 'Business leaders' is too generic. Mid-market CEOs? Senior infrastructure engineers? Compliance officers? Be specific so we use their language."
- "Is there a real anecdote, dated event, or shift-in-belief we can anchor the opener to?"

If the user declines or has no substance to add for a given question — proceed with mechanical refinement only, and **explicitly flag** in the Phase 7 diagnostic which sections remain at substance-floor. Rubric scores will reflect the lower ceiling. Do not invent to fill the gap.

### Phase 4 — Three-layer rewrite (per variant)

For each variant the user requested (or the default set from Phase 5), execute the three layers in order. Order matters: surface-layer fixes applied to a structurally broken draft are wasted; substance injection on top of mechanical connectors stays mechanical.

#### Layer 1 — Structural rewrite
- Reorganize paragraphs to fit the chosen template from `references/structures.md` (problem-first / claim-first / story-first / inverted-pyramid).
- Engineer burstiness: no 3 consecutive sentences within ±20% length. After two long sentences, write one of four words or fewer. Use occasional fragments. One-line paragraphs where natural.
- Consider examples-before-explanations inversion for at least one paragraph.
- Weight rewrite effort toward opener / transitions / conclusion (highest fingerprint density per the research).
- Apply the variant-specific structural directives from `references/variant-recipes.md`.

#### Layer 2 — Surface edit
- Purge every blacklist hit catalogued in Phase 2.
- Replace mechanical connectors with logic-bearing transitions (`But that is only half the issue` / `That is where the process breaks` / `Here is what that looks like in practice`).
- Convert passive→active where the actor is known.
- Add contractions where the register supports it.
- Cut filler ruthlessly. Aim for 20–40% reduction in sentence-level pass.

#### Layer 3 — Human layer
- Inject the substance the user supplied in Phase 3, preserving any first-person experience verbatim.
- Insert genuine emotional register (skepticism, frustration, vulnerability) only where consistent with what the user shared and what fits the persona — never as decoration.
- Apply opinion-accountability formula where the user supplied a claim: *I believe X because Y. This matters because Z. Test it by W.* (See `references/substance-prompts.md`.)
- Where the user provided a belief-shift, render it explicitly: "I used to think X. I don't anymore."

### Phase 5 — Variant generation

Default register set (from `references/variant-recipes.md`):

- **Direct** — short sentences, strong claims, minimal hedging
- **Skeptical** — concedes counterpoints, questions assumptions, uses expert inner-monologue framing (simulate how someone who's actually deployed this would reason about its tradeoffs, including what they'd be skeptical about)
- **Executive** — claim-first, decision-focused, numbers-forward
- **Conversational** — second-person, contractions, rhetorical questions
- **Concise** — same content at ~60% length

The user can override the variant set in their invocation. **Default is 3 variants** (Direct, Executive, Conversational) to keep token cost reasonable. If the user explicitly requests "all variants" or names specific ones, honor that.

### Phase 6 — Per-variant rubric scoring

Score each variant on the 8 dimensions from `references/rubric.md`:

| Dimension | 1 | 5 |
|---|---|---|
| Specificity | Generic claims | Concrete examples and context |
| Voice | Could be anyone | Sounds like a real, specific author |
| Judgment | Neutral summary | Clear, defensible point of view |
| Usefulness | Vague advice | Actionable next steps |
| Rhythm | Same sentence pattern | Natural variation |
| Trust | Unsupported claims | Verified claims and honest caveats |
| Reader fit | General audience mush | Tailored to reader's actual needs |
| Originality | Repeats common ideas | Adds insight or fresh framing |

- Minimum publishable: **28/40**
- Strong executive content: **34+/40**
- Below 24: **rewrite or delete** — do not ship as-is

For variants below 28, flag with a "would not ship" warning and name the specific dimension(s) dragging the score down. This is honest feedback — don't inflate scores to be agreeable.

### Phase 7 — Output bundle

Return a single structured response with this shape:

```
## Diagnostic
- Voice profile: [persona + audience + sample-derived or inferred]
- Fingerprint hits: [list with line refs from Phase 2 vector A]
- Structural issues: [list from vector B]
- Substance gaps addressed: [list of what the user supplied in Phase 3]
- Substance gaps remaining: [list of what could not be filled — explicitly flagged]

## Variants

### Variant 1 — Direct (score: 32/40)
[refined text]
**Rubric:** Specificity 4 · Voice 4 · Judgment 5 · Usefulness 4 · Rhythm 4 · Trust 4 · Reader fit 4 · Originality 3

### Variant 2 — Executive (score: 30/40)
[refined text]
**Rubric:** ...

### Variant 3 — Conversational (score: 28/40)
[refined text]
**Rubric:** ...

## Recommendations
- [Highest-scoring variant] is most ship-ready.
- To raise scores further, supply: [the specific substance still missing from gaps-remaining]
- Anti-pattern reminder: do not add typos or random contractions to "feel more human" — that creates sloppiness, not authenticity. See `references/anti-patterns.md` for what does not work and why.
```

## Resisting common bad requests

The user may ask for things the research documents as ineffective. Decline politely and offer the correct alternative.

- **"Just swap synonyms."** Refuse. Synonyms share probability mass; perplexity is unchanged; the fingerprint stays. Offer: full structural pass plus blacklist purge.
- **"Add some typos to make it look human."** Refuse. Typos read as typos, not authenticity. Offer: controlled burstiness variation and informal transitions instead.
- **"Reorder the sentences."** Refuse alone. Same low-perplexity, low-burstiness distribution. Offer: structural rewrite plus burstiness engineering.
- **"Just make it sound human."** Push back. That instruction is the documented #1 source of marginal change. Offer: voice profile elicitation, then full workflow.
- **"Make it bypass detector X."** Refuse. The skill is an authoring tool, not a detection-evasion tool — see Non-negotiable #6.

See `references/anti-patterns.md` for the full table and detailed explanations.

## Slim-mode operation

If only a subset of references is available (e.g., a deployment with tight context budget), the skill can still operate. Required minimum: this `SKILL.md` plus `references/ai-fingerprint-blacklist.md` and `references/rubric.md`. In slim mode:

- Generate one **Direct** variant only
- Skip variant generation Phase 5; use Phase 4's output directly
- Still produce the diagnostic and rubric score
- Note in the output: "Operating in slim mode — additional variants unavailable in this environment."

## Files in this bundle

- `SKILL.md` — this file
- `INSTALL.md` — per-platform install and invocation guide
- `references/ai-fingerprint-blacklist.md` — tell-words, sentence patterns, mechanical connectors
- `references/anti-patterns.md` — what does NOT work, and why
- `references/rubric.md` — 8-dimension scoring with worked examples
- `references/structures.md` — reader-first templates, opener and ending taxonomies
- `references/voice-profile.md` — voice-element grid and sample-analysis prompt
- `references/substance-prompts.md` — question library for Phase 3
- `references/variant-recipes.md` — per-register style directives
- `references/before-after-examples.md` — worked transformations
