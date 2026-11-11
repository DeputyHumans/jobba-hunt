---
title: Review Guide, Tailored CV and Letter
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: Review
tags: [review, tailored-cv, cover-letter]
---

# Review: <Role> at <Company>

<!-- What the operator is shown when a tailored set waits for review (docs/tailoring.md). `npm run tailor -- review --job <id>` publishes the CV and the letter each as its own private bikeshed document in the Reviews folder, titled "Review · <company> · <role> · CV" and "... · cover letter". The documents are the real renderings, unchanged, so a comment on a passage anchors to that passage. This guide goes into the push notification, the tracker's "Needs you" card and, with publisher local, the session question. -->

| Item | Value |
|---|---|
| Role | <title> @ <company> · tier <A/B> <score> · <lane> |
| Posting | <url> · job id <id> · fetched <detail.fetched_at> |
| Channel | <Easy Apply / ATS / site> · auto-apply eligible: <yes, waits only on this approval / no, also needs "Apply"> |
| Coverage | <x>% of the frozen terms after round <n> of `preferences.tailoring.max_rounds` · best archetype baseline `<slug>`: <y>% |
| Honest gaps | <terms the claims cannot cover; never patched in> |
| CV document | <bikeshed URL> |
| Letter document | <bikeshed URL> |

## What to check

- [ ] Every line is true as written, and rests on a confirmed claim (`npm run tailor -- status --job <id>` and the draft list the claim IDs).
- [ ] Nothing overstates a claim (claim bank, Do-not-say column).
- [ ] The CV names no target company. The letter names it only in its header and greeting.
- [ ] The letter quotes the posting verbatim, and each answer fits its ask.
- [ ] The ramp-up line names the real gaps, and only those.
- [ ] The voice reads as the operator's (`profile/voice.md`).
- [ ] The CV fits `preferences.cv.pages` pages and the letter one page.

## How to respond

Comment on the passage itself in either document, or on its title for the whole document. Each comment is processed as soon as `npm run watch` reports it.

| Comment | What happens |
|---|---|
| `approve` | `npm run triage -- approve-docs --id <id> --note "<the operator's words>"`, reply, resolve. An auto-apply-eligible role then goes out; any other role still needs its "Apply" |
| `Apply` | The documents and the role are approved together, then the apply runner submits |
| A change on a passage ("shorter", "lead with the platform work", "drop this row") | Redrafted from the claim bank, measured, rebuilt, and `review` run again: the same documents are updated. Reply names what changed, then resolve |
| A change that needs a fact the bank does not hold | The agent asks for the source and the wording. The fact enters the bank as a pending claim, and is used only after the operator confirms it |
| `use archetype` | The best archetype share CV and a requirements-map letter replace the tailored set |
| `skip` | The role is recorded as skip; nothing is sent |
| A thread with no text yet | Left open: the operator is still typing |
