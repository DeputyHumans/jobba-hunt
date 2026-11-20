---
name: hunt-browser
description: "Use under the chrome driver (workspace/config/browser.json driver chrome) whenever a hunt command needs a page: a tick, sweep, probe, the jobs or dice reader, or an apply. Starts the command through npm run browser -- start, serves each request it writes with the Claude in Chrome tools, exactly as the request's steps say, and reads the command's own exit code and JSON when it ends. Never acts in the browser outside a request."
---

# /hunt-browser

Run from the repo root. Read `AGENTS.md` first. The mechanism: `docs/adapters.md` "Browser bridge"; the tool facts behind it: `docs/platforms.md` "Claude in Chrome tool facts".

## Before the first request of a firing
Call `tabs_context_mcp` with `createIfEmpty: true`. "No browsers are connected" (or the extension not connected): PushNotification "Chrome is not connected: /chrome, then Reconnect extension", and run no browser command this firing.

## Serving a command
1. `npm run -s browser -- start <tick|dice-tick|sweep|probe|jobs|dice|apply> -- <the command's args>` (Bash timeout 300000).
2. Read the exit code:

| Exit | Meaning | Do |
|---|---|---|
| 0 | `request`: one page action | Serve it (below), then `npm run -s browser -- done --id <id> … --next` |
| 10 | `done`: the command ended | Read `exit` and `result` as that command's own exit code and JSON (its skill's table) |
| 3 | `waiting`, `idle` or `busy` | `waiting`: `npm run -s browser -- next`. `busy`: another run holds the bridge; serve it to its end first |
| 1 | `done` refused | Do what the error says (write the envelope first, or `--failed`) |

## Serving one request
- **`load` and `eval`:** follow `request.steps` in order, in this session's tab, with the exact inputs they give.
  1. Navigate (a `load` only).
  2. Plant the loader, find "file input labelled jobba loader", and `file_upload` the `script` path into that ref.
  3. Run the read, eval and run snippets as three separate `javascript_tool` calls, never merged: an eval after an await fails under a strict CSP.
  4. `get_page_text`. Write everything from `JOBBA-ENVELOPE` to `JOBBA-END`, exactly as printed, into `respond_to`.
  5. Clear the envelope.
  6. Run `done --id <id> --url <the tab's URL> --next`.
  - Batch the browser steps with `browser_batch` where the next input does not depend on the last output.
- **`act`:** do only what `summary` says, on the element `act.label` names.
  - `click`: click that control once.
  - `type` or `pick`: enter `act.value` in the field `act.label`.
  - `upload`: `find` that file input, then `file_upload` `act.file`.
  - `screenshot`: `computer` screenshot with `save_to_disk`, then `done --screenshot <path>`.
  - `discard`: close the application without sending it.
  - `submit`: press the named button once.
  - Then `done --id <id> --next`, or `done --id <id> --failed "<what happened>" --next` when it could not be done.
- Never retype page code, never edit a copied envelope, never answer a question on a page yourself, never click Submit without a `submit` request.
- A sign-in page, a CAPTCHA or a bot check: never touch it. Run `done --failed "<what is on the page>" --next`; the command hands the role to the operator.
- A JavaScript dialog blocks the extension: tell the operator to dismiss it, then `done --failed "dialog" --next`.

## Never
Act in the browser outside a request; open a link from an email; type a password; create an account; solve a CAPTCHA; retry a request the command did not ask for again.
