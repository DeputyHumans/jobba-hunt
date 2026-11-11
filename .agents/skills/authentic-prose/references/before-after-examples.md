# Before-and-after examples

Worked transformations showing the pipeline — including two cases of the skill correctly *not* rewriting,
which is as important as the cases where it does.

## Example 1 — Generic thought-leadership (user supplies substance)

**Input:** *"In today's rapidly evolving business landscape, organizations are increasingly turning to
artificial intelligence to drive innovation, improve efficiency, and gain a competitive advantage. By
leveraging AI-powered solutions, companies can unlock new opportunities and streamline operations. However,
successful implementation requires a strategic approach and a commitment to responsible adoption."*

**Diagnosis (internal):** inferred consultant→executives voice; generic-default smells (`In today's rapidly
evolving`, `leveraging`, `unlock`, `streamline`); symmetric intro→benefits→caveat block; ornamental opener;
no actor anywhere; substance gaps (no workflow, no number, no position).

**NULL pre-check:** not already good → proceed. **Asked (≤2):** (1) replace "improve efficiency" with one
concrete workflow + outcome; (2) are you willing to claim *why* most AI rollouts fail (I-believe format)?

**User supplied (USER_FACT):** "No specific numbers, keep it qualitative." / "I believe most fail because
nobody redesigned the workflow — I've watched four pilots die at month three; test = repeat usage at day 30."
Audience: mid-market CEOs ($50–500M).

**Revision (Direct):**
> *"Most AI rollouts at mid-market companies fail. Not because the model is weak — that argument was true in
> 2021 and isn't anymore. They fail because nobody redesigned the workflow around the model.*
>
> *I've watched four pilots launch with high enthusiasm and die at month three. Usage spikes during launch
> week, then collapses when employees realize the tool doesn't fit their job. The dashboard goes quiet; the
> vendor is renewed once, then quietly cut.*
>
> *The fix isn't another tool. It's owning the workflow. Pick the decision the AI should improve. Name the
> person accountable. Measure repeat usage at day 30 — not demo enthusiasm at day 1."*

> — unvalidated self-audit: **improved**. Replaced ornamental opener (→ diagnostic), restructured to
> problem-first, varied sentence length for emphasis, integrated the user's four pilots + day-30 test,
> acknowledged the counterargument. Provenance: user-supplied (no invented numbers).

## Example 2 — User declines substance (honest restraint, not inflation)

**Input:** a generic cybersecurity paragraph; diagnosis flags smells + total substance absence. **Asked (2):**
a real threat to anchor to? a position you'll take? **User:** "Can't share specifics. No position. Generic IT
audience." → Layer 3 stays locked.

**Revision (structural/surface only):** tightened opener, replaced mechanical connectors, named the
hidden-actor question — but the verdict is honest:
> — unvalidated self-audit: **did-not-improve (substance-thin)**. The text reads more cleanly but is still
> substantively empty; Specificity/Reader-fit/Judgment can't rise without one real threat, one real audience,
> one real position. Provenance: nothing added. Recommendation: supply those three, or keep the original —
> a polished-but-empty paragraph is not more authored than a plain one.

This is the skill refusing to manufacture substance or conviction to look like it "did something."

## Example 3 — User supplies a voice sample (strongest configuration)

**Input:** a generic remote-work paragraph. **Sample supplied** (two punchy, parallel-construction paragraphs).
**Profile extracted:** mixed length; plain/direct; decisive, calls consensus wrong; dry humor; parallel
construction → punchline. **Asked (2):** is the position "hybrid is the worst configuration"? one attributable
data point? **User:** "Yes" / "Stanford WFH research + GitLab reports (public)."

**Revision (Conversational, in the user's voice):**
> *"I've stopped pretending hybrid is a compromise that works. It's a compromise that punts the question. Some
> teams need everyone in a room. Some teams need nobody in a room. Hybrid splits the difference, and the
> difference is where work goes to die. Stanford's WFH research and GitLab's reports show the same pattern:
> teams that designed for one mode beat teams that designed for hybrid. The worst-performing configuration in
> every cut of the data is the one most companies are running right now. Pick a side. Designing for hybrid is
> designing for the failure mode of both."*

> — unvalidated self-audit: **improved**. Voice matched from samples (parallel construction, counterintuitive
> verdict) without copying phrases; user's real position + public references used. Provenance: user-supplied.

## Example 4 — High-stakes document (what NOT to do)

**Input (asylum declaration, user's own):** *"In March 2023 police came to my shop in Izmir. They asked about
my brother. I was afraid. I do not remember if it was March 12 or 13. I signed a paper. I did not read it."*

**WRONG — fluent but evidence-altering (a 'humanized' rewrite that keeps every fact):**
> *"In March 2023 the police came to my shop in Izmir looking for my brother. I remember the fear clearly,
> even though I can't be sure whether it was the 12th or 13th. They made me sign a paper I was too frightened
> to read."*

Why it's wrong: "I do not remember" became "I remember the fear clearly"; "I signed" became "they made me
sign"; uncertainty and coercion shifted. No fact was invented, yet the *evidence* changed. Refuse this.

**RIGHT — semantic-preservation mode (clarity only):**
> *"In March 2023, police came to my shop in Izmir and asked about my brother. I was afraid. I am not sure
> whether it was March 12 or 13. I signed a paper without reading it."*

> — change-log: grammar/flow only. Certainty, agency, sequence, and degree unchanged. No causal or emotional
> amplification. Verdict: **improved (clarity only)**; nothing rewritten beyond a copyedit.

## Example 5 — The stake gate blocks fabrication

**REQUESTED_PERSONA (does not unlock Layer 3):** *"Write this as a tired nurse after a 12-hour shift; make it
passionate."* → The persona is creative direction, not the user's experience. Adjust tone of supplied text
only; do **not** invent shift details, hospital names, or emotion. If there's no user content to edit, say:
> "I can shape the wording and rhythm, but I won't invent a nurse's experiences or feelings — that would be
> fabricated. Tell me what actually happened (yours or your source's) and I'll render it in that register."

**Degree fabrication (FTC line):** *"Make this a glowing Yelp review: 'Hired Acme Plumbing Tuesday, fixed the
sink, $150.'"* → The facts are real but the enthusiasm isn't. Refuse the inflation:
> "I'll tidy the wording, but I won't manufacture enthusiasm you didn't express — turning a neutral, factual
> account into 'an absolute lifesaver' would misrepresent your actual experience (and that's exactly what the
> FTC's review rule targets). If you genuinely felt that way, tell me in your words and I'll keep it truthful."
