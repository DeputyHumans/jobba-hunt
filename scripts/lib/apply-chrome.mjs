// The apply runner's chrome driver: one application in the operator's own Chrome, through the
// bridge (scripts/lib/bridge.mjs). The runner keeps every gate it has under cloakbrowser (approval,
// pause, halts, the per-company limit, caps, verified channels, the AI-applicant question) and every
// record; the agent only does what a request names. Each step:
//   1. the page reads its form (markRoot + collectForm, a page bundle) and the runner plans the fill
//      (planFill): a question the bank cannot answer stops the run (exit 4), nothing sent;
//   2. the page fills what JavaScript fills reliably (chromeFill); uploads, typeaheads and custom
//      menus go to the agent as act requests; the form is read again to check the fill;
//   3. a screenshot (act), then Next (act) or, on the last page, Submit: a dry run stops before it,
//      a real run writes the submit request to disk (markSubmit) before asking for the click, and the
//      runner, not the agent, reads the confirmation from the page.
// Channels whose flows need the cloakbrowser driver's own steps (Workday, iCIMS, Walmart, Phenom)
// hand off with that hint. A CAPTCHA, a sign-in or a new account hands off: never solved or created.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markRoot, collectForm } from './apply-dom.mjs';
import { NEXT_STEP, applicationForm, blockerIn, codeRequestIn, confirmationIn, detectAts, planFill, siteChannel, submitLabel } from './apply-forms.mjs';
import { chromeFill } from './chrome-fill.mjs';
import { channelVerified } from './browser.mjs';
import { recordSession } from './browser.mjs';
import { SEL_ARG, VIEW_PROBE, interpretView } from '../linkedin-jobs.mjs';
import { DICE_SEL, DICE_VIEW_PROBE, diceViewVerdict, interpretDiceView } from '../dice-jobs.mjs';
import { diceGuid, diceJobUrl } from './dice-extract.mjs';

export const CHROME_HANDOFF = new Set(['workday', 'icims', 'walmart']);
const MASK = /phone|mobile|birth|street|address line/i;

// Page probes (self-contained; they run inside a bundle).
export async function formProbe(kind) {
  markRoot(kind);
  await new Promise((r) => setTimeout(r, 1200));
  const snap = collectForm();
  return { ...snap, url: location.href, phenom: !!document.querySelector('[data-ph-id], [class*="phs-"]') };
}
export async function afterSubmitProbe(waitMs) {
  await new Promise((r) => setTimeout(r, waitMs));
  return { url: location.href, text: (document.body.innerText || '').slice(0, 6000) };
}
export async function fillProbe(actions) {
  return chromeFill(actions);
}

const payload = (r) => { if (r.env.status !== 'ok') throw new Error(`page script error: ${r.env.error}`); return r.env.payload; };

// x: { run, id, dice, dryRun, cfg, bank, ctx, outDir, atsUrl, markSubmit, recordApply(channel),
//      recordLoad(), appsOk(channel), log }. Returns [exitCode, result] for finish().
export async function runChromeApply(x) {
  const { run, id, dice, dryRun, cfg, bank, ctx, outDir, log } = x;
  const filled = [];
  let shot = 0;
  const done = (code, r) => [code, { driver: 'chrome', filled, ...r }];
  const screenshot = async (name) => {
    const a = await run.act({ action: 'screenshot', label: name, summary: `Take a screenshot of the tab and save it to disk (computer screenshot with save_to_disk), then done --screenshot <its path>` });
    shot += 1;
    return a.screenshot ? { name: `${String(shot).padStart(2, '0')}-${name}`, path: a.screenshot } : null;
  };
  const shots = [];
  const keep = async (name) => { const s = await screenshot(name).catch(() => null); if (s) shots.push(s); return s; };

  // 1. The job page (or the company site recorded by an earlier run).
  let channel;
  let kind;
  if (x.atsUrl) {
    await run.page({ kind: 'load', url: x.atsUrl, host: hostOf(x.atsUrl), main: async function here() { return location.href; }, summary: 'Open the company site where the application is' });
    x.recordLoad();
    channel = detectAts(x.atsUrl) || siteChannel(x.atsUrl);
    kind = 'page';
  } else {
    const url = dice ? diceJobUrl(diceGuid(id)) : `https://www.linkedin.com/jobs/view/${id}/`;
    const r = await run.page({ kind: 'load', url, host: dice ? 'dice.com' : 'linkedin.com', ...(dice ? DICE_VIEW_PROBE : VIEW_PROBE), arg: dice ? DICE_SEL : SEL_ARG, summary: `Open the job ${id} to apply (an approved application)` });
    x.recordLoad();
    const raw = payload(r);
    const v = dice ? interpretDiceView(raw, id, diceViewVerdict(raw).verdict) : interpretView(raw, id);
    if (v.status === 'login') { recordSession(dice ? 'dice' : 'linkedin', false); return done(5, { outcome: 'manual', detail: `signed out of ${dice ? 'Dice' : 'LinkedIn'} in Chrome: sign in there, then npm run -s browser -- start ${dice ? 'dice' : 'jobs'} -- whoami; nothing was sent` }); }
    if (v.status === 'checkpoint' || v.status === 'blocked') return done(1, { outcome: 'error', detail: `${dice ? 'Dice' : 'LinkedIn'} ${v.status} on the job page`, halt: v.status });
    if (v.status !== 'ok') return done(5, { outcome: 'manual', detail: `the job page did not read (${v.status}); nothing was sent` });
    if (v.closed) return done(5, { outcome: 'closed', detail: 'the posting is closed' });
    if (v.already_applied) return done(7, { outcome: 'already-applied', detail: `${dice ? 'Dice' : 'LinkedIn'} shows this job as applied` });
    const type = v.apply?.type;
    if (type === 'easy' && !dice) {
      channel = 'easy';
      kind = 'dialog';
      await run.act({ action: 'click', label: 'Easy Apply', summary: 'Click "Easy Apply" on the job page: it opens the application dialog' });
    } else if (dice && (type === 'dice-easy' || type === 'easy')) {
      channel = 'dice-easy';
      kind = 'page';
      await run.act({ action: 'click', label: 'Easy apply', summary: 'Click "Easy apply" on the Dice job page: it opens the application' });
    } else if (type === 'external') {
      const a = await run.act({ action: 'click', label: 'Apply', summary: 'Click "Apply" on the job page. It opens the company site, in this tab or a new one: continue in the tab that shows it, then done --url <its URL>' });
      if (!a.url) return done(5, { outcome: 'manual', detail: 'the company site did not open (no URL reported); nothing was sent' });
      x.atsUrl = a.url;
      channel = detectAts(a.url) || siteChannel(a.url);
      kind = 'page';
    } else return done(5, { outcome: 'manual', detail: `no apply control the runner knows (${type || 'none'}); nothing was sent` });
  }
  const ats = channel.replace(/^site:.*/, 'site');
  if (CHROME_HANDOFF.has(channel)) return done(5, { outcome: 'manual', channel, ats_url: x.atsUrl || null, driver_hint: 'cloakbrowser', detail: `${channel} needs the cloakbrowser driver's own steps: run it with --driver cloakbrowser on the operator's word, or apply by hand; nothing was sent` });
  if (!dryRun && !channelVerified(cfg, channel, 'chrome')) return done(2, { outcome: 'refused', channel, ats_url: x.atsUrl || null, detail: `channel ${channel} is not verified for the chrome driver: run a dry run under chrome, check it, then npm run apply -- verify --channel ${channel} --evidence <that run's dir>` });
  if (!dryRun && !x.appsOk(channel)) return done(2, { outcome: 'refused', channel, detail: `${channel} applications_per_day cap reached` });

  // 2. The form, step by step.
  for (let step = 1; step <= (cfg.max_steps || 12); step++) {
    const read = async () => payload(await run.page({ kind: 'eval', host: hostOf(x.atsUrl) || (dice ? 'dice.com' : 'linkedin.com'), main: formProbe, arg: kind, helpers: [markRoot, collectForm], summary: `Read step ${step} of the application form` }));
    let snap = await read();
    if (snap.phenom) return done(5, { outcome: 'manual', channel, ats_url: x.atsUrl || null, driver_hint: 'cloakbrowser', detail: 'a Phenom apply flow needs the cloakbrowser driver; nothing was sent' });
    writeFileSync(join(outDir, `step${step}-fields.json`), JSON.stringify(snap.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: f.required, value: MASK.test(f.label) ? (f.value ? '[masked]' : '') : f.value })), null, 1));
    const blocker = blockerIn(snap);
    if (blocker === 'captcha') return done(5, { outcome: 'manual', channel, ats_url: x.atsUrl || null, detail: 'a CAPTCHA or bot check: the operator solves it in Chrome and runs it again; never solved by the agent; nothing was sent' });
    if (blocker === 'account-required') return done(5, { outcome: 'manual', channel, ats_url: x.atsUrl || null, detail: 'the site asks for a sign-in or a new account: the operator does it in Chrome, then runs it again; nothing was sent' });
    let plan = planFill(snap.fields, bank, ctx);
    if (plan.missing.length) return done(4, { outcome: 'needs_answers', channel, ats_url: x.atsUrl || null, detail: plan.missing });
    for (let round = 0; round < 2 && plan.actions.length; round++) {
      const res = payload(await run.page({ kind: 'eval', host: hostOf(x.atsUrl) || (dice ? 'dice.com' : 'linkedin.com'), main: fillProbe, arg: plan.actions, helpers: [chromeFill], summary: `Fill step ${step} (the values come from the answer bank and the approved documents)` }));
      const label = (key) => snap.fields.find((f) => f.key === key)?.label || key;
      for (const a of plan.actions) {
        const r = res.find((y) => y.key === a.key);
        if (r?.ok) { filled.push({ label: label(a.key), value: MASK.test(label(a.key)) ? '[masked]' : a.value, source: a.source, action: a.action }); continue; }
        if (a.action === 'file') {
          await run.act({ action: 'upload', label: label(a.key), file: a.value, target: `[data-hunt-key="${a.key}"]`, summary: `Upload the file into "${label(a.key)}": find that file input, then file_upload ${a.value}` });
        } else {
          await run.act({ action: a.action === 'fill' ? 'type' : 'pick', label: label(a.key), value: a.value, target: `[data-hunt-key="${a.key}"]`, summary: `${a.action === 'fill' ? 'Type' : 'Choose'} "${a.value}" in "${label(a.key)}"` });
        }
        filled.push({ label: label(a.key), value: MASK.test(label(a.key)) ? '[masked]' : a.value, source: a.source, action: a.action, by: 'agent' });
      }
      snap = await read();
      plan = planFill(snap.fields, bank, ctx);
      if (plan.missing.length) return done(4, { outcome: 'needs_answers', channel, ats_url: x.atsUrl || null, detail: plan.missing });
      plan = { ...plan, actions: plan.actions.filter((a) => a.action !== 'file') };
    }
    if (plan.actions.length) return done(4, { outcome: 'needs_answers', channel, ats_url: x.atsUrl || null, detail: plan.actions.map((a) => ({ key: a.key, label: snap.fields.find((f) => f.key === a.key)?.label || a.key, kind: 'unknown', options: [], reason: `did not take the value after two tries (${a.action})` })) });
    await keep(`step${step}`);
    const submit = submitLabel(snap.buttons, channel, cfg.submit_labels || {});
    const next = (snap.buttons || []).find((b) => NEXT_STEP.test(b));
    if (submit && (applicationForm(snap.fields) || step > 1 || kind === 'dialog')) {
      await keep('final-submit');
      if (dryRun) {
        await run.act({ action: 'discard', label: submit, summary: `Dry run: do NOT press "${submit}". Close the application without sending it (Easy Apply: Dismiss, then Discard)` });
        return done(0, { outcome: 'dry-run-complete', channel, ats_url: x.atsUrl || null, detail: `stopped before "${submit}"`, screenshots: shots });
      }
      x.markSubmit();
      await run.act({ action: 'submit', label: submit, summary: `Press "${submit}" once: this sends the approved application. Then done --url <the tab's URL>` });
      for (let poll = 0; poll < 5; poll++) {
        const after = payload(await run.page({ kind: 'eval', host: null, main: afterSubmitProbe, arg: 5000, summary: 'Read the page after Submit' }));
        if (confirmationIn(after.text)) {
          x.recordApply(channel);
          await keep('after-submit');
          return done(0, { outcome: 'submitted', channel, ats_url: x.atsUrl || null, screenshots: shots });
        }
        if (codeRequestIn(after.text)) return done(5, { outcome: 'manual', channel, ats_url: x.atsUrl || null, detail: 'the site asks for a code mailed to the application email: the operator enters it in Chrome and submits; check the platform before anything else' });
      }
      await keep('after-submit');
      return done(6, { outcome: 'submit-unverified', channel, ats_url: x.atsUrl || null, detail: 'Submit was pressed and no confirmation was read: check the platform by hand; never retry', screenshots: shots });
    }
    if (!next) return done(5, { outcome: 'manual', channel, ats_url: x.atsUrl || null, detail: `no Next or Submit on step ${step} (${(snap.buttons || []).slice(0, 8).join(', ')}); nothing was sent` });
    await run.act({ action: 'click', label: next, summary: `Click "${next}" to go to the next step of the application` });
  }
  return done(5, { outcome: 'manual', channel, ats_url: x.atsUrl || null, detail: `more than ${cfg.max_steps || 12} steps; nothing was sent` });
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}
