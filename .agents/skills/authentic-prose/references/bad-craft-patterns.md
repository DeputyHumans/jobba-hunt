# Bad craft patterns — what doesn't work, and why

Techniques widely sold as "humanizing" that the research documents as ineffective *as standalone
fixes*. This file is about **craft efficacy**, not ethics (those refusals live in
`ethical-refusals.md`). When a user asks for one of these, decline the *standalone* version and
offer the real work.

> Currency note (2025–2026): the original case against several of these rested on a *statistical*
> premise (low perplexity/burstiness as detector signals). That premise has weakened — surface
> stats are no longer reliable discriminators for frontier models. The techniques below still fail,
> but mostly for a simpler reason: **they rearrange the surface without adding specificity, judgment,
> or reader-fit.** Empty text, restyled, is still empty.

## 1. Synonym swapping alone
Replacing `leverage`→`utilize` changes nothing structural and little semantically; the prose stays
generic. **Do instead:** fix structure and meaning first; treat vocabulary as a finishing pass, and
keep accurate, in-voice words even if they're "AI-associated."

## 2. Sentence reordering alone
Shuffling sentences preserves the same generic register and weak claims. **Do instead:** combine/split
for emphasis, cut sentences that don't earn their place, restructure paragraphs around a reader-first
template (`structures.md`).

## 3. Adding filler sentences
Padding lowers information density — the opposite of authored prose. **Do instead:** cut 20–40%; every
removed sentence raises the density of what remains.

## 4. Abstract "human tone" prompts
"Write conversationally / make it human" barely deflects a model's default style. **Do instead:** build
a voice profile from *samples* (`voice-profile.md`); few-shot examples beat adjective descriptions.

## 5. Single-pass "humanizer" tools
They target a surface distribution and cannot add stake, judgment, or specifics. They also tend to push
text toward a generic center, which can read *more* synthetic. **Do instead:** the multi-pass editorial
work here, with real substance from the user. Don't pipe good human text through a humanizer — heavy
editing of already-good prose usually makes it worse.

## 6. Faking messiness
Typos, dropped apostrophes, random fragments read as sloppiness, not authenticity ("a ransom note with
Grammarly disabled"). **Do instead:** controlled, meaning-driven rhythm variation; contractions only
where the register supports them; genuine (user-supplied) emotional register.

## The meta-point
Each technique is a *component* in its proper place (vocabulary work after a structural pass; reordering
implicit in restructuring; a statistical-cleanup tool only after real substance is added). The error is
treating any one as **sufficient**. The actual lever is substance + judgment + reader-fit + restraint —
not surface manipulation, and never detector evasion.
