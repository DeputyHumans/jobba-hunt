// Page scripts for the chrome driver (Claude in Chrome). The agent never retypes page code and never
// interprets page data: a script here builds one bundle file per request, the agent uploads it into
// the page (file_upload into a loader input), evaluates it, runs it, and copies the result envelope
// back from get_page_text into a response file. The page hashes its own payload; readEnvelope checks
// that hash, the request id and nonce, and the page's host, so a copy that changed even one character
// is refused. Tool facts behind this design: docs/platforms.md "Claude in Chrome tool facts".
//
// The envelope text is ASCII with no run of spaces (both \u-escaped inside its JSON strings), so a
// page-text reader that normalizes spaces or Unicode cannot change what is hashed. The hash is
// SHA-256 hex in 8-character groups joined by "-": the form the tools let through.

import { createHash } from 'node:crypto';

const START = 'JOBBA-ENVELOPE ';
const END = ' JOBBA-END';

// Shared by Node and the page (inlined into each bundle).
function asciiJson(s) {
  return s.replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    .replace(/ {2,}/g, (m) => '\\u0020'.repeat(m.length));
}

export const dashHash = (text) => createHash('sha256').update(text, 'utf8').digest('hex').match(/.{8}/g).join('-');
export const envelopeText = (env) => `${START}${asciiJson(JSON.stringify(env))}${END}`;

// The agent's steps around a bundle, as javascript_tool code. LOADER_JS plants the visible file input
// (find "file input labelled jobba loader" for its ref); READ_JS reads the uploaded bundle; EVAL_JS
// evaluates it, before any await, so a strict CSP allows it; RUN_JS runs it; CLEAR_JS removes the
// envelope after it was copied.
export const LOADER_JS = "if (!document.getElementById('jobba-loader')) { const i = document.createElement('input'); i.type = 'file'; i.id = 'jobba-loader'; i.setAttribute('aria-label', 'jobba loader'); i.style.cssText = 'position:fixed;right:4px;bottom:4px;z-index:2147483647;width:200px'; document.body.appendChild(i); } 'loader ready'";
export const READ_JS = "window.__jobbaSrc = await document.getElementById('jobba-loader').files[0].text(); window.__jobbaSrc.length";
export const EVAL_JS = '(0, eval)(window.__jobbaSrc)';
export const RUN_JS = 'await window.__jobba.run()';
export const CLEAR_JS = "window.__jobba && window.__jobba.clear(); 'cleared'";

// One bundle: the helpers (named function declarations) and the main function, inlined by source;
// `arg` as JSON. run() calls main(arg), hashes JSON.stringify(payload) and writes the envelope into
// <article id="jobba-out">, prepended to body (get_page_text chooses it). Dialogs are recorded in
// window.__jobbaDialogs and never shown: an alert would block the extension.
export function buildBundle({ id, nonce, main, arg = null, helpers = [] }) {
  return `// jobba page script ${id}
window.__jobba = (() => {
  ${asciiJson.toString()}
  ${helpers.map((f) => f.toString()).join('\n  ')}
  const __main = ${main.toString()};
  const __id = ${JSON.stringify(id)};
  const __nonce = ${JSON.stringify(nonce)};
  const __arg = ${JSON.stringify(arg)};
  async function __hash(text) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').match(/.{8}/g).join('-');
  }
  return {
    id: __id,
    async run() {
      window.__jobbaDialogs = window.__jobbaDialogs || [];
      window.alert = (m) => { window.__jobbaDialogs.push({ kind: 'alert', text: String(m).slice(0, 300) }); };
      window.confirm = (m) => { window.__jobbaDialogs.push({ kind: 'confirm', text: String(m).slice(0, 300) }); return false; };
      window.prompt = (m) => { window.__jobbaDialogs.push({ kind: 'prompt', text: String(m).slice(0, 300) }); return null; };
      let status = 'ok';
      let error = null;
      let payload = null;
      try { payload = await __main(__arg); } catch (e) { status = 'error'; error = String((e && e.message) || e).slice(0, 300); }
      if (payload === undefined) payload = null;
      const env = { v: 1, id: __id, nonce: __nonce, href: location.href, at: new Date().toISOString(), status, error, sha256: await __hash(JSON.stringify(payload)), payload };
      let a = document.getElementById('jobba-out');
      if (!a) { a = document.createElement('article'); a.id = 'jobba-out'; document.body.prepend(a); }
      a.textContent = ${JSON.stringify(START)} + asciiJson(JSON.stringify(env)) + ${JSON.stringify(END)};
      return 'JOBBA ' + status + ' ' + __id + ': ' + a.textContent.length + ' characters; copy them with get_page_text';
    },
    clear() { const a = document.getElementById('jobba-out'); if (a) a.remove(); },
  };
})();
'loaded ' + window.__jobba.id;
`;
}

// The envelope inside text the agent copied (anything around the markers is ignored), checked.
export function readEnvelope(text, { id, nonce, host = null }) {
  const a = String(text).indexOf(START);
  const b = String(text).lastIndexOf(END);
  if (a < 0 || b < a) throw new Error('no JOBBA-ENVELOPE ... JOBBA-END in the copied text (get_page_text output, from the first marker to the last)');
  let env;
  try { env = JSON.parse(String(text).slice(a + START.length, b)); } catch { throw new Error('the envelope is not valid JSON: it was copied wrong or cut short'); }
  if (env?.v !== 1) throw new Error('not a version 1 envelope');
  if (env.id !== id) throw new Error(`envelope id ${env.id} is not the request ${id}`);
  if (env.nonce !== nonce) throw new Error('envelope nonce does not match the request');
  if (host) {
    let h = '';
    try { h = new URL(env.href).hostname.toLowerCase(); } catch { /* not a URL */ }
    if (h !== host && !h.endsWith(`.${host}`)) throw new Error(`the page host ${h || "(none)"} is not ${host}`);
  }
  if (dashHash(JSON.stringify(env.payload)) !== env.sha256) throw new Error('hash mismatch: the copied text differs from what the page wrote');
  return env;
}

// The same probe for the cloakbrowser driver: one expression for page.evaluate that defines the
// helpers and returns the main function's (awaited) result. Both drivers read a page with the same
// code, so they cannot drift apart.
export function probeScript(main, arg = null, helpers = []) {
  return `(async () => {\n${helpers.map((f) => f.toString()).join('\n')}\nreturn (${main.toString()})(${JSON.stringify(arg)});\n})()`;
}
