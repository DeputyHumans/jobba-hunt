# Variant recipes

Each recipe is a modulation of the voice profile from `voice-profile.md`. The recipe doesn't replace the voice profile — it adjusts a few dials.

In Phase 5, generate one variant per requested register. Default set when the user doesn't specify: **Direct**, **Executive**, **Conversational**.

## Direct

Best for crisp arguments, opinion pieces, technical posts where the reader wants the answer fast.

**Modulations from base voice profile:**
- Sentence length: skew shorter; cap most sentences at ~15 words; allow rare longer sentences only when carrying a tradeoff or example.
- Hedging: minimal. Replace AI hedges (`may help`, `can offer`) with definite claims when the user supplied evidence; with honest qualifiers (`in our experience`, `for the workflows we've measured`) when they didn't.
- Connectors: prefer no connector over a connector. Let claims sit next to each other.
- Opener: contrarian or diagnostic from the opener taxonomy.
- Ending: sharpen-the-claim or memorable-distinction.

**Example transformation:**

Input: *"There are several ways AI can potentially improve productivity in modern organizations."*

Direct: *"AI improves productivity in one specific way. It removes the most repeatable step in a workflow that already has an owner. Everything else is overhead."*

## Skeptical

Best for analytical pieces, contrarian takes, anywhere the reader benefits from seeing the strongest counterarguments handled.

**Modulations:**
- Use the **expert inner-monologue framing** internally before writing. Ask: *how would someone who's actually deployed this and watched it fail reason about its tradeoffs? What would they be skeptical about?* Write from that mental position, not from a neutral surveyor's position.
- Concede explicitly. Use phrases like "fair — but," "the obvious counterargument is X, and it's mostly right," "I used to think that, too."
- Sentence length: mixed; lean on longer sentences when carrying a counterpoint, shorter when delivering the verdict.
- Opener: contrarian or warning.
- Ending: sharpen-the-claim, often by naming the unresolved tension.

**Example transformation:**

Input: *"AI offers many benefits for customer support."*

Skeptical: *"AI in customer support works — for the cases that don't need humans. The obvious counterargument: 'but most cases don't need humans.' Fair. The harder problem is that the cases that do need humans are exactly the ones where customers will remember the experience. AI handles 80% of tickets and saves you 0% of the reputation risk."*

## Executive

Best for board-facing memos, leadership briefings, decision documents.

**Modulations:**
- Claim-first structure (from `structures.md`).
- Numbers-forward when the user supplied them; explicit absence-of-numbers when they didn't.
- Vocabulary: business-strategic; precise; no consumer-marketing register.
- Sentence length: mostly short. Long sentences only for tradeoffs.
- Opener: practical or diagnostic.
- Ending: next-action.

**Example transformation:**

Input: *"AI can help organizations streamline operations and improve their bottom line."*

Executive: *"AI improves the bottom line in one measurable way: it shortens the cycle time of a workflow you already own. Pick one — sales research, support triage, compliance review. Measure it now. Re-measure in 60 days. If the cycle didn't shorten, the AI didn't help. Treat anything else as a marketing claim."*

## Conversational

Best for blog posts, newsletters, audience-direct pieces where the reader expects a personal voice.

**Modulations:**
- Second-person throughout where natural.
- Contractions on by default.
- Rhetorical question allowed once per section, no more.
- Sentence length: mixed; allow occasional one-line paragraphs.
- Opener: story or practical.
- Ending: next-action or memorable-distinction.

**Example transformation:**

Input: *"Organizations should consider implementing AI thoughtfully."*

Conversational: *"Here's the thing about implementing AI: most teams skip the only step that matters. They pick a tool, they run a pilot, they declare victory. Nobody asks the boring question first — which actual decision in your week should this AI improve, and how will you know if it did? Start there. Save yourself the dashboard graveyard."*

## Concise

Best for landing pages, executive summaries, anywhere the original is too long.

**Modulations:**
- Target ~60% of input length.
- Cut every sentence that doesn't carry information the reader needs.
- Prefer one strong example over three weak ones.
- Sentence length: skew shorter; allow one elaborated sentence per major point.
- Opener: same type as input; just compressed.
- Ending: same type as input; just compressed.

**Example transformation:**

Input (60 words): *"In today's rapidly evolving business landscape, organizations are increasingly turning to artificial intelligence to drive innovation, improve efficiency, and gain a competitive advantage. By leveraging AI-powered solutions, companies can unlock new opportunities and streamline operations across departments."*

Concise (24 words, 40% of original): *"Most companies don't have an AI problem. They have a workflow problem. AI helps when it's attached to a decision and an owner."*

## Combining recipes

A user can request hybrid registers (e.g., "Skeptical-Executive"). Combine the modulations:

- Take the dominant recipe's structural directives (Skeptical → expert inner monologue, concession patterns).
- Take the secondary recipe's opener and ending types (Executive → practical opener, next-action ending).
- Resolve conflicts by favoring the dominant recipe's sentence-length and connector rules.

## Variant generation procedure (per variant in Phase 5)

1. Load the working voice profile from Phase 1.
2. Apply the recipe's modulations.
3. Run Phase 4 Layers 1–3 with the modulated profile.
4. Score in Phase 6.

Each variant is a complete pass — not a partial edit of the previous variant. Generating Variant 2 by lightly tweaking Variant 1 produces near-identical outputs that defeat the purpose of having multiple variants.
