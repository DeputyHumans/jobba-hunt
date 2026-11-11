# Install and invoke `authentic-prose` across tools

The bundle is self-contained Markdown plus one optional Python script. No required dependencies, no
external HTTP at runtime. Copy the directory into the right place for your tool, then invoke.

## Bundle contents

```
authentic-prose/
├── SKILL.md
├── INSTALL.md                  (this file — optional in deployments)
├── references/
│   ├── model-default-smells.md     (dated quality heuristics; NOT a detector)
│   ├── ethical-refusals.md         (misuse/refusal policy + stake gate + high-stakes mode)
│   ├── bad-craft-patterns.md       (techniques that don't work, and why)
│   ├── rubric.md                   (honest audit: labeled self-audit + NULL verdict + opt-in graders)
│   ├── structures.md               (reader-first templates, opener/ending taxonomies)
│   ├── voice-profile.md            (voice elicitation + analysis)
│   ├── substance-prompts.md        (targeted question library)
│   ├── variant-recipes.md          (opt-in register variants)
│   ├── before-after-examples.md    (worked examples incl. high-stakes + stake-gate refusals)
│   └── evidence-ledger.md          (MAINTAINER-ONLY; dated claims + staleness rule)
├── scripts/
│   └── metrics.py                  (OPTIONAL diagnostic vector; Claude Code / local only)
└── tests/
    ├── README.md                   (restraint + improvement gates)
    ├── known-good/                 (genuinely good human writing — must be left alone)
    └── known-bad/                  (AI-flavored writing — improvement target)
```

## Skill-tool environments (native install — preferred)

The model loads `SKILL.md` and reads references on demand (progressive disclosure: only `name` +
`description` are always in context; the body loads on activation; references and `scripts/` load only
when read).

- **Claude Code:** project-scoped `cp -r authentic-prose .claude/skills/`; user-scoped
  `cp -r authentic-prose ~/.claude/skills/`. Invoke with `/authentic-prose` or a natural request
  ("make this draft sound less generic / more like me"). `scripts/metrics.py` can run here via the Bash tool.
- **Anthropic Claude Agent SDK / managed agents:** mount the directory as a skill; same layout, no changes.
- **Copilot CLI:** install as a plugin skill (auto-discovered in the configured skills dir); invoked via
  the `skill` tool. The body uses no tool names, so no adaptation is needed.
- **Gemini CLI:** place in the configured skills dir; metadata loads at session start, full skill activates
  on demand via `activate_skill`.

## Editor-integrated tools (rule-style)

Cursor / Windsurf: create a single rule/workflow file, paste `SKILL.md` at the top, then append the
references you want available under headers like `## Reference: model-default-smells`. Keep the spine first.

## Generic LLM environments (manual)

- **Claude/OpenAI/any chat API:** concatenate `SKILL.md` (+ chosen references) as the system prompt; wrap
  with a one-line trigger ("When the user asks to make a draft read more human-authored, follow this").
- **ChatGPT custom GPT / Claude Project:** paste `SKILL.md` into instructions; add references to the
  knowledge base; retrieval pulls them in as the workflow calls for them.

## Code-execution portability (important)

`scripts/metrics.py` is **optional and non-portable** — it runs in Claude Code / local shells but may be
unavailable on claude.ai, the API, or locked-down enterprise setups. The skill is designed to work fully
without it. **If the script cannot run, the skill emits no numeric metrics at all** — qualitative notes
only. It must never present estimated numbers as if measured.

## Degradation ladder (slim → full)

The skill states which capability tier it used. Each tier needs only what's present:

1. **`SKILL.md` only** — misuse gate, mode routing, stake gate, high-stakes mode, minimal copyedit + a
   one-line labeled self-audit with a verdict. No smell catalog, no scores, no variants.
2. **+ `rubric.md`** — fuller compact audit + NULL verdict.
3. **+ `model-default-smells.md`** — detailed generic-smell diagnosis (dated; see staleness rule).
4. **+ `voice-profile.md` / `structures.md` / `substance-prompts.md`** — voice matching, structural
   templates, well-formed substance questions.
5. **+ `variant-recipes.md` / `before-after-examples.md`** — multiple register variants; calibration.

If a reference is absent, the skill drops that capability cleanly and says so — it does not improvise the
missing content.

## Verifying install

Paste this and invoke:

> *"In today's rapidly evolving landscape, organizations are increasingly leveraging AI-powered solutions
> to drive transformative outcomes. By embracing comprehensive strategies, companies can unlock significant
> value. Furthermore, this enables seamless integration of cutting-edge capabilities."*

A correct install will: detect `refine-input` mode; run the misuse + NULL pre-check; diagnose generic-default
smells (`In today's rapidly evolving`, `leveraging`, `transformative`, `comprehensive`, `unlock`, `Furthermore`,
`seamless`, `cutting-edge`) **as quality clues, not proof of AI**; ask ≤2 targeted substance questions
value-first; and return one revision with a short `unvalidated self-audit` carrying a verdict — including
the honest result that, with no real substance supplied, it stays substance-thin rather than inventing.

## What this skill refuses

Detector evasion / "make it undetectable" / watermark removal · fake or undisclosed reviews & testimonials ·
manufacturing enthusiasm or conviction the user didn't express · astroturf · impersonation · fabricated
experience/numbers · ghostwriting an academic submission from scratch · adding typos to "look human" · pure
synonym swaps or reordering as standalone fixes. These live in `SKILL.md`, `references/ethical-refusals.md`,
and `references/bad-craft-patterns.md` and are not deployment-adjustable.
