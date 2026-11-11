# What does NOT work

Six widely shared "humanization" tactics that the underlying research documents as ineffective or counterproductive. The skill must avoid them, and must refuse them when the user asks.

The pattern across all six is the same: they treat humanizing as a surface manipulation rather than a structural and substantive change. Surface manipulations preserve the underlying statistical distribution that makes AI text recognizable.

## 1. Synonym swapping (alone)

**The bad advice:** Replace AI-flagged words with synonyms. Replace `leverage` with `utilize`. Replace `furthermore` with `moreover`.

**Why it fails:** Synonyms occupy adjacent positions in the model's probability distribution. A high-probability word's synonyms are also high-probability — perplexity barely changes. Burstiness is unaffected entirely because sentence lengths don't change. Detectors measuring statistical distribution see no meaningful difference.

**What to do instead:** Run the full structural pass (Phase 4 Layer 1) before any vocabulary work. Then do vocabulary as part of Layer 2.

## 2. Sentence reordering

**The bad advice:** Shuffle the sentences within paragraphs. Move topic sentences around.

**Why it fails:** Reordering preserves the same distribution of sentence lengths and the same low-perplexity word choices. The fingerprint is in the distribution, not the order.

**What to do instead:** Combine and split sentences to engineer burstiness. Cut entire sentences that don't earn their place. Restructure paragraph boundaries, not sentence order within them.

## 3. Adding filler sentences

**The bad advice:** Pad the text with extra sentences to make it look more elaborated.

**Why it fails:** Filler sentences are maximally predictable — exactly the kind of low-perplexity content that drags the average *further* down. More text means more surface area for fingerprint signals. Detection risk increases, not decreases.

**What to do instead:** Cut 20–40% of the existing text. Every cut sentence raises the average information density of what remains.

## 4. Abstract "human tone" prompts

**The bad advice:** Prompt the model with "write in a human tone" or "make this sound conversational" and accept the output.

**Why it fails:** Adjective-only style instructions produce marginal change. The model has a strong default style and abstract direction barely deflects it. The research showed up to 23.5× improvement when concrete writing samples were provided instead of zero-shot tone descriptions.

**What to do instead:** Build a voice profile from samples (Phase 1). When samples aren't available, derive a profile from persona+audience and apply it through the variant recipes — concrete style directives, not adjectives.

## 5. Single-pass humanizer tools

**The bad advice:** Pipe the AI draft through a humanizer tool and ship the output.

**Why it fails:** These tools target the statistical distribution but cannot inject experience, opinion, or named specifics. They produce text with slightly higher perplexity and burstiness that still has no stake, no lived context, and no judgment. The fingerprint is statistically reduced; the underlying emptiness is unchanged.

**What to do instead:** Manual editorial pass first (Phase 3 substance + Phase 4 layers 1–3). If you want to use a tool, use it as a final statistical cleanup pass *after* you've added substance and voice — not as a replacement for them.

## 6. Faking messiness

**The bad advice:** Add typos, drop apostrophes, throw in random contractions, write fragments at random.

**Why it fails:** Typos read as typos, not authenticity. Random fragments break readability without adding voice. The result is, in the research's phrasing, "a ransom note with Grammarly disabled" — clearly worse, not more human. Real human writing exhibits *controlled* irregularity: deliberate fragments that emphasize a point, contractions that fit the register, sentence-length variation tied to information density.

**What to do instead:** Engineered burstiness (specific rule: no 3 consecutive sentences within ±20% length; after two long, write one ≤4 words). Logic-bearing transitions instead of mechanical connectors. Contractions only where the register supports them. Belief-shifts and emotional-register insertions where consistent with the persona.

## How to handle user requests for these

Refuse politely, explain the reason briefly, and offer the correct alternative. Example:

> User: "Just swap out the AI words with synonyms — that should be enough."
>
> Response: "Synonym swap alone won't help — synonyms share probability with what they replace, so the statistical fingerprint stays. I'll do the full structural pass plus vocabulary work together; that's what the research shows actually moves the needle. Starting Phase 1 now."

The skill must not silently comply with these requests, because doing so would deliver a worse outcome than declining.

## What partial techniques *are* useful

Some of the items above are useful **as components of a multi-pass workflow**, just not as standalone fixes. The skill uses them in their proper place:

- **Synonym swap** — used in Phase 4 Layer 2 *after* Layer 1 structural rewrite.
- **Sentence reordering** — happens implicitly in Layer 1 when restructuring for the chosen template.
- **Tool-based statistical cleanup** — could be a final pass after the human edit (Phase 7), not a replacement for it. Out of scope for this skill, which is editorial.

The error in the bad advice isn't the technique itself. It's treating the technique as sufficient.
