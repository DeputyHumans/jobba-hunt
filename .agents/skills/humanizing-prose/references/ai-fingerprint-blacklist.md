# AI fingerprint blacklist

Patterns that signal AI authorship. Use this in Phase 2 (Diagnostic) to catalog hits with line references, and in Phase 4 Layer 2 (Surface edit) to purge them.

The list is descriptive, not exhaustive. New AI-style phrasings emerge as models evolve. The underlying principle stays the same: **flag any phrase that adds zero information, or that the writer would not have chosen if they were thinking about meaning rather than producing fluent text.**

## Tell-words by category

### Mechanical transitions
Replace with logic-bearing transitions (see **Real transitions** below).

`Furthermore` · `Moreover` · `Additionally` · `Consequently` · `In conclusion` · `Subsequently` · `Henceforth` · `Thus`

### Ornamental openers
Cut entirely or replace with a working first line.

`In today's rapidly evolving landscape` · `In today's digital age` · `In an era where` · `As we navigate the complexities of` · `At its core` · `It goes without saying that` · `When it comes to` · `In the realm of` · `Delve into` · `Let us explore`

Conversational throat-clearers — the social-media register of the same move. They announce that a point is coming instead of making it. Delete the runway and start at the point.

`Here's the thing` · `Here's what/why…` · `It turns out` · `The truth is` · `The uncomfortable truth is` · `Let me be clear` · `Can we talk about`

### Buzzwords
Replace with the plain action.

`leverage` (use) · `synergy` · `robust` (solid) · `seamless` (smooth) · `cutting-edge` (new) · `streamline` · `optimize` · `utilize` (use) · `facilitate` (help) · `holistic` · `paradigm` · `ecosystem` (when not literal)

### Business-jargon verbs
Consultant-deck verbs standing in for a plain action. Replace with the plain word.

`navigate` (handle) · `unpack` (explain) · `lean into` (accept, commit to) · `deep dive` (examine) · `double down` (commit) · `circle back` (revisit) · `moving forward` (next, from now) · `take a step back` (reconsider) · `on the same page` (aligned) · `game-changer` (significant)

(`landscape` as a figurative noun lives under **Flowery metaphors** below — cross-reference, don't double-count.)

### Bare intensifiers
Empty emphasis the writer would not have typed if the underlying point were already strong. Cut unless the word is load-bearing.

`really` · `just` · `literally` · `genuinely` · `honestly` · `simply` · `actually` · `truly` · `fundamentally` · `inherently` · `inevitably` · `crucially`

### High-drama words
Replace with measured alternatives.

`transformative` · `revolutionary` · `game-changer` · `unleash` · `unlock` · `empower` (when vague) · `pivotal` · `groundbreaking` · `disruptive` (when not literal)

### Vague adjectives
Replace with the specific quality.

`comprehensive` · `myriad` · `multifaceted` · `nuanced` (when used to dodge specificity) · `complex` (when filler) · `significant` · `substantial` · `meaningful` (when filler) · `key` (when filler)

### Flowery metaphors
Almost always cut.

`tapestry` · `landscape` (figurative) · `beacon` · `journey` · `symphony` · `mosaic` · `cornerstone` · `bedrock` · `north star` (metaphorical)

### Filler phrases
Cut and state the point directly.

`It is important to note that` · `It is worth mentioning that` · `It should be noted that` · `Plays a crucial role` · `Plays a vital role` · `Stands as a testament to` · `Serves as a reminder` · `Speaks volumes about` · `In the world of` · `When all is said and done`

### Emphasis crutches
Stamps that try to manufacture weight a sentence hasn't earned. Cut them; if the point needs them to land, the point is too weak.

`Full stop` · `Period.` · `Let that sink in` · `Make no mistake` · `This matters because` (as a bare assertion) · `Here's why that matters`

### Meta-commentary
Self-referential asides that narrate the writing instead of doing it. Cut and let the content carry itself.

`Plot twist` · `Spoiler` · `Hint:` · `Let me walk you through` · `In this section we'll` · `As we'll see` · `X is a feature, not a bug`

### AI-style hedges
Replace with definite claims (or actually-honest hedges).

`may help organizations` · `can offer benefits` · `has the potential to` · `could potentially` · `it is recommended to` · `one might consider` · `there are several factors to consider`

### Padding pairs
Cut one of the words.

`tools and techniques` · `methods and approaches` · `tips and tricks` · `roles and responsibilities` · `goals and objectives` · `terms and conditions` (when not literal)

## Sentence patterns

These are structural fingerprints — the model's habit of falling into specific syntactic templates. Surface-level word changes don't fix them. Rewrite the sentence.

| Pattern | Example | Why it's a tell |
|---|---|---|
| `It's not about X, it's about Y.` | "It's not about the tool, it's about the workflow." | Trained-in epigram structure. Overused beyond plausibility. |
| `Not because X. But because Y.` | "Not because of the model. But because of the data." | Same pattern, different mask. |
| `No X. No Y. Just Z.` | "No fluff. No buzzwords. Just clarity." | Especially common in marketing-toned AI output. |
| Three-word staccato triplets | "Fast. Reliable. Scalable." | Pure cadence with no information. |
| `The result? The outcome?` | "The result? Faster decisions." | Self-asked rhetorical question used as transition. |
| `This isn't just X — it's Y.` | "This isn't just an upgrade — it's a transformation." | Cousin of the first pattern. |
| Bookend rule-of-three | "We diagnosed, designed, and deployed." | Fine occasionally; AI uses it everywhere. |
| Restate-then-emphasize | "Speed matters. Speed *really* matters." | Italics or repetition used as a fake-emphasis crutch. |

## Agency & voice tells

A distinct family of fingerprints: the model hides the actor. It hands human verbs to abstractions, narrates from above the scene, or buries who did what in the passive voice. Governing principle — **every sentence should have a human subject doing something.** When you can't name one, that's usually the tell.

### False agency
Inanimate nouns given human verbs. The model reaches for these because they let it assert change without committing to who caused it.

| Pattern | Why it's a tell | Fix |
|---|---|---|
| "the data tells us" | Data sits there; someone read it and drew a conclusion. | Name the reader: "After three weeks of logs, we saw…" |
| "the market rewards" | Markets don't reward; buyers pay for things. | "Buyers pay more for…" |
| "a complaint becomes a fix" | The complaint did nothing; someone fixed it. | "The team shipped the fix that week." |
| "the decision emerges" | Decisions don't emerge; someone decides. | "We decided to…" |
| "the culture shifts" | Cultures don't move on their own; people change behavior. | "Managers stopped rewarding overtime." |
| "the conversation moves toward" | Conversations don't steer themselves; someone steers. | "She pushed the room toward…" |

**Fix in general:** name the human and put them at the front. If no specific person fits, use **you** to put the reader in the seat.

### Narrator-from-a-distance
Floating above the scene and lecturing instead of putting the reader in the room.

| Pattern | Fix |
|---|---|
| "Nobody designed this." | "You don't sit down one day and decide to…" |
| "People tend to…" | Name who, or address the reader directly. |
| "This happens because…" / "This is why…" | Drop the lecturer frame; show it happening. |

### Wh-opener crutch
Leading sentences with *What / When / Why / How* as a setup-and-deliver device. It postpones the point and clusters fast.

> "What makes this hard is the data." → "The constraint is the data." (or name the specific constraint)

Flag any cluster of sentences opening on a wh-word; restructure to lead with the subject or verb.

### Punctuation tell — em-dash density
Heavy em-dash use is one of the most recognizable current AI fingerprints — the model uses them to splice extra clauses where a human would have started a new sentence. **Watch the density and reduce it:** default to commas or periods, and keep at most one em-dash per few paragraphs. This is a *watch-and-reduce* rule, not a ban — an occasional em-dash is fine and part of controlled variation (see the Burstiness rule). Total elimination would itself flatten rhythm.

## Burstiness violation rule

Concrete metric to flag in Phase 2:

**Any run of 3+ consecutive sentences whose word counts fall within ±20% of each other is a violation.**

Example violation (each sentence ~14–16 words):

> "AI helps companies make better decisions about their operations. It also reduces the time spent on repetitive analytical tasks. Additionally, it enables teams to focus on more strategic initiatives."

Example acceptable rhythm (3 / 28 / 6 word counts):

> "Most AI pilots fail. Not because the model is weak — they fail because nobody redesigned the workflow around the model after deployment. Adoption follows ownership."

After every run of two long sentences, write one of four words or fewer when natural. Use occasional fragments. One-line paragraphs where they fit.

This is **controlled** variation, not noise. See `anti-patterns.md` for why fake messiness fails.

## Real transitions (replacement library)

Use these to replace mechanical connectors. Each carries a logical relationship instead of merely chaining clauses.

| Relationship | Natural transition |
|---|---|
| Contrast | "But that is only half the issue." |
| Cause | "That is where the process breaks." |
| Example | "Here is what that looks like in practice." |
| Consequence | "The result is predictable." |
| Correction | "The better question is..." |
| Escalation | "The harder problem comes later." |
| Summary | "The point is simple." |
| Concession | "Fair — but..." |
| Pivot | "Now flip it." |

Or use no transition at all. A sentence does not need a connector word to follow logically from its predecessor.

## Opener-strength taxonomy

Apply this in Phase 2's opener test. A working opener belongs to one of these types. Anything ornamental is a flag.

| Type | Example |
|---|---|
| Contrarian | "Your AI roadmap is probably too technical." |
| Practical | "Start with the workflow, not the model." |
| Diagnostic | "If adoption drops after week two, you don't have a training problem. You have a relevance problem." |
| Story | "The client wanted a chatbot. The real problem was their pricing data." |
| Warning | "AI will not fix unclear ownership. It will expose it faster." |

## Ending-strength taxonomy

A working ending does one of three things. Anything ceremonial is a flag.

| Type | Example |
|---|---|
| Next action | "Pick one workflow, define the decision it should improve, assign an owner, and measure whether the work actually gets faster." |
| Sharpen the claim | "AI does not create accountability. It rewards the teams that already have it." |
| Memorable distinction | "The model was accurate. The team still ignored it. That is where most AI programs break: not at prediction, but at adoption." |

## Emotional positivity check

Scan the input for emotional range. If every paragraph is upbeat, motivational, or affirming — flag it. Human writing on substantive topics typically shows skepticism, frustration, vulnerability, or other negative-valence affect somewhere.

This does not mean inject manufactured negativity. It means notice the absence and ask the user (in Phase 3) whether genuine skepticism or critique belongs in the piece.

---
