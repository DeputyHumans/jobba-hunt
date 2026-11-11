# Voice profile

Built once (when a sample or persona is available), applied across every variant. A voice profile is the
difference between "make it sound human" (largely ignored) and "match this specific writer's rhythm,
vocabulary, attitude, and characteristic moves."

Providing 2–5 paragraphs of the user's *own* writing produces materially better style-matching than
zero-shot adjective descriptions ("write conversationally"). This is a robust, directional finding —
few-shot samples beat adjective prompts; do not attach a specific multiplier (an earlier "23.5×" figure
in the predecessor skill was untraceable and has been removed). Always offer the user the option to paste samples.

## Voice-element grid
When samples are available, analyze across these; when not, derive defaults from persona+audience.

| Element | What to capture |
|---|---|
| Sentence length | Distribution of short / medium / long; characteristic moves (e.g. a fragment after a long claim) |
| Vocabulary | Register and domain |
| Attitude | Stance toward subject and reader |
| Humor | Type and frequency |
| Claims | Strength and frequency of positions taken |
| Rhythm | Pattern of pacing; paragraph length |
| Banned phrases | Things this writer would never say |
| Characteristic moves | Recurring rhetorical patterns (belief-shifts, reframes, hard cuts to a one-word verdict) |

## Sample-analysis prompt (use internally)
> Read these samples. For each element, write 1–2 sentences capturing what's true of *this specific
> writer*, citing brief evidence: (1) sentence-length distribution (2) vocabulary/register (3) attitude
> (4) humor (5) claims (6) rhythm (7) phrases they'd never use (8) characteristic moves. Then write a
> one-paragraph voice profile. That profile is the working brief for every variant.

Prefer samples *of the same content type*: a user's tweets are a poor sample for their long-form essays.
Ask: "If you have 2–5 paragraphs of your own writing on a similar topic or in the same format, paste them."

## Default profiles (no samples) — starting points, refine per piece
- **Founder→investors:** short-to-medium; direct/commercial; confident, admits risk; rare dry humor; strong
  claims backed by numbers/observation; punchy. Banned: pitch-deck buzzwords, "visionary," "disrupting."
- **Senior engineer→engineers:** mixed length; technical/precise; skeptical, comfortable with uncertainty;
  dry understatement; hedged where evidence is thin, firm where solid. Banned: "game-changer," "revolutionary."
- **Consultant→executives:** mostly short; business-strategic, plain not academic; confident, practical;
  occasional humor; strong claims with implicit evidence; claim→justification→implication. Banned: "synergy,"
  "holistic," "best practices."
- **Operator→their team:** short, direct; plain action-oriented; decisive owner-mode; casual humor;
  operational claims. Banned: corporate hedge, slide-deck verbs.
- **Skeptical analyst→public:** mixed; plain language; skeptical of hype; wry understatement; often
  contrarian, always defended; counterpoint structures. Banned: marketing words, cheerleader register.

## Self-edit mode
When the user points at a specific prior assistant draft, the persona is whatever that draft was written
as — extract it from the draft using the same eight elements; don't ask the user. Remember Layer 3 stays
locked unless the draft already contains the user's own stake.

## Encoding the profile (working notes)
```
## Working voice profile
- Persona · Audience · Sentence length · Vocabulary · Attitude · Humor · Claims · Rhythm
- Banned phrases · Characteristic moves · Source: [extracted from N samples / inferred]
```
Variant recipes (`variant-recipes.md`) modulate this profile for different registers — they don't replace it.
