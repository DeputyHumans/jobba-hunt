// Stand-in for react-select v1, which page captures leave out (tests/fixtures/rs1-application.html). It does what
// the library does with that markup: div.Select > div.Select-control holds the search input (role=combobox) and
// the choice as .Select-value > .Select-value-label. Typing (an input event) filters the list and opens
// .Select-menu-outer > .Select-menu. A blur drops the typed text and closes the menu: typed text is never a value.
// Lists come from window.RS_LISTS[<input id or aria-labelledby>].
//
// window.RS_MODE 'virtualized' (the default) is react-virtualized-select drawn over v1: the filter keeps options
// whose label tokens hold every typed token (react-select-fast-filter-options), rows are div.VirtualizedSelectOption
// in a 200 px div.VirtualSelectGrid, 35 px each, only the rows in view plus 10 either side rendered, and a row is
// chosen on click. With no match, a list named in window.RS_LINKS shows "We didn't find your <name>. Click here to
// add it." and any other list shows no menu at all. Choosing "Other" shows the list's box from
// window.RS_OTHER_BOXES (University: "Please specify your University name", Degree: "Please specify your Degree");
// a list without one (Field of Study) shows nothing.
//
// window.RS_MODE 'v1' is plain react-select v1: rows are .Select-option[role=option], chosen on mousedown, "Loading..."
// in .Select-noresults for window.RS_DELAY ms (default 300, like an async list), then the options holding the typed
// text or "No results found". Choosing an option that starts with "Other" shows a free-text box (aria-label "Other",
// required) after the widget.
//
// Both modes: a "(Max N)" list is one react-select per value: its "Add ..." button (div[role=button][id$=-add-btn],
// React onClick) adds a row with an empty list named by the same label, numbered in its hidden "Autocomplete i of n"
// span, and the button is gone once the list has N rows.
(() => {
  const lists = window.RS_LISTS || {};
  const virtual = (window.RS_MODE || 'virtualized') === 'virtualized';
  const keyOf = (input) => (lists[input.id] ? input.id : input.getAttribute('aria-labelledby'));
  const listOf = (input) => lists[keyOf(input)] || [];
  const boxOf = (input) => input.closest('.Select');
  const seq = new WeakMap();
  const ROW = 35;
  const HEIGHT = 200;
  const tokens = (s) => s.toLowerCase().split(/[^\p{L}\p{N}\-']+/u).filter(Boolean);
  const matches = (label, q) => { const lt = tokens(label); return tokens(q).every((x) => lt.some((t) => t.includes(x))); };
  const close = (sel) => {
    sel.querySelector('.Select-menu-outer')?.remove();
    sel.classList.remove('is-open');
    sel.querySelector('.Select-input input')?.setAttribute('aria-expanded', 'false');
  };
  const menu = (sel, build) => {
    let outer = sel.querySelector('.Select-menu-outer');
    if (!outer) {
      outer = document.createElement('div');
      outer.className = 'Select-menu-outer';
      outer.innerHTML = '<div role="listbox" class="Select-menu"></div>';
      sel.appendChild(outer);
    }
    const m = outer.firstChild;
    m.innerHTML = '';
    build(m);
    sel.classList.add('is-open');
    sel.querySelector('.Select-input input').setAttribute('aria-expanded', 'true');
  };
  const line = (m, cls, t) => { const d = document.createElement('div'); d.className = cls; d.textContent = t; m.appendChild(d); return d; };
  // The virtualized grid: rows in view plus 10 either side, re-rendered on scroll.
  const grid = (m, hits) => {
    const g = document.createElement('div');
    g.className = 'VirtualSelectGrid';
    g.style.cssText = `position:relative;overflow:auto;height:${Math.min(HEIGHT, hits.length * ROW)}px`;
    const inner = document.createElement('div');
    inner.style.cssText = `position:relative;height:${hits.length * ROW}px`;
    g.appendChild(inner);
    const draw = () => {
      const from = Math.max(0, Math.floor(g.scrollTop / ROW) - 10);
      const to = Math.min(hits.length, Math.ceil((g.scrollTop + HEIGHT) / ROW) + 10);
      inner.innerHTML = '';
      for (let i = from; i < to; i++) {
        const o = document.createElement('div');
        o.className = 'VirtualizedSelectOption';
        o.style.cssText = `position:absolute;left:0;right:0;top:${i * ROW}px;height:${ROW}px`;
        o.textContent = hits[i];
        inner.appendChild(o);
      }
    };
    g.addEventListener('scroll', draw);
    draw();
    m.appendChild(g);
  };
  document.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.closest || !input.closest('.Select-input')) return;
    const sel = boxOf(input);
    const q = input.value.trim();
    sel.classList.add('is-focused');
    if (virtual) {
      const hits = q ? listOf(input).filter((t) => matches(t, q)) : listOf(input);
      const name = (window.RS_LINKS || {})[keyOf(input)];
      if (hits.length) menu(sel, (m) => grid(m, hits));
      else if (name) menu(sel, (m) => { const d = line(m, 'Select-noresults', ''); const a = document.createElement('a'); a.textContent = `We didn't find your ${name}. Click here to add it.`; d.appendChild(a); });
      else close(sel);
      return;
    }
    const n = (seq.get(sel) || 0) + 1;
    seq.set(sel, n);
    menu(sel, (m) => line(m, 'Select-noresults', 'Loading...'));
    setTimeout(() => {
      if (seq.get(sel) !== n || !sel.querySelector('.Select-menu-outer')) return;
      const hits = listOf(input).filter((t) => t.toLowerCase().includes(q.toLowerCase()));
      menu(sel, (m) => {
        if (!hits.length) line(m, 'Select-noresults', 'No results found');
        hits.forEach((t, i) => { const o = line(m, `Select-option${i ? '' : ' is-focused'}`, t); o.setAttribute('role', 'option'); });
      });
    }, window.RS_DELAY ?? 300);
  });
  const choose = (sel, t) => {
    sel.querySelector('.Select-placeholder')?.remove();
    let v = sel.querySelector('.Select-value');
    if (!v) {
      v = document.createElement('div');
      v.className = 'Select-value';
      v.innerHTML = '<span class="Select-value-label" role="option" aria-selected="true"></span>';
      sel.querySelector('.Select-multi-value-wrapper').prepend(v);
    }
    v.querySelector('.Select-value-label').textContent = t;
    sel.classList.add('has-value');
    let hidden = sel.querySelector('input[type="hidden"]');
    if (!hidden) { hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = 'form-field-name'; sel.prepend(hidden); }
    hidden.value = t;
    if (t && !sel.querySelector('.Select-clear-zone')) sel.querySelector('.Select-control').insertAdjacentHTML('beforeend', '<span aria-label="Clear value" class="Select-clear-zone" title="Clear value"><span class="Select-clear">×</span></span>');
    sel.querySelector('.Select-input input').value = '';
    close(sel);
    const input = sel.querySelector('.Select-input input');
    if (virtual) {
      const row = sel.closest('.form-row[data-name]') || sel.closest('.autocomplete');
      const spec = (window.RS_OTHER_BOXES || {})[keyOf(input)];
      const box = row.nextElementSibling?.classList.contains('other-input') ? row.nextElementSibling : null;
      if (/^other$/i.test(t) && spec && !box) row.insertAdjacentHTML('afterend', `<div class="form-row other-input"><div class="form-field col-4"><label for="${spec.id}">${spec.label}<span class="asterisk">*</span></label><input type="text" id="${spec.id}" aria-required="true" class="form-input-field" value=""></div></div>`);
      if (!/^other$/i.test(t) && box) box.remove();
      return;
    }
    const wrap = sel.closest('.autocomplete');
    const other = wrap.nextElementSibling?.classList.contains('other-input') ? wrap.nextElementSibling : null;
    if (/^other\b/i.test(t) && !other) wrap.insertAdjacentHTML('afterend', '<div class="form-field other-input"><input type="text" class="form-input-field" aria-label="Other" aria-required="true" value=""></div>');
    if (!/^other\b/i.test(t) && other) other.remove();
  };
  document.addEventListener('mousedown', (e) => {
    const clear = e.target.closest && e.target.closest('.Select-clear-zone');
    if (clear) {
      e.preventDefault();
      const sel = clear.closest('.Select');
      sel.querySelector('.Select-value')?.remove();
      sel.classList.remove('has-value');
      const hidden = sel.querySelector('input[type="hidden"]');
      if (hidden) hidden.value = '';
      clear.remove();
      const row = sel.closest('.form-row[data-name]');
      if (row?.nextElementSibling?.classList.contains('other-input')) row.nextElementSibling.remove();
      return;
    }
    if (e.target.closest && e.target.closest('.Select-menu-outer')) e.preventDefault();
    const opt = !virtual && e.target.closest && e.target.closest('.Select-menu-outer .Select-option');
    if (opt) choose(opt.closest('.Select'), opt.textContent.trim());
  });
  document.addEventListener('click', (e) => {
    const opt = virtual && e.target.closest && e.target.closest('.Select-menu-outer .VirtualizedSelectOption');
    if (opt) choose(opt.closest('.Select'), opt.textContent.trim());
    const add = e.target.closest && e.target.closest('[role="button"][id$="autocompletes-add-btn"], [role="button"][id$="autocomplete-add-btn"]');
    if (!add) return;
    const row = add.closest('.form-row');
    const rows = row.parentElement;
    const lab = row.querySelector('.Select-input input').getAttribute('aria-labelledby');
    const n = rows.children.length;
    const max = Number((/\(max (\d+)\)/i.exec(document.getElementById(lab)?.textContent || '') || [])[1]) || Infinity;
    rows.insertAdjacentHTML('beforeend', `<div class="form-row"><div><span class="hidden-element" id="${lab}-${n}">Autocomplete ${n + 1} of ${n + 1}</span><div class="autocomplete color-scheme-blue"><div class="Select is-clearable is-searchable Select--single"><div class="Select-control"><div class="Select-multi-value-wrapper"><div class="Select-placeholder">Select...</div><div class="Select-input" style="display: inline-block;"><input aria-describedby="${lab}-${n} " aria-expanded="false" aria-haspopup="false" aria-labelledby="${lab}" role="combobox" value="" style="box-sizing: content-box; width: 5px;"></div></div><span class="Select-arrow-zone"><span class="Select-arrow"></span></span></div></div></div></div><div role="button" tabindex="0" class="remove-more"><p class="small-title">Remove</p></div></div>`);
    if (n + 1 < max) rows.lastElementChild.appendChild(add); else add.remove();
  });
  document.addEventListener('focusout', (e) => {
    const input = e.target;
    if (!input.closest || !input.closest('.Select-input')) return;
    const sel = boxOf(input);
    input.value = '';
    sel.classList.remove('is-focused');
    close(sel);
  });
})();
