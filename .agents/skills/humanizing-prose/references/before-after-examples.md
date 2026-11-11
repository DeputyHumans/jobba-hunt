# Before-and-after examples

Three worked transformations showing the full pipeline. Each example has the original AI-flavored draft, the diagnostic, the substance the user supplied (or didn't), and the resulting variant with rubric score.

These are not templates to copy — they are illustrations of the workflow producing recognizably better text.

## Example 1 — Generic AI thought-leadership post

### Input

> *"In today's rapidly evolving business landscape, organizations are increasingly turning to artificial intelligence to drive innovation, improve efficiency, and gain a competitive advantage. By leveraging AI-powered solutions, companies can unlock new opportunities, streamline operations, and enhance decision-making across departments. However, successful implementation requires a strategic approach, cross-functional alignment, and a commitment to responsible adoption."*

### Diagnostic
- **Voice profile:** Inferred — consultant writing for executives. (No samples provided.)
- **Fingerprint hits:** `In today's rapidly evolving landscape` · `leveraging` · `unlock` · `streamline` · `enhance` · `cross-functional alignment` · `responsible adoption`.
- **Burstiness:** all three sentences within 30–35 word range — violation.
- **Structural issues:** symmetric `intro → benefits → caveat` block. Buried lede. Ornamental opener. No specific actor anywhere.
- **Substance gaps:** no concrete workflow. No numbers. No named outcome. No author position. No counterargument handled.

### Phase 3 questions asked (5)
1. Replace "improve efficiency" with one concrete workflow + before/after time.
2. Are you willing to claim a specific position about why most AI initiatives fail? Use the I-believe-X-because-Y format.
3. Who exactly is the audience — mid-market CEOs, enterprise CIOs, founders?
4. Is there an anecdote we can anchor the opener to?
5. What's the strongest counterargument to your position?

### User responses (representative)
1. *"Honestly no, I don't have specific numbers. Keep it qualitative."*
2. *"I believe most AI rollouts fail because nobody redesigned the workflow. Evidence: I've watched four pilots launch with high enthusiasm and die at month three. Test: measure repeat usage at day 30."*
3. *"Mid-market CEOs at companies between $50M and $500M revenue."*
4. *"No anecdote — keep it abstract."*
5. *"Counter is 'the tech is the bottleneck.' I think that's almost never true at this stage of model maturity."*

### Variant — Direct (score: 32/40)

> *"Most AI rollouts at mid-market companies fail. Not because the model is weak — that argument was true in 2021 and isn't anymore. They fail because nobody redesigned the workflow around the model.*
>
> *I've watched four pilots launch with high enthusiasm and die at month three. The pattern is consistent: usage spikes during launch week, then collapses when employees realize the tool doesn't fit their actual job. The dashboard goes quiet. The vendor is renewed once, then quietly cut.*
>
> *The fix isn't another tool. It's owning the workflow. Pick the decision the AI is supposed to improve. Name the person accountable for the change. Measure repeat usage at day 30 — not demo enthusiasm at day 1. If the workflow didn't change, the AI didn't help."*

**Rubric:** Specificity 4 · Voice 4 · Judgment 5 · Usefulness 4 · Rhythm 4 · Trust 4 · Reader fit 4 · Originality 3
**Total: 32/40**

### What changed
- Opener replaced (ornamental → diagnostic).
- Symmetric blocks restructured (problem-first template).
- Burstiness engineered: sentence lengths now span 6–35 words across the piece.
- All blacklist hits purged.
- User-supplied substance integrated (the four pilots, the day-30 test).
- Counterargument acknowledged ("that argument was true in 2021 and isn't anymore").
- Audience reflected in vocabulary ("mid-market," "renewed once").

## Example 2 — User declines all substance questions

### Input

> *"Cybersecurity has become a critical concern for businesses of all sizes. Companies must implement comprehensive security strategies to protect their data and infrastructure. By leveraging cutting-edge tools and frameworks, organizations can mitigate risks and ensure operational continuity."*

### Diagnostic
- **Voice profile:** Inferred — security consultant writing for IT decision-makers.
- **Fingerprint hits:** `critical concern` · `comprehensive` · `leveraging cutting-edge tools` · `mitigate risks` · `operational continuity`.
- **Burstiness:** three sentences within ~25–30 word range — violation.
- **Substance gaps:** no specifics, no claim, no audience, no counterargument.

### Phase 3 questions asked (3)
1. What's a real specific threat or workflow you'd anchor this to?
2. Are you willing to claim a position?
3. Who's the audience?

### User responses
1. *"No, I can't share specifics."*
2. *"No position — keep it neutral."*
3. *"Just a generic IT audience."*

### Variant — Direct (score: 22/40)

> *"Cybersecurity matters now more than it did five years ago. Attack volume is up; attacker sophistication is up; the cost per breach is up.*
>
> *Most companies respond by buying more tools. That helps less than the marketing suggests. Tools layered onto unclear ownership produce alerts nobody owns and dashboards nobody watches.*
>
> *The honest baseline question is simpler. Who, by name, is responsible for closing each class of alert? Until that question has an answer, no tool will close the gap."*

**Rubric:** Specificity 2 · Voice 3 · Judgment 3 · Usefulness 3 · Rhythm 3 · Trust 3 · Reader fit 2 · Originality 3
**Total: 22/40 — would not ship**

### Diagnostic note
> *"Substance was not supplied for any of the three Phase 3 questions. The variant above addresses the statistical fingerprint and structural issues but stays substance-thin. Specificity, Reader fit, and Voice are below the publishable threshold. To improve: name an actual threat (one), pick an actual audience (one), and take an actual position (one). Without these, no further refinement will raise the score."*

This is what the skill correctly does when the user can't or won't supply substance. The output is honestly graded; the user is told what would lift it.

## Example 3 — User supplies a sample for voice mirroring

### Input

> *"Remote work has transformed how teams collaborate, requiring new approaches to communication, project management, and team building. Organizations that fail to adapt risk losing talent and productivity in this new paradigm."*

### Voice samples supplied

> *"I've stopped pretending hybrid is a compromise that works. It's a compromise that punts the question. Some teams need everyone in a room. Some teams need nobody in a room. Hybrid splits the difference and the difference is where work goes to die."*
>
> *"Three years in, the data is clear: fully remote teams that designed for remote outperform hybrid teams. Hybrid teams that designed for in-person outperform hybrid teams that designed for remote. The worst-performing configuration in every cut of the data is the one most companies are running right now."*

### Voice profile extracted
- **Sentence length:** mixed; willing to elaborate when carrying tradeoffs; punchy when stating a verdict.
- **Vocabulary:** plain, direct; no buzzwords. Uses casual constructions ("punts the question").
- **Attitude:** decisive; willing to call current consensus wrong.
- **Humor:** dry, occasional ("where work goes to die").
- **Claims:** strong; defended with implicit data references.
- **Rhythm:** claim → evidence → verdict; uses repetition for emphasis ("Some teams need... some teams need...").
- **Banned:** "transformed," "paradigm," "leveraging," "ecosystem."
- **Characteristic moves:** Stating-the-counterintuitive-finding ("the worst-performing configuration is the one most companies are running"). Using parallel construction to set up a punchline.

### Phase 3 questions asked (2)
1. Is the position you want this piece to take "hybrid is the worst configuration," or something different?
2. Do you have one named example or specific data point you can attribute?

### User responses
1. *"Yes, that's the position. Hybrid is structurally bad."*
2. *"No proprietary data, but I'll cite the publicly known pattern from the WFH research at Stanford and the GitLab annual reports."*

### Variant — Conversational, in user's voice (score: 35/40)

> *"I've stopped pretending hybrid is a compromise that works. It's a compromise that punts the question.*
>
> *Some teams need everyone in a room. Some teams need nobody in a room. Hybrid splits the difference, and the difference is where work goes to die.*
>
> *The data is clear if you actually look. Stanford's WFH research and GitLab's annual reports both show the same pattern: fully remote teams that designed for remote outperform hybrid teams. Fully in-person teams that designed for in-person outperform hybrid teams. The worst-performing configuration in every cut of the data is the one most companies are running right now.*
>
> *The honest move is to pick a side. Build for one or build for the other. Designing for hybrid is designing for the failure mode of both."*

**Rubric:** Specificity 4 · Voice 5 · Judgment 5 · Usefulness 4 · Rhythm 5 · Trust 4 · Reader fit 4 · Originality 4
**Total: 35/40 — strong**

### What changed
- Voice profile extracted from samples and applied throughout.
- Original AI hedge ("requires new approaches," "risk losing talent") removed entirely.
- User's actual position stated and defended.
- Characteristic moves from the sample (parallel construction, counterintuitive verdict) replicated structurally without copying exact phrases.
- Rubric Voice score is 5 because a reader familiar with the user's writing would recognize this as theirs.

This is the highest-leverage configuration of the skill: voice samples + clear user position + concrete references = high publishable score.
