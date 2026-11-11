# Variant recipes

Variants are **opt-in** — the default mode returns one revision. Generate multiple variants only in
`deep-voice-match` mode or when the user asks. Each recipe modulates the voice profile from
`voice-profile.md` (it adjusts a few dials; it doesn't replace the profile). Generate each variant as a
complete pass, not a tweak of the previous one — near-identical variants defeat the purpose.

## Direct
Crisp arguments, opinion pieces, technical posts. Skew sentences shorter; minimal hedging (definite claims
where the user supplied evidence, honest qualifiers where they didn't); prefer no connector over a connector;
contrarian/diagnostic opener; sharpen-the-claim ending.
> Input: *"There are several ways AI can potentially improve productivity in modern organizations."*
> Direct: *"AI improves productivity in one specific way. It removes the most repeatable step in a workflow
> that already has an owner. Everything else is overhead."*

## Skeptical
Analytical/contrarian pieces. Use **expert inner-monologue framing**: reason as someone who's actually deployed
this and watched it fail. Concede explicitly ("fair — but," "I used to think that too"). Longer sentences for
counterpoints, short for the verdict; contrarian/warning opener; ending that names the unresolved tension.
> Input: *"AI offers many benefits for customer support."*
> Skeptical: *"AI in customer support works — for the cases that don't need humans. The obvious counterargument:
> 'but most cases don't need humans.' Fair. The harder problem is that the cases that do need humans are exactly
> the ones customers remember. AI handles 80% of tickets and saves you 0% of the reputation risk."*

## Executive
Board memos, leadership briefings. Claim-first; numbers-forward where the user supplied them (explicit absence
where they didn't); business-strategic vocabulary; mostly short sentences; practical/diagnostic opener;
next-action ending.
> Input: *"AI can help organizations streamline operations and improve their bottom line."*
> Executive: *"AI improves the bottom line in one measurable way: it shortens the cycle time of a workflow you
> already own. Pick one — sales research, support triage, compliance review. Measure it now. Re-measure in 60
> days. If the cycle didn't shorten, the AI didn't help."*

## Conversational
Blogs, newsletters. Second-person where natural; contractions on; at most one rhetorical question per section;
occasional one-line paragraph; story/practical opener; next-action or memorable-distinction ending. (Avoid
throat-clearers like "Here's the thing" — start at the point.)
> Input: *"Organizations should consider implementing AI thoughtfully."*
> Conversational: *"Most teams skip the only step that matters. They pick a tool, run a pilot, declare victory.
> Nobody asks the boring question first: which actual decision in your week should this AI improve, and how will
> you know if it did? Start there. Save yourself the dashboard graveyard."*

## Concise
Landing pages, summaries. Target ~60% of input length; cut every sentence not carrying needed information;
one strong example over three weak ones.
> Input (60w): *"In today's rapidly evolving business landscape, organizations are increasingly turning to
> artificial intelligence to drive innovation, improve efficiency, and gain a competitive advantage…"*
> Concise (24w): *"Most companies don't have an AI problem. They have a workflow problem. AI helps when it's
> attached to a decision and an owner."*

## Combining recipes
Hybrids (e.g. "Skeptical-Executive"): take the dominant recipe's structural directives, the secondary's opener/
ending types; resolve conflicts toward the dominant recipe's sentence-length and connector rules.

## Per-variant procedure
1. Load the working voice profile. 2. Apply the recipe's modulations. 3. Run the structural→surface→(gated)human
layers with the modulated profile. 4. Audit per `rubric.md`. Layer 3 stays gated by the stake rule for every variant.
