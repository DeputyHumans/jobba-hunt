// Page side, chrome driver: fill the controls collectForm tagged (data-hunt-key, options also
// data-hunt-opt) for the planFill actions JavaScript does reliably on native controls: text inputs
// and textareas (the native value setter, then input/change/blur, which React forms listen to),
// native selects, checkboxes, radios and ARIA cards. A typeahead, a custom dropdown, a file input or
// anything else comes back { ok: false, agent: true }: the runner asks the agent for it (an act
// request), then reads the form again to check. Self-contained: it runs inside a page bundle.
export function chromeFill(actions) {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const setNative = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true }));
  };
  const typed = (el) => (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'file' && el.type !== 'checkbox' && el.type !== 'radio'
    && el.getAttribute('role') !== 'combobox' && !el.getAttribute('aria-autocomplete') && !el.closest('[role="combobox"]');
  const out = [];
  for (const a of actions || []) {
    const els = [...document.querySelectorAll(`[data-hunt-key="${a.key}"]`)];
    const el = els[0];
    if (!el) { out.push({ key: a.key, ok: false, why: 'not found' }); continue; }
    try {
      if (a.action === 'fill' && typed(el)) {
        el.focus();
        setNative(el, String(a.value ?? ''));
        out.push({ key: a.key, ok: el.value === String(a.value ?? '') });
      } else if (a.action === 'select' && el.tagName === 'SELECT') {
        const want = norm(a.value);
        const i = [...el.options].findIndex((o) => norm(o.text) === want || norm(o.value) === want);
        if (i < 0) { out.push({ key: a.key, ok: false, agent: true, why: 'no such option' }); continue; }
        el.selectedIndex = i;
        for (const t of ['input', 'change']) el.dispatchEvent(new Event(t, { bubbles: true }));
        out.push({ key: a.key, ok: el.selectedIndex === i });
      } else if (a.action === 'check' || a.action === 'uncheck') {
        const want = a.action === 'check';
        const on = () => (el.type === 'checkbox' ? el.checked : el.getAttribute('aria-checked') === 'true');
        if (on() !== want) el.click();
        out.push({ key: a.key, ok: on() === want });
      } else if (a.action === 'radio') {
        const wants = (a.values && a.values.length ? a.values : [a.value]).map(norm);
        const opts = els.filter((e) => wants.includes(norm(e.getAttribute('data-hunt-opt'))));
        if (!opts.length) { out.push({ key: a.key, ok: false, agent: true, why: 'no such option' }); continue; }
        for (const o of opts) o.click();
        out.push({ key: a.key, ok: opts.every((o) => (o.type === 'radio' || o.type === 'checkbox' ? o.checked : o.getAttribute('aria-checked') === 'true')) });
      } else {
        out.push({ key: a.key, ok: false, agent: true, why: a.action });
      }
    } catch (e) {
      out.push({ key: a.key, ok: false, why: String((e && e.message) || e).slice(0, 120) });
    }
  }
  return out;
}
