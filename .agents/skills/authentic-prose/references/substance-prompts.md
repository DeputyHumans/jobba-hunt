# Substance prompts (the targeted-question library)

When substance is thin, ask at most 2 questions by default (≤3 in deep-voice-match), each tied to a
specific passage — never abstract ("got any examples?"). Show a quick value-first baseline before asking.

Core principle: **the user can supply substance the model cannot honestly invent.** Everything elicited
here becomes `USER_FACT` and may unlock Layer 3; anything the user can't supply stays a flagged gap, never
filled. Make declining easy and its consequence clear.

## Gap categories and templates

### Specificity gap (vague claims, abstract nouns)
> "Paragraph [N] says '[exact phrase].' Replace with one concrete workflow plus before/after time, or one
> named outcome. If you don't have one, say so — we won't invent."

> "'Increased efficiency' appears in [N] places. Is there a real number for any of them, or should we strip
> the claim back to honest qualitative language?"

### Judgment gap (no position taken)
Use the **opinion-accountability formula** — but only render it if the belief is genuinely the user's:
> "The piece avoids a position on [X]. Do *you* actually believe [Y]? If yes, fill in: I believe **[claim]**
> because **[evidence]**. This matters because **[consequence to the reader]**. You can test it by **[method]**.
> If you'd rather stay descriptive, say so — we'll keep it that way and not manufacture a stance."

### Belief-shift gap
> "Strong writing often shows a real shift — 'I used to think X, I don't anymore.' Is there a genuine shift in
> *your* thinking here? When did it happen, what changed your mind? (Only if it's real.)"

### Audience gap
> "Who exactly is the audience? 'Business leaders' is too generic. Mid-market CEOs? Senior infra engineers at
> Series B+? In-house compliance officers? The more specific, the better the fit."

### Anecdote / temporal-anchor gap
> "Is there a real anecdote or dated event we can anchor [the opener / para N] to — when, who, what happened,
> the result? If not, we keep it abstract. Never invented."

### Emotional-register gap (flat positivity)
> "The piece is uniformly upbeat. Is there honest skepticism, frustration, or doubt that genuinely belongs?
> We'll insert only what you confirm is real — not manufacture it."

### Counterpoint gap
> "What's the strongest objection a thoughtful reader would raise against [the main claim]? Acknowledging it
> makes the piece read like someone who's actually argued this."

### Implied-authority gap
> "The piece implies first-hand experience with [X]. Is that genuine? If yes, the most concrete example you can
> attribute? If no, we'll rephrase to remove the implied authority. (Inventing experience is a hard line.)"

## Question-design rules
1. Tie every question to a specific passage. 2. Make declining easy + consequence-clear. 3. Cap at 2 (≤3 deep).
4. Pick gaps that move multiple SHARP dimensions. 5. Batch all questions in one message. 6. Acknowledge declines
explicitly in the audit ("user declined to supply X — passage flagged substance-thin"), never silently fill.

## Opinion-accountability formula (canonical)
> **I believe [claim] because [evidence]. This matters because [consequence]. You can test it by [method].**

Render it only from the user's supplied belief + evidence. Worked example — user supplied: claim "AI copilots
fail without workflow ownership"; evidence "usage spikes launch week then collapses"; consequence "tools bought
as 'transformation' become abandoned line items"; test "measure repeat usage at day 30." →
> *"I believe AI copilots fail when they're deployed without workflow ownership. Usage spikes during launch
> week, then collapses once employees realize the tool doesn't fit their job. That matters because tools bought
> as 'transformation' end up as line items in next year's budget review. Test it by measuring repeat usage at
> day 30 — not demo enthusiasm at day 1."*

## When the user provides nothing
Proceed with mechanical/structural refinement only and state it honestly:
> *"Substance was not supplied for [gaps]. The revision improves structure and clarity but stays substance-thin;
> Specificity, Judgment, and Trust can't rise without real specifics from you. To improve, supply: [list]."*

The skill cannot substitute for what only the user knows. It can make empty text read more cleanly while still
being empty — and it must say so.
