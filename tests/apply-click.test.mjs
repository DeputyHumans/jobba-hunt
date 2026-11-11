// The typing fallback, driven by a locator stand-in whose fill fails the way Playwright's did on
// Paylocity after its resume parse ("element is outside of the viewport"). No fixture reproduced
// that failure in plain Chromium, so the fallback path is tested here directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeText, clickSubmit, awaitReload } from '../scripts/lib/apply-click.mjs';

function fakeLocator({ fillWorks, typingStops = false }) {
  const calls = [];
  let value = 'old';
  const keyboard = {
    press: async (k) => { calls.push(`press:${k}`); if (k === 'Backspace') value = ''; },
    insertText: async (t) => { calls.push('insertText'); value += t; },
  };
  const loc = {
    page: () => ({ keyboard }),
    fill: async (v) => { calls.push('fill'); if (!fillWorks) throw new Error('Timeout: element is outside of the viewport'); value = v; },
    pressSequentially: async (t) => { calls.push('pressSequentially'); value += typingStops ? t.slice(0, 1) : t; },
    focus: async () => { calls.push('focus'); },
    evaluate: async (fn, arg) => { calls.push('select'); if (typeof arg === 'string') value = arg; },
    inputValue: async () => value,
  };
  return { loc, calls, get value() { return value; } };
}

test('typeText: when fill times out, the field is focused and typed into from the keyboard, then checked', async () => {
  const f = fakeLocator({ fillWorks: false });
  assert.equal(await typeText(f.loc, '5555550100', { timeout: 10 }), true);
  assert.equal(f.value, '5555550100');
  assert.deepEqual(f.calls, ['fill', 'focus', 'select', 'press:Backspace', 'insertText']);
});

test('typeText: when fill works, it types the usual way', async () => {
  const f = fakeLocator({ fillWorks: true });
  assert.equal(await typeText(f.loc, 'Jordan', { timeout: 10 }), true);
  assert.deepEqual(f.calls, ['fill', 'pressSequentially']);
});

// Humanized typing into a cross-origin iframe stopped after the first key (iCIMS: the email box
// held one character). A partial value is replaced by one fill of the whole value.
test('typeText: when typing stops part way, the whole value is filled in one go, then checked', async () => {
  const f = fakeLocator({ fillWorks: true, typingStops: true });
  assert.equal(await typeText(f.loc, 'jordan@example.com', { timeout: 10 }), true);
  assert.equal(f.value, 'jordan@example.com');
  assert.deepEqual(f.calls, ['fill', 'pressSequentially', 'fill']);
});

// Inside the iCIMS portal frame the humanized keys and clicks miss: typing stopped after one key and a
// stray click started the form's submit, with the hCaptcha. direct: one fill of the whole value plus a
// synthetic key event for widgets that search on keyup; no pressSequentially.
// The humanized layer rewrites fill too: on a fresh page fill('probe@example.com') left "p". direct
// sets the value in the page (native setter, input/change/key events).
test('typeText direct: the value is set in the page, never fill or pressSequentially', async () => {
  const f = fakeLocator({ fillWorks: true, typingStops: true });
  assert.equal(await typeText(f.loc, 'Springfield', { timeout: 10, direct: true }), true);
  assert.equal(f.value, 'Springfield');
  assert.deepEqual(f.calls, ['select']);
});

// Submit off screen (Ashby): Playwright timed out scrolling the button into view,
// so no click was dispatched, yet the run was recorded submit-unverified. clickSubmit says what happened.
function fakeButton({ clickWorks, disabled = false, domWorks = true }) {
  const calls = [];
  const loc = {
    click: async () => { calls.push('click'); if (!clickWorks) throw new Error('locator.click: Timeout 10ms exceeded. element is outside of the viewport'); },
    evaluate: async (fn) => { calls.push('dom'); if (!domWorks) throw new Error('detached'); return disabled ? 'disabled' : 'clicked'; },
  };
  return { loc, calls };
}

test('clickSubmit: a normal click is reported as clicked', async () => {
  const b = fakeButton({ clickWorks: true });
  assert.equal(await clickSubmit(b.loc, { timeout: 10 }), 'clicked');
  assert.deepEqual(b.calls, ['click']);
});

test('clickSubmit: when the click cannot reach the button, it is clicked from the page', async () => {
  const b = fakeButton({ clickWorks: false });
  assert.equal(await clickSubmit(b.loc, { timeout: 10 }), 'dom');
  assert.deepEqual(b.calls, ['click', 'dom']);
});

test('clickSubmit: a disabled button is never clicked, and says so', async () => {
  const b = fakeButton({ clickWorks: false, disabled: true });
  assert.equal(await clickSubmit(b.loc, { timeout: 10 }), 'disabled');
});

test('clickSubmit: when neither click lands, nothing was sent', async () => {
  const b = fakeButton({ clickWorks: false, domWorks: false });
  assert.equal(await clickSubmit(b.loc, { timeout: 10 }), 'none');
});

// iCIMS posts the whole profile form back when a resume is chosen: the
// portal frame loads a new document, and a form read before it lands loses its tags ("waiting for
// [data-hunt-key=f15]"). awaitReload waits for a complete document that lacks the tag set before upload.
function fakeFrame(script) {
  let i = 0;
  return { evaluate: async () => { const s = script[Math.min(i++, script.length - 1)]; if (s === 'gone') throw new Error('Execution context was destroyed'); return s; }, get calls() { return i; } };
}
test('awaitReload: waits past the old document and a navigation to a complete new one', async () => {
  const f = fakeFrame(['old', 'old', 'gone', 'loading', 'complete']);
  assert.equal(await awaitReload(f, { timeoutMs: 1000, stepMs: 1 }), 'reloaded');
  assert.equal(f.calls, 5);
});
test('awaitReload: no new document in time is "same" (a portal that does not post back)', async () => {
  const f = fakeFrame(['old']);
  assert.equal(await awaitReload(f, { timeoutMs: 30, stepMs: 5 }), 'same');
});
