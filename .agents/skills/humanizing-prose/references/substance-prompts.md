# Substance prompts (Phase 3 question library)

In Phase 3, pick at most 5 questions targeting the highest-leverage substance gaps from the diagnostic. Each question must be tied to a specific passage in the input — no abstract requests like "can you give me a personal story?"

The principle: **the user can supply substance the model cannot honestly invent.** When the user can't or won't, flag the gap rather than fabricate.

## Gap categories and templates

### Specificity gap (vague claims, abstract nouns)

Triggered when the diagnostic flags claims like "AI improves efficiency" or abstract nouns like "transformation," "optimization."

Templates:

> "Paragraph [N] says '[exact phrase].' Replace with one concrete workflow plus before/after time, or one named outcome. If you don't have one, say so — we won't invent."

> "The phrase 'increased efficiency' appears in [N] places. Is there a real number — minutes saved, percentage improvement, dollars — for any of these, or should we strip the claim back to honest qualitative language?"

> "Paragraph [N] mentions '[abstract noun: e.g., transformation].' What did this look like operationally — what changed, who did it, how long did it take?"

### Judgment gap (no position taken)

Triggered when the diagnostic flags neutral summaries, AI-style hedges (`may help`, `can offer`), or absence of claims.

Templates (use the **opinion-accountability formula**):

> "The piece avoids taking a position on [X]. Are you willing to claim [Y]? If yes, fill in this template:
> - I believe **[your claim]**
> - because **[your evidence]**
> - This matters because **[the consequence to your reader]**
> - You can test it by **[a method or metric they could check]**
>
> If you'd rather stay descriptive, say so and we'll keep it that way — but the piece will score lower on Judgment."

> "Section [N] presents both sides without a verdict. Do you have a verdict? If so, what — and what's the strongest counterpoint you can survive?"

### Belief-shift gap (no movement of thought)

Triggered when the piece reads as a single, static, monotonal claim.

Template:

> "Strong human writing often shows a shift in belief — 'I used to think X, I don't anymore.' Is there a real shift in your thinking on this topic? If so, when did it happen, what changed your mind, and what's the contrast you'd draw between the old view and the current one?"

### Audience gap (generic reader)

Triggered when the diagnostic flags generic audience language, no use of reader-specific vocabulary, or absence of named audience in voice profile.

Template:

> "Who exactly is the audience? 'Business leaders' is too generic to write to. Pick the most specific defensible answer:
> - Mid-market CEOs?
> - Senior infrastructure engineers at Series B+ companies?
> - In-house compliance officers in regulated industries?
> - First-time founders preparing for seed?
>
> The more specific, the better the variants will fit."

### Anecdote / temporal-anchor gap (no concrete situations)

Triggered when the diagnostic flags absence of named situations, dates, or first-person experience.

Template:

> "Is there a real anecdote, dated event, or named situation we can anchor [the opener / paragraph N] to? Even one short example: when, who, what specifically happened, what was the result. If not, we'll keep it abstract — never invent."

> "The piece would be sharper with a temporal anchor — 'when we were scaling our infra in early 2024' or 'after the [specific event] changed the conversation.' Do you have one to offer?"

### Emotional-register gap (flat positivity)

Triggered when the diagnostic flags absence of skepticism, frustration, vulnerability, or any negative-valence affect.

Template:

> "The piece is uniformly upbeat. Real writing on substantive topics usually shows some genuine skepticism, frustration, or doubt. Is there honest critique, exasperation, or admitted uncertainty that belongs in this piece? (We won't manufacture it — only insert what you confirm is genuine.)"

### Counterpoint gap (no concession or pushback handled)

Triggered when the piece presents a claim without acknowledging the strongest counterargument.

Template:

> "What's the strongest objection a thoughtful reader would raise against [the main claim]? You don't have to refute it — but acknowledging it makes the piece feel like it was written by someone who's actually argued this position with smart skeptics."

### Substance source gap (claim with implied authority)

Triggered when the piece implies expertise or first-hand experience that the user may or may not have.

Template:

> "The piece implies first-hand experience with [X]. Is that experience genuine? If yes — what's the most concrete example you can attribute? If no — we'll rephrase to remove the implied authority. (Inventing experience is a hard line we won't cross.)"

## Question-design rules

Apply these to every question you write:

1. **Tie to a specific passage.** Reference the paragraph number or quoted phrase. Never ask abstract questions like "do you have any examples?"
2. **Make declining easy and consequence-clear.** Always include "if you don't have one, say so — we won't invent" or equivalent. The user should never feel pushed to fabricate.
3. **Cap at 5.** More than 5 turns Phase 3 into an interrogation and produces lower-quality answers.
4. **Pick the highest-leverage gaps.** Substance gaps that affect multiple SHARP dimensions (Specificity + Judgment + Trust together) beat single-dimension ones.
5. **Batch the questions.** Send all of Phase 3's questions in one message, not as a back-and-forth. The user can answer them in one response.
6. **Acknowledge declines.** When the user declines a question, say so explicitly in the diagnostic ("user declined to supply X — passage flagged as substance-thin") rather than silently dropping the gap.

## Opinion-accountability formula (referenced from SKILL.md)

The canonical template for converting a vague gesture into a defensible claim:

> **I believe [claim] because [evidence]. This matters because [consequence to the reader]. You can test it by [method].**

Worked example. The user originally wrote: *"AI may offer benefits for organizations seeking to improve operations."*

After Phase 3 elicitation, the user supplied:
- Claim: AI copilots fail without workflow ownership
- Evidence: Usage spikes during launch week, then collapses
- Consequence: Tools bought as "transformation" become abandoned line items in next year's budget review
- Test: Measure repeat usage at day 30, not demo enthusiasm at day 1

Phase 4 Layer 3 renders this as:

> *"I believe AI copilots fail when they're deployed without workflow ownership. Usage spikes during launch week, then collapses once employees realize the tool doesn't fit their actual job. That matters because tools bought as 'transformation' end up as line items in next year's budget review. Test it by measuring repeat usage at day 30 — not demo enthusiasm at day 1."*

## When the user provides nothing

If the user declines all Phase 3 questions or has no substance to add, proceed with mechanical refinement only. The diagnostic must explicitly note:

> *"Substance was not supplied for [list of gaps]. The variants below address the statistical fingerprint and structural issues but cannot raise above ~24/40 on Specificity, Judgment, and Trust without real specifics from the author. To improve further, supply: [the list]."*

This is honest. The skill cannot substitute for what only the user knows. It can produce text that is statistically closer to human writing while being substantively just as empty as the input — and it must say so.
