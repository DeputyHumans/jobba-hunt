// Stand-in for iCIMS's dropdown widget script, which page captures leave out. It does what the
// live markup implies: a.dropdown-select[id=<sid>_icimsDropdown] toggles #<sid>_icimsDropdown_ctnr; the
// container's search box filters the list by what was typed, a moment later (the portal loads results by
// AJAX); clicking an option sets the hidden select <sid>, writes the option in .dropdown-text and closes the
// list. A State/Province list says "No Results" until its Country is chosen. Full lists come from
// window.ICIMS_LISTS[<sid>] when a test gives one (a State list: { <country>: [states] }), else the items shown.
(() => {
  const lists = window.ICIMS_LISTS || {};
  const PH = '— Make a Selection —';
  const shownItems = (ul) => [...ul.querySelectorAll('[role="option"]')].map((li) => li.textContent.trim()).filter((t) => t && t !== PH && !/^no results$/i.test(t));
  const full = {};
  for (const ul of document.querySelectorAll('ul.dropdown-results[id$="_dropdown-results"]')) {
    const sid = ul.id.replace(/_dropdown-results$/, '');
    full[sid] = Array.isArray(lists[sid]) ? lists[sid] : shownItems(ul);
  }
  const render = (sid, list) => {
    const ul = document.getElementById(`${sid}_dropdown-results`);
    ul.innerHTML = '';
    const add = (t, i) => { const li = document.createElement('li'); li.className = 'dropdown-result result-selectable'; li.setAttribute('role', 'option'); li.setAttribute('dropdown-index', String(i)); li.textContent = t; ul.appendChild(li); };
    add(PH, -1);
    if (!list.length) add('No Results', 0);
    list.slice(0, 25).forEach((t, i) => add(t, i));
  };
  const ctnr = (sid) => document.getElementById(`${sid}_icimsDropdown_ctnr`);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.dropdown-select[id$="_icimsDropdown"]');
    if (a) {
      const c = ctnr(a.id.replace(/_icimsDropdown$/, ''));
      a.setAttribute('aria-expanded', String(!c.classList.toggle('dropdown-invisible')));
      return;
    }
    const li = e.target.closest('ul.dropdown-results [role="option"]');
    if (!li) return;
    const sid = li.closest('ul').id.replace(/_dropdown-results$/, '');
    const t = li.textContent.trim();
    if (t === PH || /^no results$/i.test(t)) return;
    const sel = document.getElementById(sid);
    sel.appendChild(new Option(t, t, true, true));
    // window.ICIMS_TEXT_DELAY: the live AJAX widget writes the shown text late.
    const show = () => { document.getElementById(`${sid}_icimsDropdown`).querySelector('.dropdown-text').textContent = t; };
    if (window.ICIMS_TEXT_DELAY) setTimeout(show, window.ICIMS_TEXT_DELAY); else show();
    ctnr(sid).classList.add('dropdown-invisible');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (/AddressCountry$/.test(sid)) {
      const st = sid.replace(/AddressCountry$/, 'AddressState');
      full[st] = ((lists[st] || {})[t]) || [];
      render(st, full[st]);
    }
  });
  // window.ICIMS_TRUSTED_KEYS: search only on a real (trusted) keyup, the way a live searchable list
  // ignores a value set in the page. Otherwise on input.
  const onSearch = (e) => {
    if (window.ICIMS_TRUSTED_KEYS ? !(e.type === 'keyup' && e.isTrusted) : e.type !== 'input') return;
    const s = e.target.closest && e.target.closest('.dropdown-container input.dropdown-search');
    if (!s) return;
    const sid = s.closest('.dropdown-container').id.replace(/_icimsDropdown_ctnr$/, '');
    const q = s.value.trim().toLowerCase();
    setTimeout(() => render(sid, (full[sid] || []).filter((t) => t.toLowerCase().includes(q))), 150);
  };
  document.addEventListener('input', onSearch);
  document.addEventListener('keyup', onSearch);
})();
