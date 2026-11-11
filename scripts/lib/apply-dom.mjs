// Browser-side collectors for the apply runner. Every export runs inside page.evaluate,
// so each function is self-contained (no imports, no closures over module scope).
// Selectors are semantic (roles, labels, input types), not LinkedIn class names: the
// Easy Apply modal and the ATS forms share one collector. Status: ? until a --headed
// dry run per channel confirms it (runbook §3).

// Marks the form root with data-hunt-root. Easy Apply: the visible dialog that looks like
// an application step. ATS: the form holding a file input or a submit control, else body.
// Dice ('page'): the same, inside <main>.
export function markRoot(kind) {
  for (const el of document.querySelectorAll('[data-hunt-root]')) el.removeAttribute('data-hunt-root');
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let root = null;
  if (kind === 'workday') {
    // Workday's application page: the step's form sits in applyFlowPage, its footer
    // buttons (Save and Continue, Back, Submit) inside it too.
    root = document.querySelector('[data-automation-id="applyFlowPage"]') || document.body;
  } else if (kind === 'walmart') {
    // Walmart careers: the questionnaire is the form named by its title; the header's
    // job search form is never the root.
    root = document.querySelector('form[aria-labelledby="questionnaire-title"]') || document.querySelector('main') || document.body;
  } else if (kind === 'dialog') {
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open]')].filter(shown)
      .filter((d) => /apply to|contact info|resume|review your application|submit application|additional questions|work experience|screening questions|your application was sent|application sent/i.test(d.innerText || ''));
    root = dialogs[dialogs.length - 1] || null;
  } else {
    // 'page' (Dice's Easy Apply wizard, a full page): look only inside <main>, so the site
    // header's job search box is never taken for an application field.
    const scope = kind === 'page' ? (document.querySelector('main') || document.body) : document;
    const forms = [...scope.querySelectorAll('form')].filter((f) => f.querySelector('input[type="file"], [type="submit"], button'))
      .sort((a, b) => b.querySelectorAll('input, select, textarea').length - a.querySelectorAll('input, select, textarea').length);
    root = forms[0] || (kind === 'page' ? scope : document.body);
    // The resume upload in a form of its own (Paycor): widen the root to the
    // nearest element holding both, so the CV slot is filled with the rest.
    const lone = root && !root.querySelector('input[type="file"]') ? [...scope.querySelectorAll('input[type="file"]')].find((f) => !root.contains(f)) : null;
    if (lone) { let a = root; while (a && !a.contains(lone)) a = a.parentElement; if (a) root = a; }
  }
  if (root) root.setAttribute('data-hunt-root', '1');
  return !!root;
}

// Snapshot of the fields under [data-hunt-root]: {key, kind, label, required, options,
// value, error}. Tags each control with data-hunt-key (radios also data-hunt-opt) so the
// runner can address it. Also returns the root text, iframe srcs, a password flag and
// the visible button names.
export function collectForm() {
  const root = document.querySelector('[data-hunt-root]') || document.body;
  const clean = (t) => {
    let s = (t || '').replace(/\s+/g, ' ').trim().replace(/\s*\brequired\b\s*$/i, '').trim();
    const m = s.match(/^(.+?)\s*\1$/); // LinkedIn renders labels twice (aria-hidden + visually-hidden copy)
    if (m) s = m[1];
    return s;
  };
  const text = (el) => (el ? (el.innerText || el.textContent || '') : '');
  // LinkedIn cards: a hidden input inside div[role=checkbox|radio][aria-label]. The card
  // carries the label and the real state (aria-checked), as in LinkedIn's live markup.
  const cardOf = (el) => el.closest('[role="checkbox"][aria-label], [role="radio"][aria-label]');
  // Ashby field entry title: an id-less input (the Location typeahead) is
  // named by its entry's own <label>, which carries the _required_ class; the description
  // between them is not the question. Only an entry holding this one field.
  const ashbyTitle = (el) => {
    const entry = el.closest('.ashby-application-form-field-entry');
    if (!entry || entry.querySelectorAll('input, select, textarea').length !== 1) return null;
    return entry.querySelector(':scope > label');
  };
  const rawLabel = (el) => {
    // Greenhouse 2026 boards: a file input's own <label for> says
    // "Attach" and the slot's name ("Resume/CV", "Cover Letter") heads its role=group. A
    // generic button word yields to the group heading.
    if (el.type === 'file') {
      const own = el.id ? text(root.querySelector(`label[for="${CSS.escape(el.id)}"]`)).trim() : '';
      const grp = el.closest('[role="group"][aria-labelledby]');
      const heading = grp ? (grp.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ') : '';
      if (heading.trim() && (!own || /^(attach|upload|browse|add file|choose( a)? file|select( a)? file)$/i.test(own))) return heading;
      // Rippling: the input sits in a <label aria-labelledby> naming a file count for
      // screen readers and the field title ("Résumé"), whose required * is a sibling span. The
      // "Drop or select" button inside is not the name.
      const wrapLab = !own ? el.closest('label[aria-labelledby]') : null;
      if (wrapLab) {
        const parts = wrapLab.getAttribute('aria-labelledby').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id))
          .filter((n) => n && text(n).trim() && !/^total \d+ files? selected$/i.test(text(n).trim()));
        if (parts.length) return parts.map((n) => text(n).trim()).join(' ') + (parts.some((n) => /\*\s*$/.test(text(n.parentElement).trim())) ? '*' : '');
      }
      // Paylocity: a hidden input with no label, named only by the button
      // after it ("Select Resume to Upload").
      const btn = el.nextElementSibling;
      const bt = btn && btn.tagName === 'BUTTON' ? text(btn).replace(/\s+/g, ' ').trim() : '';
      if (!own && bt && bt.length <= 60) return bt;
      // Ashby: the optional autofill upload sits under its own heading
      // ("Autofill from resume"). Only a block holding this one file input may name it.
      if (!own) {
        let up = el.parentElement;
        for (let i = 0; i < 4 && up && up !== root; i++, up = up.parentElement) {
          if (up.querySelectorAll('input[type="file"]').length !== 1) break;
          const h = up.querySelector('h1, h2, h3, h4');
          if (h && text(h).trim()) return text(h);
        }
      }
    }
    const card = cardOf(el);
    if (card && root.contains(card)) return card.getAttribute('aria-label');
    // The first <label for> with text: a styled checkbox can have an empty box label before the
    // text label (a company-site privacy box).
    const byFor = el.id ? [...root.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)].find((l) => text(l).trim()) : null;
    if (byFor) return text(byFor);
    const at = ashbyTitle(el);
    if (at && text(at).trim()) return text(at);
    const lb = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ');
    if (lb.trim()) return lb;
    if ((el.getAttribute('aria-label') || '').trim()) return el.getAttribute('aria-label');
    const wrap = el.closest('label');
    if (wrap && text(wrap).trim()) return text(wrap);
    // LinkedIn 2026 checkbox groups: <div><input><label for></label></div><p>Option</p>,
    // the option text after the input's wrapper, the question in a <p> before the fieldset.
    if (el.type === 'checkbox') {
      const nx = el.parentElement?.nextElementSibling;
      const t = nx && !nx.querySelector('input, select, textarea') ? text(nx).trim() : '';
      if (t && t.length < 160) return t;
    }
    // LinkedIn resume cards: a hidden input with an empty label inside div[role=radio][aria-label]
    // (LinkedIn's live markup). Take the nearest labelled ancestor within 3 levels.
    let a = el.parentElement;
    for (let i = 0; i < 3 && a && a !== root; i++, a = a.parentElement) if ((a.getAttribute('aria-label') || '').trim()) return a.getAttribute('aria-label');
    const vis = visualLabel(el, 4);
    if (vis) return vis.text;
    return el.getAttribute('placeholder') || el.getAttribute('name') || '';
  };
  // Visual label: the closest short text block before the field in its wrapper (appcast
  // applyboard renders "Legal First Name *" as a sibling element and its questions as a
  // <p class="required"> above the control, not a <label>). Stops at the previous
  // field's block, so it never borrows a neighbour's label.
  function visualLabel(el, depth) {
    // A free-text box can carry a long question (a Gem form's 175 characters came back unlabeled
    // and the required answer was never typed).
    // keeps paragraph blobs out of their labels.
    const cap = el.tagName === 'TEXTAREA' ? 300 : 160;
    for (let node = el, i = 0; i < depth && node && node !== root; i++, node = node.parentElement) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.querySelector('input, select, textarea') || sib.matches('input, select, textarea')) break;
        const t = text(sib).trim();
        if (t && t.length <= cap && !sib.querySelector('button')) return { text: t, el: sib };
      }
    }
    return null;
  }
  const groupLabel = (el) => {
    const fs = el.closest('fieldset');
    const lg = fs && fs.querySelector('legend');
    if (lg && text(lg).trim()) return text(lg);
    // Ashby titles a radio group with a <label> that is the fieldset's own child, not a
    // <legend>. Read it directly: visualLabel caps text at 160 characters, and a long
    // sponsorship question came back unlabeled.
    const title = el.type === 'radio' && fs && fs.querySelector(':scope > label');
    if (title && text(title).trim()) return text(title);
    // LinkedIn 2026: every radio in the group carries the question as its aria-label, while
    // the text above the group can be boilerplate ("Race categories are defined as follows:",
    // the VEVRAA notice). A label shared by all the group's radios is the question.
    const own = el.closest('[role="radiogroup"], fieldset');
    if (own && el.type === 'radio') {
      const named = (r) => r.getAttribute('aria-label') || (r.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ');
      const labs = [...own.querySelectorAll('input[type="radio"]')].map((r) => named(r).trim());
      if (labs.length > 1 && labs[0] && labs.every((l) => l === labs[0])) return labs[0];
    }
    const rg = el.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const lb = (rg.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ');
      if (lb.trim()) return lb;
      if (rg.getAttribute('aria-label')) return rg.getAttribute('aria-label');
    }
    // Legend-less radiogroup with the question in the element just before it.
    const grp = el.closest('[role="radiogroup"], fieldset');
    const prev = grp && grp.previousElementSibling;
    if (prev && text(prev).trim()) return text(prev);
    // Else a card aria-label that is not the option's own visible text is the question.
    const card = cardOf(el);
    if (card) { const al = card.getAttribute('aria-label') || ''; const vis = text(card).trim(); if (al && vis && al !== vis) return al; }
    // Custom radio groups (appcast <app-radio-group>) under a question <p>: start above the
    // option's own <label>, so the option text is never taken for the question.
    const vis = visualLabel(el.closest('label') || el, 7);
    if (vis) return vis.text;
    // A role=radiogroup whose question is a paragraph over 160 characters just before the group's
    // own wrapper (Rippling's SMS opt-in, about 250): walk up while the wrapper holds only
    // this group's controls and take the first text block before it, up to 600 characters.
    const rgroup = el.closest('[role="radiogroup"]');
    const own2 = rgroup ? rgroup.querySelectorAll('input, select, textarea').length : 0;
    for (let up = rgroup, i = 0; up && up !== root && i < 4; up = up.parentElement, i++) {
      if (up.querySelectorAll('input, select, textarea').length !== own2) break;
      const pv = up.previousElementSibling;
      if (!pv) continue;
      const t = pv.querySelector('input, select, textarea, button') ? '' : text(pv).trim();
      if (t && t.length <= 600) return t;
      break;
    }
    return '';
  };
  // Radio option text: a card's visible text ("Yes"), else its aria-label (resume cards
  // carry the file name only in aria-label), else the input's own label.
  const optionLabel = (el) => {
    const card = cardOf(el);
    if (card) return text(card).trim() || card.getAttribute('aria-label');
    // A radio card named by aria-labelledby (Rippling's SMS opt-in): the option is that text.
    const named = el.closest('[role="radio"][aria-labelledby]');
    const nt = named ? named.getAttribute('aria-labelledby').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ').trim() : '';
    if (nt) return nt;
    const own = rawLabel(el);
    // LinkedIn 2026 radios: the input's aria-label repeats the question, the <label for> is
    // empty, and "Yes"/"No" sits in a sibling <p>. Then take the text
    // of the largest ancestor inside the group that holds only this radio.
    const grp = el.closest('[role="radiogroup"], fieldset');
    const bare = (t) => clean(t).replace(/\s*\*\s*$/, '');
    if (grp && (!own.trim() || bare(own) === bare(groupLabel(el)))) {
      const solo = (n) => n.querySelectorAll('input[type="radio"]').length === 1;
      let a = el.parentElement;
      while (a && a.parentElement && a.parentElement !== grp && grp.contains(a.parentElement) && solo(a.parentElement)) a = a.parentElement;
      const vis = a && a !== grp && solo(a) ? text(a).trim() : '';
      if (vis) return vis;
    }
    // No fieldset or radiogroup, the label repeats the question, and "Yes" sits as text beside the
    // radio in a parent of its own (Paycor's SMS opt-in).
    const p = el.parentElement;
    if (!grp && p && (!own.trim() || bare(own) === bare(groupLabel(el))) && p.querySelectorAll('input[type="radio"]').length === 1) {
      const t = clean(text(p)).trim();
      if (t && t.length <= 60) return t;
    }
    return own;
  };
  const shown = (el) => {
    if (el.type === 'file') return true;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return true;
    const card = el.closest('[role="radio"], [role="checkbox"]');
    if (card && card.getBoundingClientRect().width > 0) return true;
    const byFor = el.id ? root.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const lab = byFor || el.closest('label');
    return !!lab && lab.getBoundingClientRect().width > 0; // styled radios hide the input itself
  };
  // Required: the input says so, the label text ends in *, or the visual label element is
  // marked with a "required" class (appcast draws its * in CSS).
  // A * drawn in CSS (Rippling custom questions: an empty element inside the question <p> with
  // ::after { content: "*" }; nothing else marks the radio required, and Apply stays disabled).
  const cssStar = (node) => !!node && [node, ...node.querySelectorAll('*')].slice(0, 40)
    .some((e) => ['::after', '::before'].some((pe) => /^["']\s*\*\s*["']$/.test(getComputedStyle(e, pe).content || '')));
  const isRequired = (el, raw) => {
    if (el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\brequired\b/i.test(raw || '')) return true;
    const vis = visualLabel(el.closest('label') || el, 7)?.el;
    return /(^|\s)required(\s|$)/.test(vis?.className || '') || cssStar(vis)
      || /(^|[\s_-])required/.test(ashbyTitle(el)?.className || '');
  };
  const errorNear = (el) => {
    let c = el;
    for (let i = 0; i < 6 && c.parentElement && c.parentElement !== root; i++) {
      c = c.parentElement;
      const e = c.querySelector('[role="alert"], [aria-live="assertive"], [class*="error" i], [class*="feedback" i]');
      if (e && text(e).trim()) return text(e).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (c.querySelector('label, legend')) break;
    }
    return null;
  };

  const fields = [];
  const groups = new Map();
  let n = 0;
  let hasPassword = false;
  for (const el of root.querySelectorAll('input, select, textarea')) {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (type === 'password') { hasPassword = true; continue; }
    // Workday's honeypot ("Enter website. This input is for robots only"): never a field.
    if (el.getAttribute('data-automation-id') === 'beecatcher') continue;
    // An iCIMS dropdown's own search box belongs to the widget, collected below.
    if (el.classList.contains('dropdown-search') && el.closest('.dropdown-container')) continue;
    // Its hidden select too: the widget is the field (its visible label made the select look shown).
    if (el.tagName === 'SELECT' && el.id && document.getElementById(`${el.id}_icimsDropdown`)) continue;
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type) || el.disabled || !shown(el)) continue;
    // react-select's validation shadow (Greenhouse 2026): an aria-hidden input no one
    // can focus, next to the real combobox. It is not a question.
    if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex < 0 && !['radio', 'checkbox', 'file'].includes(type)) continue;
    // A Yes/No toggle's hidden checkbox (Ashby): the buttons beside it are the question, collected below.
    if (type === 'checkbox' && el.parentElement && el.parentElement.querySelectorAll(':scope > button[aria-pressed]').length >= 2) continue;
    if (type === 'radio') {
      const name = el.name || `radio-${n}`;
      let g = groups.get(name);
      if (!g) {
        const raw = groupLabel(el);
        // Ashby marks a required radio question only on its title label's class (_required_*), not
        // on the radios (Submit was rejected with two required radios left blank).
        const box = el.closest('fieldset, [role="radiogroup"], [class*="radio-group"]:not([class*="option"])');
        const titled = box && [...box.querySelectorAll('label, legend, [class*="title"], [class*="heading"]')]
          .some((t) => !t.closest('[class*="option"]') && /(^|[\s_-])required/i.test(t.className || ''));
        g = { key: `f${n++}`, kind: 'radio', label: clean(raw), required: isRequired(el, raw) || !!titled, options: [], value: '', error: errorNear(el) };
        groups.set(name, g);
        fields.push(g);
      }
      const opt = clean(optionLabel(el)) || el.value;
      el.setAttribute('data-hunt-key', g.key);
      el.setAttribute('data-hunt-opt', opt);
      g.options.push(opt);
      if (cardOf(el) ? cardOf(el).getAttribute('aria-checked') === 'true' : el.checked || el.closest('[role="radio"]')?.getAttribute('aria-checked') === 'true') g.value = opt;
      if (el.required) g.required = true;
      continue;
    }
    // LinkedIn 2026 Yes/No questions drawn as a pair of checkboxes in a fieldset, with the
    // question in the <p> before it: one radio-style question, not two
    // boxes labelled "Yes" and "No" that no bank rule can answer.
    // Ashby checkbox groups: fieldset.…checkbox-group with the question in its
    // title <label>, required only by a _required_ class (no asterisk, no required attribute), each
    // option in its own label[for]. One question, not loose optional boxes the planner never asks.
    const ag = type === 'checkbox' ? el.closest('fieldset[class*="checkbox-group"]') : null;
    if (ag) {
      let g = groups.get(ag);
      if (!g) {
        const title = ag.querySelector(':scope > label, :scope > legend');
        const q = title ? text(title).trim() : '';
        g = { key: `f${n++}`, kind: 'radio', label: clean(q), required: /\*\s*$/.test(q) || /required/i.test(title ? title.className : '') || !!ag.querySelector('input[required]'), options: [], value: '', error: errorNear(el), checkboxes: true };
        groups.set(ag, g);
        fields.push(g);
      }
      const lab = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      const opt = (lab ? text(lab) : el.name || '').trim();
      el.setAttribute('data-hunt-key', g.key);
      el.setAttribute('data-hunt-opt', opt);
      g.options.push(opt);
      if (el.checked) g.value = opt;
      continue;
    }
    if (type === 'checkbox') {
      const fs = el.closest('fieldset');
      const boxes = fs ? [...fs.querySelectorAll('input[type="checkbox"]')] : [];
      const optText = (b) => { const nx = b.parentElement?.nextElementSibling; return nx && !nx.querySelector('input, select, textarea') ? text(nx).trim() : ''; };
      const q = fs && fs.previousElementSibling ? text(fs.previousElementSibling).trim() : '';
      if (boxes.length === 2 && q && boxes.map(optText).map((o) => o.toLowerCase()).sort().join('|') === 'no|yes') {
        let g = groups.get(fs);
        if (!g) {
          g = { key: `f${n++}`, kind: 'radio', label: clean(q), required: /\*\s*$/.test(q) || boxes.some((b) => b.required), options: [], value: '', error: errorNear(el), checkboxes: true };
          groups.set(fs, g);
          fields.push(g);
        }
        const opt = optText(el);
        el.setAttribute('data-hunt-key', g.key);
        el.setAttribute('data-hunt-opt', opt);
        g.options.push(opt);
        if (el.checked) g.value = opt;
        continue;
      }
    }
    const raw = rawLabel(el);
    const key = `f${n++}`;
    el.setAttribute('data-hunt-key', key);
    const kind = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea'
      : type === 'checkbox' ? 'checkbox' : type === 'file' ? 'file' : type === 'number' ? 'number'
      // Date pickers (Ashby react-datepicker) take a date, never a word.
      : type === 'date' || /(^|\s)\S*input-date(\s|$)/.test(el.className || '') || el.closest('.react-datepicker-wrapper') ? 'date' : 'text';
    const options = kind === 'select' ? [...el.options].map((o) => o.text.trim()) : [];
    let value = '';
    if (kind === 'select') value = el.selectedIndex > 0 || (el.value && el.selectedIndex >= 0 && !/select/i.test(el.options[el.selectedIndex]?.text || '')) ? el.options[el.selectedIndex].text.trim() : '';
    else if (kind === 'checkbox') value = (cardOf(el) ? cardOf(el).getAttribute('aria-checked') === 'true' : el.checked) ? 'on' : '';
    else if (kind !== 'file') {
      value = el.value || '';
      // Paylocity selects keep the choice in a single-value element beside an empty input;
      // "Select a state" and "--" are placeholders, not a value.
      if (!value) {
        const box = el.closest('[class*="input-select-input-container"]');
        const sv = box && box.querySelector('[class*="single-value"]');
        const t = sv ? text(sv).trim() : '';
        if (t && !/^(select\b|--|choose\b)/i.test(t)) value = t;
      }
    }
    // Checkboxes sharing a name are one question (Greenhouse "Location Preference *": several boxes,
    // each required=""): each box carries the name and the group's label, and planFill asks the
    // group once instead of every unticked box.
    const peers = kind === 'checkbox' && el.name ? root.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`).length : 0;
    fields.push({ key, kind, label: clean(raw), required: isRequired(el, raw), options, value, error: errorNear(el), combobox: el.getAttribute('role') === 'combobox', id: el.id || '', ...(kind === 'file' ? { accept: el.getAttribute('accept') || '' } : {}), ...(peers > 1 ? { group: el.name, group_label: clean(groupLabel(el)) } : {}) });
  }
  // Yes/No toggles (Ashby): button[aria-pressed] pairs over a hidden checkbox
  // that has a name and no id; the question is the <label for> that name. One radio-style field,
  // each button tagged as an option.
  for (const grp of root.querySelectorAll('*')) {
    const btns = [...grp.children].filter((c) => c.tagName === 'BUTTON' && c.hasAttribute('aria-pressed'));
    if (btns.length < 2 || !btns.every((b) => b.getBoundingClientRect().width > 0)) continue;
    const box = grp.querySelector(':scope > input[type="checkbox"]');
    const lab = box?.name ? root.querySelector(`label[for="${CSS.escape(box.name)}"]`) : null;
    const raw = lab ? text(lab) : (grp.previousElementSibling ? text(grp.previousElementSibling) : '');
    const f = { key: `f${n++}`, kind: 'radio', label: clean(raw), required: /required/i.test(lab?.className || '') || /\*\s*$/.test(raw), options: [], value: '', error: errorNear(grp), toggle: true };
    for (const b of btns) {
      const opt = clean(text(b));
      b.setAttribute('data-hunt-key', f.key);
      b.setAttribute('data-hunt-opt', opt);
      f.options.push(opt);
      if (b.getAttribute('aria-pressed') === 'true') f.value = opt;
    }
    fields.push(f);
  }
  // react-widgets dropdowns (Paylocity: the SMS consent and "Have you applied for a job
  // with us before?" are div[role=combobox].rw-dropdownlist, no input or select, so the SMS answer
  // was never filled and Next never advanced). Options render only when opened: the runner reads
  // them then (action "pick"). The value is the shown text unless it is a placeholder.
  for (const el of root.querySelectorAll('div[role="combobox"].rw-dropdownlist, div[role="combobox"].rw-widget')) {
    // Re-tagged on every look, like the inputs (a tag left by an earlier look is no reason to skip:
    // the SMS dropdown was once lost after the first look).
    if (!shown(el)) continue;
    const grp = el.closest('.form-group') || el.parentElement;
    const lab = grp && grp.querySelector('label');
    const raw = lab ? text(lab) : (el.getAttribute('aria-label') || '');
    const shownText = text(el.querySelector('.rw-input') || el).trim();
    const key = `f${n++}`;
    el.setAttribute('data-hunt-key', key);
    fields.push({ key, kind: 'select', label: clean(raw), required: /\bform-required\b/.test(grp?.className || '') || /\(required\)|\*\s*$/i.test(raw), options: [], value: /^(--|select\b|choose\b)?$/i.test(shownText) ? '' : shownText, error: errorNear(el), combobox: true, widget: 'rw', id: el.id || '' });
  }
  // Input-less menus (Rippling: Gender, Hispanic/Latino and Veteran Status are a
  // div[role=combobox] showing "Select..." whose options render on open, in the list its
  // aria-controls names). A select with no options yet: the runner opens it and picks then.
  for (const el of root.querySelectorAll('div[role="combobox"]')) {
    if (/\brw-(dropdownlist|widget)\b/.test(el.className || '') || el.querySelector('input, select, textarea') || !shown(el)) continue;
    const shownText = text(el).replace(/\s+/g, ' ').trim();
    // A custom question can name its menu only by the placeholder ("Select"):
    // the question is the text block above the field, a few levels up.
    const al = (el.getAttribute('aria-label') || '').trim();
    const placeholderName = !al || /^(select( an)? option|select\.*|choose\.*|please select)$/i.test(al);
    const raw = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ')
      || (placeholderName ? visualLabel(el, 8)?.text : '') || al;
    const key = `f${n++}`;
    el.setAttribute('data-hunt-key', key);
    fields.push({ key, kind: 'select', label: clean(raw), required: el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(raw), options: [], value: /^(select( an)? option|select\.*|choose\.*|--+|please select)?$/i.test(shownText) ? '' : shownText, error: errorNear(el), combobox: true, widget: 'menu', id: el.id || '' });
  }
  // iCIMS dropdowns (candidate profile pages): a hidden select.dropdown-hide whose
  // options load by AJAX, shown as a.dropdown-select[role=combobox][id=<select id>_icimsDropdown] with the
  // choice in .dropdown-text and the options as li[role=option] in ul#<select id>_dropdown-results. A
  // searchable list (icimsdropdown-search=1) shows only its first 25 until typed into, so its options are
  // left to the pick (widget 'icims', search). Named by the select's label, required by its iCIMS class.
  for (const a of root.querySelectorAll('a.dropdown-select[id$="_icimsDropdown"]')) {
    if (!shown(a)) continue;
    const sid = a.id.replace(/_icimsDropdown$/, '');
    const sel = document.getElementById(sid);
    const lab = [...root.querySelectorAll(`label[for="${CSS.escape(sid)}"]`)].find((l) => text(l).trim());
    const raw = lab ? text(lab) : (sel?.getAttribute('data-label') || a.getAttribute('aria-label') || '');
    const search = sel?.getAttribute('icimsdropdown-search') === '1';
    const opts = [...document.querySelectorAll(`[id="${CSS.escape(sid)}_dropdown-results"] [role="option"]`)]
      .map((li) => text(li).replace(/\s+/g, ' ').trim()).filter((t) => t && !/^—.*—$|^no results$/i.test(t));
    const shownText = text(a.querySelector('.dropdown-text') || a).replace(/\s+/g, ' ').trim();
    const key = `f${n++}`;
    a.setAttribute('data-hunt-key', key);
    fields.push({ key, kind: 'select', label: clean(raw), required: a.getAttribute('aria-required') === 'true' || sel?.getAttribute('i_required') === 'true' || /\biCIMS_Forms_RequiredField\b/.test(sel?.className || ''), options: search ? [] : opts, value: /^(—.*—|please select\b.*)?$/i.test(shownText) ? '' : shownText, error: errorNear(a), combobox: true, widget: 'icims', id: sid, ...(search ? { search: true } : {}) });
  }
  // Input-less ARIA controls (div[role=radio|checkbox] with no <input> inside; for example
  // "Have you worked in financial services previously?"): grouped by their radiogroup /
  // fieldset, labelled by legend, aria-labelledby or the group's first text line.
  const ariaGroupLabel = (g) => {
    const lg = g.querySelector('legend');
    if (lg && text(lg).trim()) return text(lg);
    const lb = (g.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ');
    if (lb.trim()) return lb;
    if (g.getAttribute('aria-label')) return g.getAttribute('aria-label');
    let c = g;
    for (let i = 0; i < 3 && c.parentElement && c.parentElement !== root; i++) {
      c = c.parentElement;
      const first = (text(c).split('\n').map((l) => l.trim()).filter(Boolean))[0] || '';
      if (first && !g.innerText.includes(first)) return first;
    }
    return '';
  };
  const bare = [...root.querySelectorAll('[role="radio"], [role="checkbox"]')].filter((el) => !el.querySelector('input') && !el.closest('input') && el.getBoundingClientRect().width > 0);
  const ariaGroups = new Map();
  for (const el of bare) {
    const g = el.closest('[role="radiogroup"], fieldset, [role="group"]') || el.parentElement;
    if (el.getAttribute('role') === 'checkbox') {
      const raw = el.getAttribute('aria-label') || text(el);
      const key = `f${n++}`;
      el.setAttribute('data-hunt-key', key);
      fields.push({ key, kind: 'checkbox', label: clean(raw), required: el.getAttribute('aria-required') === 'true', options: [], value: el.getAttribute('aria-checked') === 'true' ? 'on' : '', error: errorNear(el), aria: true });
      continue;
    }
    let f = ariaGroups.get(g);
    if (!f) {
      const raw = ariaGroupLabel(g);
      f = { key: `f${n++}`, kind: 'radio', label: clean(raw), required: g.getAttribute('aria-required') === 'true' || /\*\s*$|\brequired\b/i.test(raw), options: [], value: '', error: errorNear(el), aria: true };
      ariaGroups.set(g, f);
      fields.push(f);
    }
    const opt = clean(el.getAttribute('aria-label') || text(el));
    el.setAttribute('data-hunt-key', f.key);
    el.setAttribute('data-hunt-opt', opt);
    f.options.push(opt);
    if (el.getAttribute('aria-checked') === 'true') f.value = opt;
  }
  const buttons = [...root.querySelectorAll('button, [role="button"], input[type="submit"]')]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.disabled; })
    .map((b) => (b.getAttribute('aria-label') || b.innerText || b.value || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Shown but disabled (Rippling's Apply stays aria-disabled until the form is complete).
  const disabledButtons = [...root.querySelectorAll('button, [role="button"], input[type="submit"]')]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (b.disabled || b.getAttribute('aria-disabled') === 'true'); })
    .map((b) => (b.getAttribute('aria-label') || b.innerText || b.value || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return {
    fields,
    buttons,
    disabled_buttons: disabledButtons,
    hasPassword,
    frames: [...document.querySelectorAll('iframe')].map((f) => f.src || '').filter(Boolean),
    text: (root.innerText || '').slice(0, 6000),
    page_text: (document.body.innerText || '').slice(0, 6000),
  };
}

// Known pre-form interstitials, matched on visible text (accessible names vary): LinkedIn's
// "Job search safety reminder" -> "Continue applying". Clicks only an exact
// text match inside a visible dialog; returns whether it clicked.
// Dice wizard slots (step 1 and the review step): the card under the "Resume *" or "Cover
// letter" label. The card is the label's nearest ancestor that also holds the slot's control
// (a "File options" menu button, an upload button, or an edit button on the review step).
// The file name is read from the element that holds only the name: a card's concatenated
// text runs "Optional" into the name (a dry run once misread an occupied slot as empty).
// Call as page.evaluate(diceSlot, 'resume' | 'cover'): it must stay self-contained.
export function diceSlot(which) {
  const root = document.querySelector('[data-hunt-root]') || document.querySelector('main') || document.body;
  const LABEL = which === 'resume' ? /^resume\s*\*?$/i : /^cover letter\s*\*?$/i;
  const NAME = /^[\w.()\- ]+\.(pdf|docx?|txt|rtf)$/i;
  const tag = which === 'resume' ? 'resume' : 'cover';
  for (const el of document.querySelectorAll(`[data-hunt-${tag}-opts], [data-hunt-${tag}-input]`)) { el.removeAttribute(`data-hunt-${tag}-opts`); el.removeAttribute(`data-hunt-${tag}-input`); }
  // The review step marks its cards (data-test-id sc-resume / sc-cover-letter).
  let card = document.querySelector(`[data-test-id="${which === 'resume' ? 'sc-resume' : 'sc-cover-letter'}"]`);
  if (!card) {
    const label = [...root.querySelectorAll('span, div, h3, h4, p, label')].find((e) => LABEL.test((e.textContent || '').trim()));
    if (!label) return { found: false, file: null, hasOptions: false, hasInput: false };
    const OTHER = which === 'resume' ? /cover letter/i : /\bresume\b/i;
    const control = (el) => el.querySelector('button[aria-haspopup], button[aria-label*="option" i]')
      || [...el.querySelectorAll('button')].find((b) => /upload your/i.test(b.textContent || ''));
    card = label;
    // Up to the card that holds the slot's control, never into an ancestor holding the other slot.
    while (card.parentElement && card.parentElement !== root && !control(card) && !OTHER.test(card.parentElement.textContent || '')) card = card.parentElement;
  }
  const leaf = [...card.querySelectorAll('*')].find((e) => !e.children.length && NAME.test((e.textContent || '').trim()));
  const opts = card.querySelector('button[aria-haspopup], button[aria-label*="option" i]');
  if (opts) opts.setAttribute(`data-hunt-${tag}-opts`, '1');
  // The upload input can sit next to the card, not in it: take the one the hint describes.
  const input = [...root.querySelectorAll('input[type="file"]')].find((i) => card.contains(i) || (which === 'cover' ? /cover/i : /resume/i).test(i.getAttribute('aria-describedby') || ''));
  if (input) input.setAttribute(`data-hunt-${tag}-input`, '1');
  return { found: true, file: leaf ? leaf.textContent.trim() : null, hasOptions: !!opts, hasInput: !!input, text: (card.innerText || card.textContent || '').trim().slice(0, 300) };
}

export function passInterstitial() {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  for (const d of document.querySelectorAll('[role="dialog"], dialog[open]')) {
    if (!shown(d)) continue;
    const btn = [...d.querySelectorAll('button, a, [role="button"]')].find((b) => shown(b) && /^continue applying$/i.test((b.innerText || '').replace(/\s+/g, ' ').trim()));
    if (btn) { btn.click(); return true; }
  }
  return false;
}

// After a Next/Review click that did not advance: every visible validation message in the
// root with the question it belongs to (first text line of the nearest container that holds
// more than the message). Feeds needs_answers so the runner never loops.
export function stuckReport() {
  const root = document.querySelector('[data-hunt-root]') || document.body;
  const out = [];
  // A select's placeholder option ("Please Select") is not a message (Paycor).
  // A question's description or hint is help text, not an error (Greenhouse: "Please select the
  // option that best describes how you found out about us." sat under a select that was already
  // answered, and the run stopped on it four times).
  // Ashby's application-limits callout ("...Please choose the roles where your experience is the
  // strongest match.") is a notice above the form, not an error.
  const helpText = (el) => !!el.closest('[id$="-description"], [class*="description"], [class*="hint"], [class*="blocking-disclosure"], [class*="applicationLimitCallout"]');
  // "SMS permission required" (Paylocity): a short "<words> required" outside a label is a
  // message too; a label's "(required)" marker is not.
  const shortRequired = (el) => !el.closest('label') && /^\s*[A-Za-z][\w ]{1,40}\s+required\.?\s*$/i.test(el.textContent || '');
  // A question's own label is the question, not a message (Greenhouse: the optional "Race: Please
  // select the racial category ..." label has no * span, so it is a bare leaf, and runs stopped
  // with Race answered). It names a control by for= or by the control's aria-labelledby.
  // An error drawn as a label (jQuery Validate's label.error for=) is still a message.
  const ownLabel = (el) => (el.tagName === 'LABEL' && !!el.htmlFor && !/error|invalid/i.test(el.className || ''))
    || (!!el.id && [...root.querySelectorAll('[aria-labelledby]')].some((c) => c.getAttribute('aria-labelledby').split(/\s+/).includes(el.id)));
  const msgs = [...root.querySelectorAll('*')].filter((el) => el.children.length === 0 && !['OPTION', 'OPTGROUP', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName) && !el.closest('template, noscript') && !helpText(el) && (/this field is required|please (enter|select|make|choose)|enter a (valid|whole)|is required|selection must be made|select at least one/i.test(el.textContent || '') || shortRequired(el)) && !ownLabel(el));
  // A message under a question that is now answered is stale (appcast shows its messages
  // when a step loads and keeps them after the box is ticked): skip it.
  const answered = (c) => !!c.querySelector('input:checked')
    || [...c.querySelectorAll('input[type="text"], input:not([type]), input[type="email"], input[type="tel"], textarea')].some((i) => i.value.trim())
    || [...c.querySelectorAll('select')].some((sel) => sel.selectedIndex > 0 && (sel.options[sel.selectedIndex]?.textContent || '').trim());
  for (const m of msgs) {
    let c = m;
    let label = '';
    for (let i = 0; i < 6 && c.parentElement && c.parentElement !== root; i++) {
      c = c.parentElement;
      const lines = (c.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1) { label = lines[0]; break; }
    }
    if (c.querySelector('input, select, textarea') && answered(c)) continue;
    out.push({ label, error: (m.textContent || '').trim() });
  }
  return out;
}

// Fields the browser or the page marks invalid without showing text (Phenom:
// Next did not advance and no message appeared). Used only after a Next that did not advance,
// never as a gate before Submit: hidden required inputs would block submits that work.
export function invalidReport() {
  const root = document.querySelector('[data-hunt-root]') || document.body;
  const out = [];
  for (const el of root.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden' || el.disabled) continue;
    const native = el.willValidate && !el.checkValidity();
    const aria = el.getAttribute('aria-invalid') === 'true';
    if (!native && !aria) continue;
    const label = (el.labels && el.labels[0] ? el.labels[0].textContent : '') || el.getAttribute('aria-label') || el.name || el.id || '';
    out.push({ label: label.replace(/\s+/g, ' ').trim(), error: native ? el.validationMessage || 'invalid' : 'aria-invalid' });
  }
  return out;
}

// Workday (myworkdayjobs.com): what the page shows, for workdayStage (apply-forms.mjs).
// data-automation-id values present, the start dialog's options (popup links and gadget iframes),
// the auth view title, account-consent boxes, the progress bar (active step and every step label),
// visible error messages and the page text. Self-contained (runs in page.evaluate).
export function workdayPage() {
  const text = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const ids = [...new Set([...document.querySelectorAll('[data-automation-id]')].map((e) => e.getAttribute('data-automation-id')))];
  const popup = document.querySelector('[data-automation-id="wd-popup-content"]');
  const startOptions = popup ? [...popup.querySelectorAll('a[data-automation-id], button[data-automation-id], iframe[data-automation-id]')]
    .map((e) => e.getAttribute('data-automation-id')).filter((x) => /^(autofillWithResume|applyManually|useMyLastApplication|applyWith\w+)$/.test(x)) : [];
  const consent = [...document.querySelectorAll('input[type="checkbox"][data-automation-id="createAccountCheckbox"]')].map((b) => {
    const lab = b.id ? document.querySelector(`label[for="${CSS.escape(b.id)}"]`) : null;
    return { label: text(lab) || b.getAttribute('aria-label') || '', checked: b.checked || b.getAttribute('aria-checked') === 'true' };
  });
  const stepOf = (li) => {
    const labs = [...li.querySelectorAll('label')].map(text);
    const m = /step (\d+) of (\d+)/i.exec(labs.join(' '));
    return { index: m ? Number(m[1]) : null, total: m ? Number(m[2]) : null, label: labs.find((l) => !/step \d+ of \d+/i.test(l)) || '' };
  };
  const bar = document.querySelector('[data-automation-id="progressBar"]');
  const active = bar && bar.querySelector('[data-automation-id="progressBarActiveStep"]');
  const errors = [...document.querySelectorAll('[data-automation-id="errorMessage"], [data-automation-id="errorBanner"], [role="alert"]')].filter(shown).map(text).filter(Boolean);
  return {
    url: location.href,
    ids,
    startOptions,
    authTitle: text(document.getElementById('authViewTitle')),
    consent,
    step: active ? stepOf(active) : null,
    steps: bar ? [...bar.querySelectorAll(':scope > li')].map((li) => stepOf(li).label) : [],
    errors,
    text: (document.body.innerText || '').slice(0, 6000),
  };
}

// The Walmart controls the runner presses or types into (Playwright selectors). Continue carries only
// aria-label="Continue", and the header's job search form has a submit button of its
// own, so Continue is looked up inside the email box's form.
export const WALMART_SEL = {
  apply: '[data-id="job-apply-button"]:visible',
  email: 'input#email',
  continue: 'form:has(input#email) button[aria-label="Continue"]:visible',
  otp: 'input[data-testid^="otp-input-"]',
  verify: '[data-testid="otp-verify-button"]',
};

// Walmart careers (careers.walmart.com): what walmartStage needs. The shown "Apply now"
// buttons (data-id job-apply-button; the responsive panes hide all but one), the contact page's email
// box (#email) and its boxes (the site terms: label text without the Read more button inside the
// label), the code boxes (data-testid otp-input-<n>), the questionnaire form, its progress text, an
// SSN field, shown alerts and the page text. Self-contained (runs in page.evaluate).
export function walmartPage() {
  const text = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const apply = [...document.querySelectorAll('[data-id="job-apply-button"]')].filter(shown)
    .map((b) => ({ label: (b.getAttribute('aria-label') || text(b)).trim(), disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true' }));
  const form = document.querySelector('form[aria-labelledby="questionnaire-title"]');
  const emailBox = document.querySelector('input#email');
  const email = !!emailBox && !form;
  const consent = email ? [...(emailBox.closest('form') || document).querySelectorAll('input[type="checkbox"]')].map((b) => {
    const lab = b.closest('label') || (b.id ? document.querySelector(`label[for="${CSS.escape(b.id)}"]`) : null);
    const copy = lab ? lab.cloneNode(true) : null;
    if (copy) for (const x of copy.querySelectorAll('button, input, svg')) x.remove();
    return { id: b.id || '', label: text(copy), checked: !!b.checked };
  }) : [];
  const nav = document.querySelector('main nav[aria-label], nav[aria-label*="progress" i]');
  return {
    url: location.href,
    apply,
    email,
    consent,
    otp: document.querySelectorAll('input[data-testid^="otp-input-"]').length,
    form: !!form,
    progress: nav ? text(nav) : null,
    ssn: !!document.querySelector('[data-testid^="ssn-"], input[id^="ssn-input-"]'),
    errors: [...document.querySelectorAll('[role="alert"]')].filter(shown).map(text).filter(Boolean),
    text: (document.body.innerText || '').slice(0, 6000),
  };
}

// The page's HTML for a capture file, with every password input's value removed (attribute and
// property): React mirrors typed values into the value attribute, and a password never goes into
// data/ (a standing rule). The live page is not changed. Self-contained (runs in page.evaluate).
export function safeHtml(selector) {
  const src = (selector && document.querySelector(selector)) || document.documentElement;
  const copy = src.cloneNode(true);
  for (const el of copy.querySelectorAll('input[type="password" i]')) { el.removeAttribute('value'); el.value = ''; }
  for (const el of copy.querySelectorAll('script')) el.remove();
  return copy.outerHTML;
}

// Workday wizard page: every top-level [data-automation-id^="formField-"] container is
// one question, named by data-fkit-id (name--legalName--firstName, workExperience-7--jobTitle,
// primaryQuestionnaire--<id>). Its label (a legend for a group) ends in * when required. Kinds:
// a listbox button (widget wd-list, options read by opening it), a search prompt (wd-prompt, the
// picked items as selectedItem pills), month/day/year date sections (wd-date), radios, a checkbox
// group (one question, checkboxes: true), one checkbox, a file upload (value: the uploaded names),
// text and textarea. Entry fields carry {section, index, part}, index counted in page order. Also
// returns the Add sections ({name, entries}), the footer buttons and the page's error messages.
// Tags each control with data-hunt-key (options also data-hunt-opt). Self-contained.
export function workdayFields() {
  const root = document.querySelector('[data-hunt-root]') || document.querySelector('[data-automation-id="applyFlowPage"]') || document.body;
  const text = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const clean = (t) => String(t || '').replace(/\s*\*\s*$/, '').trim();
  const ENTRY = /^(workExperience|education|language|website|certification|skill)s?-(\d+)--(\w+)/;
  for (const el of root.querySelectorAll('[data-hunt-key]')) { el.removeAttribute('data-hunt-key'); el.removeAttribute('data-hunt-opt'); }
  const fields = [];
  let n = 0;
  const optText = (input) => {
    const lab = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
    const t = clean(text(lab) || input.getAttribute('aria-label') || '');
    if (t) return t;
    if (/^(true|false)$/i.test(input.value)) return /^true$/i.test(input.value) ? 'Yes' : 'No';
    return clean(text(input.parentElement));
  };
  const containers = [...root.querySelectorAll('[data-automation-id^="formField-"]')]
    .filter((c) => !c.parentElement.closest('[data-automation-id^="formField-"]') && shown(c) && !c.querySelector('[data-automation-id="beecatcher"]'));
  for (const c of containers) {
    const ctl = c.querySelector('input:not([type="hidden"]), textarea, button[aria-haspopup="listbox"]');
    if (!ctl) continue;
    const id = c.getAttribute('data-fkit-id') || ctl.id || '';
    const lab = c.querySelector('legend') || c.querySelector('label');
    const raw = text(lab);
    const controls = [...c.querySelectorAll('input:not([type="hidden"]), textarea, button[aria-haspopup="listbox"]')];
    const required = /\*$/.test(raw) || controls.some((e) => e.required || e.getAttribute('aria-required') === 'true');
    const alert = c.querySelector('[data-automation-id="inputAlert"], [data-automation-id="errorMessage"], [role="alert"]');
    const f = { key: `w${n++}`, id, label: clean(raw), required, options: [], value: '', error: alert ? text(alert) || null : null };
    const file = c.querySelector('input[type="file"]');
    const dates = [...c.querySelectorAll('[data-automation-id="dateSectionMonth-input"], [data-automation-id="dateSectionDay-input"], [data-automation-id="dateSectionYear-input"]')];
    const listBtn = c.querySelector('button[aria-haspopup="listbox"]');
    const prompt = c.querySelector('input[data-uxi-widget-type="selectinput"], input[data-automation-id="searchBox"], [data-automation-id="multiSelectContainer"] input, [data-automation-id="multiselectInputContainer"] input');
    const radios = [...c.querySelectorAll('input[type="radio"]')];
    const boxes = [...c.querySelectorAll('input[type="checkbox"]')];
    if (file) {
      Object.assign(f, { kind: 'file', value: [...c.querySelectorAll('[data-automation-id="file-upload-item-name"]')].map(text).filter(Boolean), accept: file.getAttribute('accept') || '' });
      file.setAttribute('data-hunt-key', f.key);
    } else if (dates.length) {
      const part = (p) => dates.find((d) => d.getAttribute('data-automation-id') === `dateSection${p}-input`);
      const [m, d, y] = ['Month', 'Day', 'Year'].map(part);
      const vals = [m, d, y].filter(Boolean).map((e) => e.value.trim());
      Object.assign(f, { kind: 'date', widget: 'wd-date', format: [m && 'MM', d && 'DD', y && 'YYYY'].filter(Boolean).join('/'), value: vals.every(Boolean) ? vals.join('/') : '' });
      dates[0].setAttribute('data-hunt-key', f.key);
    } else if (listBtn) {
      const t = text(listBtn);
      Object.assign(f, { kind: 'select', widget: 'wd-list', value: /^select one$/i.test(t) ? '' : t });
      listBtn.setAttribute('data-hunt-key', f.key);
    } else if (prompt) {
      Object.assign(f, { kind: 'select', widget: 'wd-prompt', value: [...c.querySelectorAll('[data-automation-id="selectedItem"]')].map(text).filter(Boolean).join('; ') });
      prompt.setAttribute('data-hunt-key', f.key);
    } else if (radios.length || boxes.length > 1) {
      const group = radios.length ? radios : boxes;
      Object.assign(f, { kind: 'radio', ...(radios.length ? {} : { checkboxes: true }) });
      for (const r of group) {
        const o = optText(r);
        r.setAttribute('data-hunt-key', f.key);
        r.setAttribute('data-hunt-opt', o);
        f.options.push(o);
        if (r.checked && !f.value) f.value = o;
      }
    } else if (boxes.length === 1) {
      Object.assign(f, { kind: 'checkbox', value: boxes[0].checked || boxes[0].getAttribute('aria-checked') === 'true' ? 'on' : '' });
      boxes[0].setAttribute('data-hunt-key', f.key);
    } else {
      const box = c.querySelector('textarea') || c.querySelector('input');
      Object.assign(f, { kind: box.tagName === 'TEXTAREA' ? 'textarea' : 'text', value: box.value || '' });
      box.setAttribute('data-hunt-key', f.key);
    }
    const m = ENTRY.exec(id);
    if (m) f.entry = { section: m[1], n: Number(m[2]), part: m[3] };
    fields.push(f);
  }
  // Entry index: the order of each section's entry numbers on the page.
  const seen = {};
  for (const f of fields) {
    if (!f.entry) continue;
    const list = (seen[f.entry.section] = seen[f.entry.section] || []);
    if (!list.includes(f.entry.n)) list.push(f.entry.n);
    f.entry = { section: f.entry.section, index: list.indexOf(f.entry.n), part: f.entry.part };
  }
  const sections = [];
  for (const g of root.querySelectorAll('[role="group"][aria-labelledby$="-section"]')) {
    const add = g.querySelector(':scope > button[data-automation-id="add-button"], :scope > div > button[data-automation-id="add-button"]')
      || [...g.querySelectorAll('button')].find((b) => /^add( another)?$/i.test(text(b)) && !b.closest('[role="group"][aria-labelledby$="-panel"]'));
    if (!add) continue;
    const name = text(document.getElementById(g.getAttribute('aria-labelledby')));
    const nums = new Set([...g.querySelectorAll('[data-fkit-id], input[id], textarea[id], button[id]')]
      .map((e) => ENTRY.exec(e.getAttribute('data-fkit-id') || e.id || '')).filter(Boolean).map((x) => x[2]));
    sections.push({ name, entries: nums.size });
  }
  const footer = [...root.querySelectorAll('button[data-automation-id^="pageFooter"]')].filter(shown).map(text).filter(Boolean);
  const errors = [...root.querySelectorAll('[data-automation-id="errorHeading"], [data-automation-id="errorBanner"], [data-automation-id="inputAlert"]')].filter(shown).map(text).filter(Boolean);
  return { fields, sections, footer, errors, text: (root.innerText || '').slice(0, 6000) };
}

// The iCIMS controls the runner presses or types into. icimsPage() finds them by role and wording, not
// by portal ids (each employer's portal differs), and tags them: run it before using these selectors.
export const ICIMS_SEL = {
  apply: '[data-hunt-apply]',
  email: '[data-hunt-email]',
  next: '[data-hunt-next]',
  consent: '[data-hunt-consent]',
  password: '[data-hunt-pw]',
  code: '[data-hunt-code]',
};

// iCIMS portal page (loaded as its in_iframe=1 frame): what icimsStage needs. The first
// heading, the shown Apply controls ("Apply for this job online"), the login email box with its privacy
// boxes (a box that says only "I accept" is named with the block before it), password and code boxes,
// whether a file input exists, the count of shown controls, the shown buttons, alerts and the page text.
// Tags the controls ICIMS_SEL names. Self-contained (runs in page.evaluate).
export function icimsPage() {
  const text = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const labelOf = (el) => (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) || el.closest('label');
  // A styled box hides the input and shows its label.
  const shownCtl = (el) => shown(el) || (['checkbox', 'radio'].includes(el.type) && !!labelOf(el) && shown(labelOf(el)));
  for (const a of ['data-hunt-apply', 'data-hunt-email', 'data-hunt-next', 'data-hunt-consent', 'data-hunt-code', 'data-hunt-pw']) for (const el of document.querySelectorAll(`[${a}]`)) el.removeAttribute(a);
  const heading = text([...document.querySelectorAll('h1, h2')].find(shown));
  const controls = [...document.querySelectorAll('input, select, textarea')]
    .filter((e) => !['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(String(e.type || '').toLowerCase()) && shownCtl(e));
  const pw = controls.filter((e) => e.type === 'password');
  pw.forEach((e, i) => e.setAttribute('data-hunt-pw', String(i)));
  const typed = controls.filter((e) => e.tagName === 'INPUT' && ['text', 'email', 'tel', 'number', ''].includes(e.type));
  const emailBox = typed.find((e) => e.type === 'email' || /e-?mail/i.test(`${e.id} ${e.name} ${e.getAttribute('autocomplete') || ''}`)) || null;
  if (emailBox) emailBox.setAttribute('data-hunt-email', '1');
  const words = (e) => `${e.id} ${e.name} ${e.getAttribute('aria-label') || ''} ${e.placeholder || ''} ${text(labelOf(e))}`;
  const code = typed.filter((e) => e !== emailBox && (e.getAttribute('autocomplete') === 'one-time-code'
    || (/\b(code|otp|passcode|pin|verification|one[- ]time)\b/i.test(words(e)) && !/zip|postal|country|area|promo|referr|phone|dial/i.test(words(e)))));
  code.forEach((e) => e.setAttribute('data-hunt-code', '1'));
  // The context before a short box label: the nearest text block before the box's wrappers, up to 300 characters.
  const context = (el) => {
    for (let node = el, i = 0; i < 4 && node && node !== document.body; i++, node = node.parentElement) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.matches('input, select, textarea, label') || sib.querySelector('input, select, textarea')) break;
        const t = text(sib);
        if (t && t.length <= 300) return t;
      }
    }
    return '';
  };
  const scope = emailBox ? (emailBox.closest('form') || document) : null;
  const consent = scope ? [...scope.querySelectorAll('input[type="checkbox"]')].filter(shownCtl).map((b, i) => {
    b.setAttribute('data-hunt-consent', String(i));
    const copy = labelOf(b)?.cloneNode(true);
    if (copy) for (const x of copy.querySelectorAll('button, input, svg')) x.remove();
    const own = text(copy) || b.getAttribute('aria-label') || '';
    const ctx = own.split(/\s+/).filter(Boolean).length < 6 ? context(b) : '';
    return { label: [ctx, own].filter(Boolean).join(' '), checked: !!b.checked };
  }) : [];
  if (scope) {
    const btns = [...scope.querySelectorAll('button, input[type="submit"]')].filter(shown);
    const next = btns.find((b) => b.type === 'submit' || /^(next|continue)$/i.test(text(b) || b.value || '')) || null;
    if (next) next.setAttribute('data-hunt-next', '1');
  }
  const applies = [...document.querySelectorAll('a, button')].filter(shown).filter((e) => /^apply( for this (job|position)( online)?| now| online)?$/i.test(text(e) || e.getAttribute('title') || ''));
  if (applies[0]) applies[0].setAttribute('data-hunt-apply', '1');
  return {
    url: location.href,
    heading,
    apply: applies.map((e) => text(e) || e.getAttribute('title')),
    email: !!emailBox,
    consent,
    passwords: pw.length,
    code: code.length,
    file: !!document.querySelector('input[type="file"]'),
    inputs: controls.length,
    buttons: [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].filter((b) => shown(b) && !b.disabled)
      .map((b) => (b.getAttribute('aria-label') || text(b) || b.value || '').trim()).filter(Boolean),
    errors: [...document.querySelectorAll('[role="alert"], .iCIMS_Error, .iCIMS_ErrorMessage')].filter(shown).map(text).filter(Boolean),
    text: (document.body.innerText || '').slice(0, 6000),
  };
}
