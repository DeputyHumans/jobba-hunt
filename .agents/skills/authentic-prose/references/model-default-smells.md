# Model-default smells (dated quality heuristics — NOT a detector)

> **Last reviewed: 2026-06.** These are *quality clues*, not proof of AI authorship and not a
> detection tool. A phrase appearing here is never, by itself, a reason to change it. Remove
> something only if it also weakens specificity, voice, judgment, reader-fit, or rhythm.
> **Staleness rule:** if this file is more than ~3–6 months past the review date above, do not
> call any item an "AI signal" — downgrade everything to "reads generic." See `evidence-ledger.md`.

Why this file is framed so cautiously (2025–2026 research): surface fingerprints have largely
**collapsed** as reliable discriminators for frontier models. Many famous "tells" are now
*anti-tells* — humans avoid them out of fear of looking AI, and models have been tuned away from
them. Optimizing against this list does not make text more human; pushed hard, it installs a new,
recognizable "humanizer" cadence and launders the author's real voice. Use the list to notice
genericness, then fix the underlying weakness, not the token.

## Signal status table (act only on `stable` items, and only when clustered)

| Signal | Examples | 2026 status | Editorial action |
|---|---|---|---|
| Mechanical transitions | `Furthermore`, `Moreover`, `Additionally`, `Consequently`, `In conclusion` | **stable** (as a *flow* smell) | Replace with a logic-bearing transition, or none. |
| Ornamental openers | `In today's rapidly evolving landscape`, `In an era where`, `Delve into`, `When it comes to` | **stable** | Cut; start at the point (see opener taxonomy). |
| Throat-clearers | `Here's the thing`, `The truth is`, `It turns out`, `Let me be clear` | stable | Delete the runway; make the point. |
| Filler frames | `It is important to note that`, `Plays a crucial role`, `Serves as a reminder` | stable | Cut; state it directly. |
| Empty intensifiers | `really`, `just`, `genuinely`, `truly`, `fundamentally` | stable | Cut unless load-bearing. |
| High-drama words | `transformative`, `revolutionary`, `unleash`, `game-changer` | stable (taste) | Replace with the measured word. |
| Vague adjectives | `comprehensive`, `myriad`, `multifaceted`, `nuanced`, `significant` | stable | Replace with the specific quality, or cut. |
| Em-dash density | `—` overuse | **reversed / aesthetic-only** | Do **not** target. Em-dash is no longer a useful tell; keep where voice-appropriate. |
| Lexical tells | `delve`, `tapestry`, `seamless`, `leverage`, `robust` | **decayed** (`delve` spiked then fell after 2024) | Treat as taste/genericness, not evidence. Replace only if generic. |
| Epigram templates | `It's not about X, it's about Y`; `No A. No B. Just C.`; staccato triplets; `This isn't just X — it's Y` | decayed→stale-marketing | Rewrite if it's doing cadence instead of carrying meaning. |
| Perplexity / "burstiness" | uniform sentence length | **legacy / weak** | Use as a *readability* clue only. No numeric rule. Never engineer variance for camouflage. |

## Agency & voice tells (durable craft — `stable`)

The most reliable quality signal is not vocabulary; it's hidden actors. Governing test:
**every sentence should have a human subject doing something.**

- **False agency** — inanimate nouns given human verbs: "the data tells us" → name the reader
  ("after three weeks of logs, we saw…"); "the market rewards" → "buyers pay more for…";
  "the decision emerges" → "we decided to…".
- **Narrator-from-a-distance** — "Nobody designed this", "People tend to…", "This is why…" →
  put the reader in the room or name who.
- **Wh-opener clusters** — leading sentences on *What/When/Why/How* as setup-and-deliver
  ("What makes this hard is the data" → "The constraint is the data"). Flag clusters; restructure.

## Real transitions (replacement library)

Contrast: "But that is only half the issue." · Cause: "That is where it breaks." ·
Example: "Here is what that looks like in practice." · Consequence: "The result is predictable." ·
Correction: "The better question is…" · Concession: "Fair — but…" · Pivot: "Now flip it."
Or use no transition at all — a sentence can follow logically without a connector word.

## Opener taxonomy (a working first line is one of these; anything else is ornamental)

Contrarian · Practical · Diagnostic · Story · Warning. (See `structures.md` for examples.)

## Ending taxonomy (a working ending does one of these; anything else is ceremonial)

Next action · Sharpen the claim · Memorable distinction.

## Rhythm (no hard rule)

Vary sentence length to serve emphasis and comprehension — short to land a point, longer to
carry a tradeoff. **Aim for the moderate, human-typical band; never maximize variance and never
target a number.** A repeated "two long, one tiny" sawtooth is itself a machine cadence. This is
controlled variation tied to meaning, never noise, and never framed as detector camouflage.

## Emotional range

Flat, uniformly upbeat prose on a substantive topic reads generic. *Notice* the absence — then,
in Phase 4, ask the user whether genuine skepticism/frustration/doubt belongs. Never manufacture it.
