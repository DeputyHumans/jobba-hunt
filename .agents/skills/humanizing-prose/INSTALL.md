# Install and invoke `humanizing-prose` across tools

The bundle is self-contained Markdown. No scripts, no dependencies, no external HTTP at runtime. Copy the directory into the right place for your tool, then invoke.

## Bundle contents (what to copy)

```
humanizing-prose/
├── SKILL.md
├── INSTALL.md         (this file — optional in deployments)
└── references/
    ├── ai-fingerprint-blacklist.md
    ├── anti-patterns.md
    ├── rubric.md
    ├── structures.md
    ├── voice-profile.md
    ├── substance-prompts.md
    ├── variant-recipes.md
    └── before-after-examples.md
```

## Skill-tool environments (native install)

These tools have a first-class `Skill` (or equivalent) tool that loads `SKILL.md` and lets the model read the references on demand. Native install is the preferred deployment.

### Claude Code

- **Project-scoped:** `cp -r humanizing-prose .claude/skills/`
- **User-scoped (all projects):** `cp -r humanizing-prose ~/.claude/skills/`
- **Invoke:** type `/humanizing-prose` or describe the task ("humanize this text") and the model will auto-trigger via the `Skill` tool.

### Anthropic Claude Agent SDK / Managed Agents

- Mount the bundle as a skill directory in your agent configuration.
- Same `SKILL.md` + `references/` layout works without changes.

### Copilot CLI (GitHub Copilot CLI)

- Install as a plugin skill — auto-discovered when placed in the configured skills directory.
- Invoked via the `skill` tool, analogous to Claude Code's `Skill` tool.
- Tool name mapping (Read/Edit/Bash etc.) is provided by the host; the skill body uses no tool names directly so no adaptation is needed.

### Gemini CLI

- Place the bundle in the configured skills directory.
- Gemini loads metadata at session start and activates the full skill on demand via the `activate_skill` tool.
- The skill body is plain Markdown — Gemini reads it directly.

## Editor-integrated tools (rule-style adaptation)

These tools don't have a Skill tool but do have a "rules" or "workflows" mechanism that injects content into the system prompt. The skill works there with one transformation: concatenate the references into the rule body, since rules are typically self-contained single files.

### Cursor

1. Create `.cursor/rules/humanizing-prose.mdc`
2. Paste the contents of `SKILL.md` at the top
3. Append each `references/*.md` file in sequence under headers like `## Reference: ai-fingerprint-blacklist`
4. Cursor will load the rule into context when matched

### Windsurf

- Same pattern as Cursor: paste `SKILL.md` plus concatenated references as a Workflow or Rule.
- Trigger via `@humanizing-prose` mention or workflow invocation.

## Generic LLM environments (manual install)

For any environment without a skills mechanism — paste the bundle into the system prompt.

### Claude API / OpenAI API / any chat completion endpoint

1. Concatenate `SKILL.md` plus all `references/*.md` into a single string.
2. Use as the system prompt.
3. Wrap with a one-line trigger: *"When the user asks to humanize, refine, or de-AI-ify text, follow the workflow below."*
4. Caveat: the full bundle is large. On long user inputs you may exceed context budget. See **Slim mode** below.

### ChatGPT custom GPT

- Paste `SKILL.md` into the GPT's instructions field.
- Upload each `references/*.md` to the GPT's knowledge base.
- The GPT's retrieval will pull references into context when the workflow phases call for them.

### Claude Project

- Paste `SKILL.md` content into the Project's custom instructions.
- Add each `references/*.md` to the Project knowledge.
- Claude will consult them as the workflow indicates.

## Slim mode (tight context budgets)

If the full bundle is too large for a target environment, ship only:

- `SKILL.md`
- `references/ai-fingerprint-blacklist.md`
- `references/rubric.md`

The skill detects this and operates in slim mode: one **Direct** variant, full diagnostic, full rubric. Other variants and the structures/voice-profile/substance-prompts/variant-recipes references are skipped. The output explicitly notes slim mode.

## Verifying install

After install, paste this AI-flavored test paragraph and invoke the skill:

> *"In today's rapidly evolving business landscape, organizations are increasingly leveraging AI-powered solutions to drive transformative outcomes. By embracing comprehensive strategies, companies can unlock significant value across multiple business functions. Furthermore, this enables seamless integration of cutting-edge capabilities."*

A correctly installed skill will:

1. Run mode detection (you pasted text → refine-input).
2. Ask 1–3 voice-profile questions, batched.
3. Run a diagnostic that catches at least: `In today's rapidly evolving`, `leveraging`, `transformative`, `comprehensive`, `unlock`, `Furthermore`, `seamless`, `cutting-edge`. It should also flag the symmetric block structure and the absence of any concrete substance.
4. Ask up to 5 targeted substance questions.
5. Produce 3 variants with rubric scores.

If any of the above is missing, the skill is not fully loaded. Common causes: missing `references/` folder, references not added to the project knowledge base, or context budget truncation (use slim mode).

## What this skill will refuse

- Adding typos or sloppy grammar to "look human"
- Pure synonym swapping
- Sentence reordering as a standalone fix
- Anything framed as detector evasion
- Fabricating numbers, anecdotes, or attributions

These refusals are encoded in `SKILL.md` Non-negotiables and `references/anti-patterns.md`. They are not adjustable in deployment — they reflect what the underlying research documents as ineffective or unethical.
