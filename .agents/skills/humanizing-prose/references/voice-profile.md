# Voice profile

Built once in Phase 1, applied across every variant in Phases 4–5. A voice profile is the difference between "make it sound human" (an instruction the model largely ignores) and "match this specific writer's rhythm, vocabulary, attitude, and characteristic moves."

The research shows that providing 2–5 paragraphs of actual writing samples produces up to **23.5× higher style-matching accuracy** than zero-shot adjective descriptions. Always offer the user the option to paste samples.

## Voice-element grid

When samples are available, analyze them across these elements. When no samples are available, derive defaults from the persona+audience pair.

| Element | What to capture | Example values |
|---|---|---|
| Sentence length | Distribution of short / medium / long | "Mostly short to medium. Occasional sharp fragment after a long claim." |
| Vocabulary | Register and domain | "Direct, strategic, commercially practical. Avoids academic fog. Uses industry terms without explaining them." |
| Attitude | The writer's stance toward subject and reader | "Confident, skeptical of hype, useful." |
| Humor | Type and frequency | "Dry, occasional, never clownish." |
| Claims | Strength and frequency of positions taken | "Strong but defensible. Takes a position every 2–3 paragraphs." |
| Rhythm | Pattern of pacing | "Mixes punchy claims with explanatory paragraphs. One-line paragraphs occasionally." |
| Banned phrases | Things this writer would never say | "'Unlock potential,' 'in today's landscape,' 'seamless,' 'game-changer.'" |
| Characteristic moves | Recurring rhetorical patterns | "Belief-shifts ('I used to think X; I don't anymore'), naming-the-real-problem reframes, hard cuts to a single-word verdict." |

## Sample-analysis prompt (use internally in Phase 1)

When the user provides samples:

> Read these samples carefully. For each voice element below, write 1–2 sentences capturing what's true of *this specific writer*, citing brief evidence from the samples.
>
> 1. Sentence length distribution
> 2. Vocabulary and register
> 3. Attitude toward subject and reader
> 4. Humor (type and frequency)
> 5. Claims (strength, frequency)
> 6. Rhythm (sentence-to-sentence pacing, paragraph length)
> 7. Phrases this writer would never use
> 8. Characteristic rhetorical moves (recurring patterns of argumentation, transition, or cadence)
>
> Then write a one-paragraph voice profile combining all eight elements. This profile is the working brief for every variant generated.

## VOICEBUCKET pattern

When the user wants the model to write *like them* on a specific content type, the most effective approach is to feed *actual examples of that content type written by them* — not generic samples. A user's tweets are not a good sample for their long-form essays; their long-form essays on similar topics are.

When asking for samples in Phase 1, prefer:

> "If you have 2–5 paragraphs of your own writing on a similar topic or in the same content type as this piece, paste them. They give the skill a much sharper voice match than abstract tone descriptions."

## Default profiles (no samples available)

When the user can't provide samples, derive a default from persona+audience. These are starting points to be refined per piece.

### Founder writing for investors
- **Sentence length:** Short to medium. Sharp claims; concise evidence.
- **Vocabulary:** Direct, commercial, occasionally technical. No academic hedge.
- **Attitude:** Confident, specific, willing to admit risk.
- **Humor:** Rare; dry when present.
- **Claims:** Strong; backed by numbers or first-person observation.
- **Rhythm:** Punchy. Avoids long elaborated paragraphs.
- **Banned:** Buzzwords. "Visionary." "Disrupting." Anything pitch-deck-flavored.

### Senior engineer writing for other engineers
- **Sentence length:** Mixed. Long when explaining tradeoffs; short when stating decisions.
- **Vocabulary:** Technical, precise, jargon-comfortable. Avoids consumer marketing register.
- **Attitude:** Skeptical, evidence-driven, comfortable with uncertainty.
- **Humor:** Dry, often through understatement.
- **Claims:** Hedged where evidence is incomplete; firm where it's solid.
- **Rhythm:** Tight when arguing, expansive when illustrating.
- **Banned:** "Game-changer." "Revolutionary." Marketing-style superlatives.

### Consultant writing for executives
- **Sentence length:** Mostly short. Long sentences only when carrying a tradeoff.
- **Vocabulary:** Business-strategic. Plain rather than academic. Industry terms used precisely.
- **Attitude:** Confident, practical, willing to disagree with conventional wisdom.
- **Humor:** Occasional, never frivolous.
- **Claims:** Strong claims with implicit evidence; the reader assumes the consultant has seen this pattern repeatedly.
- **Rhythm:** Claim — short justification — implication.
- **Banned:** "Synergy." "Holistic." "Best practices." Anything that sounds like a slide title.

### Operator writing for their team
- **Sentence length:** Short to medium. Direct.
- **Vocabulary:** Plain, action-oriented. Uses team-specific shorthand if it exists.
- **Attitude:** Decisive, owner-mode, no false modesty.
- **Humor:** Casual, internal, occasionally self-deprecating.
- **Claims:** Operational ("we're going to do X by Friday").
- **Rhythm:** Bulleted lists where they fit; short paragraphs.
- **Banned:** Corporate hedge ("we may want to consider"). Slide-deck verbs.

### Skeptical analyst writing for the broader public
- **Sentence length:** Mixed; willing to elaborate when distinguishing claims.
- **Vocabulary:** Plain language; technical terms only where needed.
- **Attitude:** Skeptical of hype; willing to defend an unpopular position.
- **Humor:** Wry; uses understatement.
- **Claims:** Often contrarian; always defended.
- **Rhythm:** Frequent counterpoint structures ("the obvious answer is X; the useful answer is Y").
- **Banned:** Marketing words. Cheerleader register.

## When persona is "Claude itself" (self-edit mode)

In self-edit mode, the persona is whatever Claude was already writing as. Capture it from the existing draft using the same eight-element analysis. Don't ask the user — read the draft.

## Encoding the profile

Once analyzed (or selected as a default), record the profile in your working notes as an inline block:

```
## Working voice profile
- Persona: [role]
- Audience: [specific audience]
- Sentence length: [pattern]
- Vocabulary: [register]
- Attitude: [stance]
- Humor: [type, frequency]
- Claims: [strength]
- Rhythm: [pattern]
- Banned phrases: [list]
- Characteristic moves: [list]
- Source: [extracted from N samples / inferred from persona+audience]
```

Reference this block when generating each variant in Phase 5. Variant recipes (`variant-recipes.md`) modulate this profile for different registers — they don't replace it.
