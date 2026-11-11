// Playwright click helpers for the apply runner, kept apart so real-Chrome tests can drive them.
import { otherOption } from './apply-forms.mjs';

// A styled radio hides its input inside a <label> (appcast, Paylocity). Click the label first;
// when the label swallows the click, check the input itself, then click it from the page.
// The check is confirmed by the group's name and the option's value, read before any click:
// a radio re-mounted on select drops the runner's data-hunt-* attributes, so the original
// locator finds nothing afterwards (on Paylocity a "How did you hear" option did not take).
// Every step has a short timeout. Returns whether that option ends up checked.
export async function checkLabelRadio(loc, { waitMs = 400 } = {}) {
  const page = scopeOf(loc);
  const id = await loc.evaluate((el) => ({ name: el.name, value: el.value }), null, { timeout: 5000 }).catch(() => null);
  if (!id) return false;
  const isOn = () => page.evaluate(({ name, value }) => [...document.querySelectorAll('input[type="radio"]')]
    .some((e) => e.name === name && e.value === value && (e.checked || e.getAttribute('aria-checked') === 'true')), id).catch(() => false);
  const tries = [
    () => loc.locator('xpath=ancestor::label[1]').first().click({ timeout: 3000 }),
    () => loc.check({ force: true, timeout: 3000 }),
    () => loc.evaluate((el) => el.click(), null, { timeout: 3000 }),
  ];
  for (const t of tries) {
    if (await isOn()) return true;
    await t().catch(() => {});
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return isOn();
}


// Clear a text field and type into it. Playwright's fill timed out on Paylocity's fields after the
// resume parse ("element is outside of the viewport", 30 s, the run lost). Then
// the field is focused and typed into from the keyboard, which needs no scroll check.
// Returns whether the field ends up holding the value.
export async function typeText(loc, value, { timeout = 8000, delay = 0, direct = false } = {}) {
  // Inside the iCIMS portal frame the humanized keys and clicks miss (typing stopped after one key, and a
  // stray click started the form's submit with its hCaptcha): one fill, then a synthetic key event for
  // widgets that search on keyup. No pressSequentially, no mouse.
  // The humanized layer rewrites fill as well (a fresh page kept "p" of 'probe@example.com'), so the
  // value is set in the page: the native setter, then input, key and change events.
  if (direct) {
    await loc.evaluate((el, v) => {
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      for (const t of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { bubbles: true, key: 'Unidentified' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, String(value), { timeout }).catch(() => {});
    return (await loc.inputValue({ timeout }).catch(() => null)) === value;
  }
  const viaFill = await loc.fill('', { timeout }).then(() => true, () => false);
  if (viaFill) {
    await loc.pressSequentially(value, { delay, timeout }).catch(() => {});
    // Humanized typing into a cross-origin iframe can stop after the first key (iCIMS):
    // a partial value is replaced by one fill of the whole value.
    if ((await loc.inputValue({ timeout }).catch(() => null)) !== value) await loc.fill(value, { timeout }).catch(() => {});
  } else {
    const kb = loc.page().keyboard;
    await loc.focus({ timeout }).catch(() => {});
    await loc.evaluate((el) => el.select?.(), null, { timeout }).catch(() => {});
    await kb.press('Backspace');
    await kb.insertText(value);
  }
  return (await loc.inputValue({ timeout }).catch(() => null)) === value;
}

// A dropdown whose options render only while it is open: react-widgets (div[role=combobox]
// .rw-dropdownlist, Paylocity; list named by aria-owns, choice in .rw-input) or an
// input-less menu (Rippling; list named by aria-controls once open, choice shown in the
// box itself). Open it, click the option whose text is the answer (exact, case-insensitive), then
// confirm the shown text. `choose(texts)` names the option instead when the answer is not an option
// text (an EEO answer, chosen by eeoPick). Returns whether the box ends showing that option.
export async function pickWidget(loc, value, { waitMs = 600, choose = null } = {}) {
  const page = scopeOf(loc);
  // Paylocity stars an option ("Yes*"): asterisks and case are ignored.
  const norm = (t) => String(t || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const shown = async () => {
    const rw = loc.locator('.rw-input').first();
    return norm(await ((await rw.count().catch(() => 0)) ? rw : loc).innerText({ timeout: 2000 }).catch(() => ''));
  };
  let want = norm(value);
  if (!choose && (await shown()) === want) return true;
  // Centered first: Rippling's sticky Apply bar covers a box near the bottom of the view.
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }), null, { timeout: 3000 }).catch(() => {});
  await loc.click({ timeout: 5000 }).catch(() => loc.evaluate((el) => el.click()));
  await new Promise((r) => setTimeout(r, waitMs));
  const owns = (await loc.getAttribute('aria-owns').catch(() => null)) || (await loc.getAttribute('aria-controls').catch(() => null));
  const list = owns ? page.locator(`[id="${owns}"] [role="option"]`) : page.locator('[role="listbox"] [role="option"]:visible');
  const raw = (await list.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
  if (choose) want = norm(choose(raw));
  const close = () => closeMenu(loc);
  if (choose && (await shown()) === want && want) { await close(); return true; }
  const i = want ? raw.map(norm).findIndex((t) => t === want) : -1;
  if (i < 0) { await close(); return false; }
  await list.nth(i).click({ timeout: 5000 }).catch(() => list.nth(i).evaluate((el) => el.click()));
  await new Promise((r) => setTimeout(r, waitMs));
  return (await shown()) === want;
}

// The options of a menu that renders them only while open (Rippling): open it, read the
// option texts from the list its aria-controls (or aria-owns) names, then close it with nothing
// chosen. Escape, a second click and a blur do not close Rippling's menu; a mousedown outside it does
// (menus left open covered the form). [] on failure.
export async function menuOptions(loc, { waitMs = 600 } = {}) {
  const page = scopeOf(loc);
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }), null, { timeout: 3000 }).catch(() => {});
  if (!(await loc.click({ timeout: 5000 }).then(() => true, () => false))) return [];
  await new Promise((r) => setTimeout(r, waitMs));
  const id = (await loc.getAttribute('aria-controls').catch(() => null)) || (await loc.getAttribute('aria-owns').catch(() => null));
  const texts = id ? (await page.locator(`[id="${id}"] [role="option"]`).allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
  await closeMenu(loc);
  return texts;
}

// Close an open dropdown without choosing: Escape first (react-widgets), then a mousedown dispatched on
// <body>, outside every control (Rippling). Not Tab: focus lands on the next menu, which opens on focus.
async function closeMenu(loc) {
  const page = scopeOf(loc);
  const open = async () => (await loc.getAttribute('aria-expanded').catch(() => null)) === 'true';
  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  if (await open()) {
    await page.evaluate(() => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) document.body.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); }).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  }
}

// A checkbox labelled by a sibling <label for> (Greenhouse race boxes: the box sat under an svg
// and the LinkedIn path never ticked it). Click the label when the state is wrong, fall back to a
// forced check, then confirm. Returns whether the box ends in the wanted state.
export async function setBox(loc, want, { waitMs = 300 } = {}) {
  const page = scopeOf(loc);
  const state = () => loc.isChecked({ timeout: 2000 }).catch(() => null);
  if ((await state()) === want) return true;
  const id = await loc.getAttribute('id').catch(() => null);
  const lab = id ? page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`) : null;
  if (lab && (await lab.count())) await lab.first().click({ timeout: 3000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, waitMs));
  if ((await state()) !== want) await loc.setChecked(want, { force: true, timeout: 3000 }).catch(() => {});
  return (await state()) === want;
}

// Press a Yes/No toggle button (Ashby, aria-pressed). Playwright's click needs the button in the
// viewport and timed out on an Ashby form ("element is outside of the viewport"):
// then the button is scrolled into the page and clicked from the page. Returns whether it ends pressed.
export async function pressToggle(loc, { timeout = 10000, waitMs = 400 } = {}) {
  const pressed = async () => (await loc.getAttribute('aria-pressed', { timeout: 2000 }).catch(() => null)) === 'true';
  if (await pressed()) return true;
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const ok = await loc.click({ timeout }).then(() => true, () => false);
  await new Promise((r) => setTimeout(r, waitMs));
  if (!ok || !(await pressed())) {
    await loc.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); }, null, { timeout: 3000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return pressed();
}

// Submit (Ashby: Playwright timed out scrolling Submit into view, no click was
// dispatched, and the run was recorded submit-unverified). Returns 'clicked' (a real click), 'dom'
// (clicked from the page), 'disabled' (never clicked) or 'none' (no click landed: nothing sent).
// The page click runs only when the error proves the first click never fired: an error after it
// fired (waiting for a navigation) is rethrown, since a second click could send a duplicate.
const PRE_DISPATCH = /outside of the viewport|element is not (visible|enabled|stable|attached)|intercepts pointer events/i;
export async function clickSubmit(loc, { timeout = 15000 } = {}) {
  try { await loc.click({ timeout }); return 'clicked'; } catch (err) {
    if (!PRE_DISPATCH.test(String(err && err.message)) || /navigation/i.test(String(err && err.message))) throw err;
  }
  try {
    const r = await loc.evaluate((el) => {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return 'disabled';
      el.scrollIntoView({ block: 'center' });
      el.click();
      return 'clicked';
    }, null, { timeout: 5000 });
    return r === 'disabled' ? 'disabled' : 'dom';
  } catch { return 'none'; }
}

// One option of a checkbox group collected as a single question (Ashby "Where did you hear
// about this position?"): every box carries the question's data-hunt-key and
// its option in data-hunt-opt. Done when exactly that option is ticked.
export async function tickGroupOption(page, key, opt, { waitMs = 400 } = {}) {
  const sel = `[data-hunt-key="${key}"]`;
  const box = page.locator(`${sel}[data-hunt-opt="${opt.replace(/"/g, '\\"')}"]`).first();
  const done = async () => {
    const t = await page.evaluate((s) => [...document.querySelectorAll(s)].filter((b) => b.checked).map((b) => b.getAttribute('data-hunt-opt')), sel);
    return t.length === 1 && t[0] === opt;
  };
  const viaLabel = async () => {
    const id = await box.getAttribute('id', { timeout: 2000 });
    if (!id) throw new Error('no id');
    await page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first().click({ timeout: 5000 });
  };
  const tries = [viaLabel, () => box.check({ force: true, timeout: 5000 }), () => box.evaluate((el) => el.click())];
  for (const t of tries) {
    if (await done()) return true;
    await t().catch(() => {});
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return done();
}

// A mailed security code into one-character boxes (Greenhouse: a box dropped a keystroke, the boxes
// read one character off, and the site answered "Incorrect security code"). Each box is
// focused, cleared and typed on its own, then all boxes are read back. One retry; false means the
// code never read back right, so Submit must not be pressed.
export async function enterCode(page, boxes, code, { delay = 40 } = {}) {
  const want = String(code);
  const read = async () => (await boxes.evaluateAll((els) => els.map((e) => e.value).join('')).catch(() => '')).trim();
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await boxes.count()) < want.length) return false;
    for (let i = 0; i < want.length; i++) {
      const b = boxes.nth(i);
      if ((await b.inputValue().catch(() => '')) === want[i]) continue;
      await b.click({ timeout: 5000 }).catch(() => b.focus().catch(() => {}));
      // Backspace only clears a box that holds something: in an empty box, Walmart's widget
      // clears the previous box and moves back to it.
      if (await b.inputValue().catch(() => '')) await b.press('Backspace').catch(() => {});
      await page.keyboard.type(want[i], { delay });
    }
    await new Promise((r) => setTimeout(r, 300));
    if ((await read()) === want) return true;
  }
  return false;
}

// LinkedIn's Easy Apply resume picker: each row holds a div[role=button] card
// with the file name, a download link, and a hidden radio in its own div. The card is what selects
// the row. Scroll the row to the middle of its list, click the card, then the radio's label, then
// force-check the radio, stopping as soon as the radio reads checked. Returns whether it is checked.
export async function selectResumeRow(page, key, option, { waitMs = 500 } = {}) {
  const input = page.locator(`[data-hunt-key="${key}"][data-hunt-opt="${String(option).replace(/"/g, '\\"')}"]`).first();
  if (!(await input.count())) return false;
  const row = input.locator('xpath=ancestor::*[.//*[@role="button"]][count(.//input[@type="radio"])=1][1]');
  const checked = () => input.evaluate((el) => el.checked).catch(() => false);
  await input.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  const tries = [
    () => row.locator('[role="button"]').first().click({ timeout: 5000 }),
    () => input.evaluate((el) => { const l = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) l.click(); }),
    () => input.check({ force: true, timeout: 5000 }),
  ];
  for (const t of tries) {
    if (await checked()) return true;
    await t().catch(() => {});
    await page.waitForTimeout(waitMs);
  }
  return checked();
}

// ---------- Workday (myworkdayjobs.com) ----------
const wdWait = (ms) => new Promise((r) => setTimeout(r, ms));
const wdNorm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

// A listbox button's open list: the element its aria-controls names once open (set only then on
// some tenants, the options a moment later), else the newest visible role=listbox that is not a
// prompt's picked-items list. Clicked again once if nothing opened. Returns a locator or null.
async function wdOpenList(loc, { waitMs = 150 } = {}) {
  const page = scopeOf(loc);
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }), null, { timeout: 3000 }).catch(() => {});
  for (let attempt = 0; attempt < 2; attempt++) {
    await loc.click({ timeout: 5000 }).catch(() => loc.evaluate((el) => el.click()).catch(() => {}));
    for (let i = 0; i < 20; i++) {
      await wdWait(waitMs);
      const id = await loc.getAttribute('aria-controls').catch(() => null);
      const own = id ? page.locator(`[id="${id}"]`) : null;
      if (own && (await own.locator('[role="option"]').count().catch(() => 0))) return own;
      const any = page.locator('[role="listbox"]:not([data-automation-id="selectedItemList"]):visible').filter({ has: page.locator('[role="option"]') }).last();
      if (!id && i >= 6 && (await any.count().catch(() => 0))) return any;
    }
  }
  return null;
}
async function wdCloseList(loc) {
  const page = scopeOf(loc);
  await page.keyboard.press('Escape').catch(() => {});
  await wdWait(200);
}
const wdOptionTexts = (list) => list.locator('[role="option"]').evaluateAll((els) => els
  .filter((e) => e.getAttribute('aria-disabled') !== 'true')
  .map((e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => t && !/^select one$/i.test(t)));

// The options of a Workday listbox button, read by opening it; closed again with nothing chosen.
export async function wdListOptions(loc, opts = {}) {
  const list = await wdOpenList(loc, opts);
  if (!list) return [];
  const texts = await wdOptionTexts(list).catch(() => []);
  await wdCloseList(loc);
  return texts;
}

// Pick an option of a Workday listbox button: the option whose text is `value` (case and spacing
// ignored), or the one `choose(texts)` names (an EEO answer, by eeoPick). Confirmed by the button's
// own text afterwards. Returns whether the button ends showing that option.
export async function wdPickList(loc, value, { choose = null } = {}) {
  const shown = async () => wdNorm(await loc.innerText({ timeout: 2000 }).catch(() => ''));
  if (!choose && (await shown()) === wdNorm(value)) return true;
  const list = await wdOpenList(loc);
  if (!list) return false;
  const texts = await wdOptionTexts(list).catch(() => []);
  const want = wdNorm(choose ? choose(texts) : value);
  if (want && (await shown()) === want) { await wdCloseList(loc); return true; }
  const i = want ? texts.map(wdNorm).indexOf(want) : -1;
  if (i < 0) { await wdCloseList(loc); return false; }
  const opt = list.locator('[role="option"]:not([aria-disabled="true"])').filter({ hasNotText: /^\s*select one\s*$/i }).nth(i);
  await opt.scrollIntoViewIfNeeded().catch(() => {});
  await opt.click({ timeout: 5000 }).catch(() => opt.evaluate((el) => el.click()));
  for (let k = 0; k < 10 && (await shown()) !== want; k++) await wdWait(200);
  return (await shown()) === want;
}

// Pick one item in a Workday search prompt (How Did You Hear About Us?, Country Phone Code, Field of
// Study, a school): type the words before any bracket, press Enter, then click the row whose text is
// the answer. Enter alone may pick the only match: a pick that is not the answer is deleted again.
// A one-value prompt has its earlier pick deleted first. Returns whether the pills hold the answer.
export async function wdPickPrompt(loc, value, { waitMs = 700 } = {}) {
  const page = scopeOf(loc);
  const box = loc.locator('xpath=ancestor::*[starts-with(@data-automation-id,"formField-")][1]');
  const pills = async () => (await box.locator('[data-automation-id="selectedItem"]').allInnerTexts().catch(() => [])).map(wdNorm);
  const want = wdNorm(value);
  const before = await pills();
  if (before.includes(want)) return true;
  const drop = async (keep) => {
    for (let i = 0; i < 6; i++) {
      const items = box.locator('[data-automation-id="selectedItem"]');
      const texts = (await items.allInnerTexts().catch(() => [])).map(wdNorm);
      const j = texts.findIndex((t) => !keep.includes(t));
      if (j < 0) return;
      await items.nth(j).locator('[data-automation-id="DELETE_charm"]').click({ timeout: 3000 }).catch(() => {});
      await wdWait(300);
    }
  };
  if (before.length) await drop([]);
  const term = String(value).replace(/\s*\(.*$/, '').trim() || String(value);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 5000 }).catch(() => loc.focus().catch(() => {}));
  await loc.fill('').catch(() => {});
  await loc.pressSequentially(term, { delay: 30 });
  await loc.press('Enter');
  await wdWait(waitMs);
  let now = await pills();
  if (!now.includes(want)) {
    if (now.length) await drop([]);
    const rows = page.locator('[data-automation-id="activeListContainer"] [data-automation-id="promptOption"]');
    const texts = (await rows.allInnerTexts().catch(() => [])).map(wdNorm);
    const i = texts.indexOf(want);
    if (i >= 0) { await rows.nth(i).click({ timeout: 5000 }).catch(() => rows.nth(i).evaluate((el) => el.click())); await wdWait(waitMs); }
    now = await pills();
  }
  if (await page.locator('[data-automation-id="activeListContainer"]').count().catch(() => 0)) await page.keyboard.press('Escape').catch(() => {});
  if (!now.includes(want)) { await loc.fill('').catch(() => {}); return false; }
  return true;
}

// Type a Workday date into its sections ("MM/YYYY", "MM/DD/YYYY" or "YYYY"), key by key: a value
// set at once shows but is not saved. Confirmed by reading the sections back.
export async function wdTypeDate(page, key, value) {
  const first = page.locator(`[data-hunt-key="${key}"]`).first();
  const box = first.locator('xpath=ancestor::*[starts-with(@data-automation-id,"formField-")][1]');
  const parts = String(value).split('/');
  const names = parts.length === 3 ? ['Month', 'Day', 'Year'] : parts.length === 2 ? ['Month', 'Year'] : ['Year'];
  for (const [i, name] of names.entries()) {
    const input = box.locator(`[data-automation-id="dateSection${name}-input"]`).first();
    if (!(await input.count())) return false;
    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click({ timeout: 5000 }).catch(() => input.focus().catch(() => {}));
    await page.keyboard.press('ControlOrMeta+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(parts[i], { delay: 60 });
    await wdWait(150);
  }
  await page.keyboard.press('Tab').catch(() => {});
  await wdWait(300);
  const got = await Promise.all(names.map((nm) => box.locator(`[data-automation-id="dateSection${nm}-input"]`).first().inputValue().catch(() => '')));
  return got.every((g, i) => Number(g) === Number(parts[i]));
}

// Press a My Experience section's Add (or Add Another) and wait for the new entry. The section is the
// [role=group] labelled by `name` ("Work Experience", "Education"). Returns whether an entry appeared.
export async function wdAddEntry(page, name, { timeoutMs = 6000 } = {}) {
  const count = () => page.evaluate((nm) => {
    const g = [...document.querySelectorAll('[role="group"][aria-labelledby$="-section"]')].find((x) => (document.getElementById(x.getAttribute('aria-labelledby'))?.textContent || '').replace(/\s+/g, ' ').trim() === nm);
    if (!g) return -1;
    const re = /^(workExperience|education|language|website|certification|skill)s?-(\d+)--/;
    return new Set([...g.querySelectorAll('[data-fkit-id], input[id], textarea[id], button[id]')].map((e) => re.exec(e.getAttribute('data-fkit-id') || e.id || '')).filter(Boolean).map((x) => x[2])).size;
  }, name);
  const before = await count();
  if (before < 0) return false;
  const tag = await page.evaluate((nm) => {
    const g = [...document.querySelectorAll('[role="group"][aria-labelledby$="-section"]')].find((x) => (document.getElementById(x.getAttribute('aria-labelledby'))?.textContent || '').replace(/\s+/g, ' ').trim() === nm);
    const add = g && ([...g.querySelectorAll('button[data-automation-id="add-button"]')].pop() || [...g.querySelectorAll('button')].filter((b) => /^add( another)?$/i.test((b.textContent || '').trim())).pop());
    if (!add) return false;
    add.setAttribute('data-hunt-add', '1');
    return true;
  }, name);
  if (!tag) return false;
  const btn = page.locator('[data-hunt-add="1"]').first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 5000 }).catch(() => btn.evaluate((el) => el.click()));
  await page.evaluate(() => document.querySelectorAll('[data-hunt-add]').forEach((e) => e.removeAttribute('data-hunt-add')));
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    if ((await count()) > before) return true;
    await wdWait(250);
  }
  return false;
}

// Tick exactly one option of a Workday radio group or checkbox group (the disability form's boxes):
// its label is clicked, a box ticked by mistake earlier is unticked. Confirmed by the checked states.
export async function wdCheckOption(page, key, opt) {
  const sel = `[data-hunt-key="${key}"]`;
  const state = () => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => [e.getAttribute('data-hunt-opt'), e.checked]), sel);
  const press = async (o) => {
    const input = page.locator(`${sel}[data-hunt-opt="${String(o).replace(/"/g, '\\"')}"]`).first();
    const id = await input.getAttribute('id').catch(() => null);
    const lab = id ? page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first() : null;
    if (lab && (await lab.count())) await lab.click({ timeout: 5000 }).catch(() => input.check({ force: true }).catch(() => {}));
    else await input.check({ force: true, timeout: 5000 }).catch(() => input.evaluate((el) => el.click()));
    await wdWait(300);
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    let s = await state();
    if (!s.find(([o, on]) => o === opt && on)) await press(opt);
    s = await state();
    for (const [o, on] of s) if (on && o !== opt) await press(o);
    s = await state();
    if (s.filter(([, on]) => on).map(([o]) => o).join('|') === opt) return true;
  }
  return false;
}

// ---------- Frames (iCIMS) ----------
// The page a locator's lookups belong to: the page itself, or for a locator made inside an iframe, a
// framed() view of that frame, so the label, radio and list lookups above never search the outer page.
// Reads the locator's frame from playwright-core internals (pinned at 1.62.1).
export function scopeOf(loc) {
  const page = loc.page();
  const frame = loc._frame;
  return frame && frame !== page.mainFrame() ? framed(page, frame) : page;
}
// A page-like view of one frame: lookups, evaluate, navigation and waits go to the frame, while the
// keyboard, mouse, screenshots, network events and the context stay the page's. `frame` is a Frame or a
// function returning the current one (a portal iframe can be re-created). Used where a form lives in an
// iframe the site will not let load on its own (iCIMS career sites).
const PAGE_ONLY = new Set(['keyboard', 'mouse', 'screenshot', 'on', 'off', 'once', 'context', 'frames', 'mainFrame', 'frame', 'bringToFront', 'close', 'isClosed', 'viewportSize', 'setViewportSize', 'reload', 'waitForEvent']);
export function framed(page, frame) {
  const current = () => (typeof frame === 'function' ? frame() : frame) || page.mainFrame();
  return new Proxy({}, {
    get(_, key) {
      if (key === 'page') return () => page;
      const target = PAGE_ONLY.has(key) ? page : current();
      const v = target[key];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

// ---------- iCIMS dropdowns ----------
// Pick an option in an iCIMS dropdown: `loc` is its a.dropdown-select (id <select id>_icimsDropdown). Open
// the list, click the option whose text is the answer (case, spacing and apostrophes ignored); a searchable
// list that does not show it yet is typed into and read again for up to 5 s (the portal loads results by
// AJAX). `choose(texts)` names the option instead (an EEO answer, by eeoPick). Done when .dropdown-text shows
// it. An option the list lacks is no pick: the list is closed and false comes back.
export async function icimsPick(loc, value, { waitMs = 600, choose = null, query = null } = {}) {
  const page = scopeOf(loc);
  const norm = (t) => String(t || '').replace(/&#0?39;/g, "'").replace(/[\u2018\u2019`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const sid = String((await loc.getAttribute('id').catch(() => null)) || '').replace(/_icimsDropdown$/, '');
  if (!sid) return false;
  const shown = async () => norm(await loc.locator('.dropdown-text').first().innerText({ timeout: 2000 }).catch(() => ''));
  let want = norm(value);
  if (!choose && want && (await shown()) === want) return true;
  const ctnr = page.locator(`[id="${sid}_icimsDropdown_ctnr"]`);
  const items = ctnr.locator('[role="option"]');
  const texts = async () => (await items.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }), null, { timeout: 3000 }).catch(() => {});
  if (!(await ctnr.isVisible().catch(() => false))) await loc.click({ timeout: 5000 }).catch(() => loc.evaluate((el) => el.click()));
  await wait(waitMs);
  let raw = await texts();
  if (choose) want = norm(choose(raw));
  let i = want ? raw.map(norm).indexOf(want) : -1;
  const search = ctnr.locator('input.dropdown-search').first();
  // Search q until find(texts) gives an index. The value is set in the page first. A list that searches
  // only on a real keyup (a live School list) then gets all but the last character set and that key
  // pressed on the page keyboard: no humanized locator action, no mouse.
  const searchFor = async (q, find) => {
    let k = -1;
    await typeText(search, q, { direct: true });
    for (let t = 0; t < 6 && k < 0; t++) { await wait(500); k = find(raw = await texts()); }
    if (k >= 0 || !q) return k;
    await typeText(search, q.slice(0, -1), { direct: true });
    await search.evaluate((el) => el.focus()).catch(() => {});
    await page.keyboard.press(q.slice(-1)).catch(() => {});
    for (let t = 0; t < 10 && k < 0; t++) { await wait(500); k = find(raw = await texts()); }
    return k;
  };
  if (i < 0 && want && !choose && (await search.isVisible().catch(() => false))) i = await searchFor(String(value), (r) => r.map(norm).indexOf(want));
  // With choose and a query: search the query, then choose from what it shows (an Other entry).
  if (i < 0 && choose && query && (await search.isVisible().catch(() => false))) {
    i = await searchFor(String(query), (r) => { const c = choose(r); if (!c) return -1; want = norm(c); return r.map(norm).indexOf(want); });
  }
  if (i < 0) {
    if (await ctnr.isVisible().catch(() => false)) await loc.click({ timeout: 3000 }).catch(() => {});
    if (await ctnr.isVisible().catch(() => false)) await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  await items.nth(i).click({ timeout: 5000 }).catch(() => items.nth(i).evaluate((el) => el.click()));
  // The live AJAX widget writes the shown text late ("Yes" showed after the 600 ms read): poll up to
  // 5 s, the shown text or the hidden select's chosen option.
  const chosen = async () => norm(await page.locator(`[id="${sid}"]`).evaluate((el) => el.options?.[el.selectedIndex]?.text || '').catch(() => ''));
  for (let t = 0; t < 10; t++) {
    await wait(t ? 500 : waitMs);
    if ((await shown()) === want || (await chosen()) === want) return true;
  }
  return false;
}

// iCIMS posts the whole profile form back when a resume is chosen: the
// portal frame loads a new document, and a form read before it lands loses its tags. The caller sets
// window[tag] = 1 before the upload; this waits until the frame holds a complete document without it.
// 'reloaded', or 'same' when no new document came in time (a portal that does not post back).
export const RELOAD_TAG = '__huntDoc';
export async function awaitReload(scope, { tag = RELOAD_TAG, timeoutMs = 20000, stepMs = 500 } = {}) {
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    const s = await scope.evaluate((t) => (window[t] === 1 ? 'old' : document.readyState), tag).catch(() => 'gone');
    if (s === 'complete') return 'reloaded';
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return 'same';
}

// A searchable iCIMS list that lacks the answer, with an "Other <field>" box beside it
// ("-1_CandProfileFields.School" and "-1_CandProfileFields.OtherSchool"): the list's Other
// entry is picked and the answer goes into that box. False when there is no such box or no Other entry.
export async function icimsPickOther(loc, value) {
  const page = scopeOf(loc);
  const sid = String((await loc.getAttribute('id').catch(() => null)) || '').replace(/_icimsDropdown$/, '');
  if (!sid || !/\./.test(sid)) return false;
  const other = page.locator(`[id="${sid.replace(/\.([^.]+)$/, '.Other$1')}"]`);
  if (!(await other.count().catch(() => 0))) return false;
  if (!(await icimsPick(loc, 'Other', { choose: otherOption, query: 'Other' }))) return false;
  return typeText(other, String(value), { direct: true });
}
