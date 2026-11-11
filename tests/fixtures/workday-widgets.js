// Behaviour for the synthetic Workday wizard fixtures (synthetic-workday-*.html), modelled on Workday
// tenant markup: listbox buttons whose options render a moment after a click
// (in the box, or at the end of <body> with aria-controls set only once open), search prompts
// (Enter lists the matching items, a click picks one into a selectedItem pill), month/year date
// sections, Add buttons that render an entry with page-numbered field ids, and a resume upload
// that lists the file's name. Loaded inline by each fixture (network is blocked in the tests).
(() => {
  const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
  const closeAll = () => document.querySelectorAll('[data-wd-popup]').forEach((e) => e.remove());
  // Escape closes an open listbox, nothing chosen (live Workday does the same).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const ul of document.querySelectorAll('ul[role="listbox"][data-wd-popup]')) {
      const b = document.getElementById(ul.id.replace(/-list$/, ''));
      if (b) { b.setAttribute('aria-expanded', 'false'); b.removeAttribute('aria-controls'); }
      ul.remove();
    }
  });
  window.wdWire = (root = document) => {
    for (const b of root.querySelectorAll('button[aria-haspopup="listbox"][data-options]')) {
      if (b.dataset.wired) continue; b.dataset.wired = '1';
      b.addEventListener('click', () => {
        if (document.getElementById(`${b.id}-list`)) return;
        b.setAttribute('aria-expanded', 'true');
        const ul = el(`<ul role="listbox" id="${b.id}-list" data-wd-popup="1"></ul>`);
        for (const o of ['Select One', ...JSON.parse(b.dataset.options)]) {
          const li = el(`<li role="option" ${o === 'Select One' ? 'aria-disabled="true"' : ''}><div>${o}</div></li>`);
          li.addEventListener('click', () => { b.textContent = o; b.setAttribute('aria-expanded', 'false'); b.removeAttribute('aria-controls'); ul.remove(); });
          ul.appendChild(li);
        }
        setTimeout(() => { (b.dataset.portal ? document.body : b.parentElement).appendChild(ul); b.setAttribute('aria-controls', ul.id); }, 150);
      });
    }
    for (const input of root.querySelectorAll('input[data-uxi-widget-type="selectinput"][data-tree]')) {
      if (input.dataset.wired) continue; input.dataset.wired = '1';
      const tree = JSON.parse(input.dataset.tree);
      const leaves = Object.entries(tree).flatMap(([k, v]) => v || [k]);
      const pills = input.parentElement.querySelector('[data-automation-id="selectedItemList"]');
      const pick = (name) => {
        if (input.dataset.single) pills.innerHTML = '';
        pills.appendChild(el(`<li><div data-automation-id="selectedItem" role="option" title="${name}"><p data-automation-id="promptOption">${name}</p><span data-automation-id="DELETE_charm" aria-label="delete"></span></div></li>`));
        input.value = ''; closeAll();
      };
      const show = (rows) => {
        closeAll();
        const list = el('<div data-automation-id="activeListContainer" role="listbox" data-wd-popup="1"></div>');
        for (const name of rows) {
          const row = el(`<div role="option"><div data-automation-id="promptLeafNode"><div data-automation-id="promptOption" data-automation-label="${name}">${name}</div></div></div>`);
          row.addEventListener('click', () => (Array.isArray(tree[name]) ? show(tree[name]) : pick(name)));
          list.appendChild(row);
        }
        document.body.appendChild(list);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAll();
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!input.value) return show(Object.keys(tree));
        const found = leaves.filter((o) => !o.includes('(') && o.toLowerCase().includes(input.value.toLowerCase()));
        setTimeout(() => (found.length === 1 ? pick(found[0]) : show(found)), 150);
      });
    }
    for (const f of root.querySelectorAll('input[type="file"][data-automation-id="file-upload-input-ref"]')) {
      if (f.dataset.wired) continue; f.dataset.wired = '1';
      f.addEventListener('change', () => {
        const items = f.closest('[data-automation-id^="formField-"]').querySelector('[data-wd-files]');
        for (const file of f.files) setTimeout(() => items.appendChild(el(`<div data-automation-id="file-upload-item"><div data-automation-id="file-upload-item-name">${file.name}</div><button type="button" data-automation-id="delete-file">Delete</button></div>`)), 200);
      });
    }
    for (const add of root.querySelectorAll('button[data-automation-id="add-button"][data-entry]')) {
      if (add.dataset.wired) continue; add.dataset.wired = '1';
      add.addEventListener('click', () => {
        const tpl = document.getElementById(add.dataset.entry);
        const n = Number(add.dataset.next || tpl.dataset.start);
        add.dataset.next = String(n + 1);
        const count = add.closest('[role="group"]').querySelectorAll('[data-wd-entry]').length + 1;
        setTimeout(() => {
          const entry = el(tpl.innerHTML.replace(/\{n\}/g, String(n)).replace(/\{i\}/g, String(count)));
          add.before(entry);
          add.textContent = 'Add Another';
          window.wdWire(entry);
        }, 200);
      });
    }
  };
  window.wdWire();
})();
