// Screen rendering of a CV as the same pages the PDF has: opened in a browser, the HTML reads
// like the printed document, page limits included. A browser cannot paginate flowing HTML on
// screen, and a published copy runs no scripts, so build-cv.mjs paginates once in Chromium and
// saves static HTML: it reads where each PDF page starts (pdf.mjs pageTexts), splits the DOM
// before that block, and wraps every part in a sheet.
//
// pageStarts is pure. paginate runs in the page (page.evaluate): self-contained, no imports.

const norm = (s) => String(s).replace(/ /g, ' ').replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

// pageTexts: the text of each page (pdf.mjs pageTexts; index 0 is page 1). For pages 2..N, the
// first content line, skipping the footer drawn in the bottom margin ("Name · title · email",
// "2 / 2"). A text layer can join a sub-head with the bullet under it ("Sub-head label • first
// bullet…") while the DOM holds the sub-head's dates between the two: such a start is the label
// alone. Elsewhere the bullet glyph is dropped (the DOM's own "• " is matched loosely).
const startKey = (l) => {
  const i = l.indexOf('•');
  return i >= 12 ? l.slice(0, i).trim() : l.replace(/•/g, '').replace(/\s+/g, ' ').trim();
};

export function pageStarts(pageTexts, footerLead) {
  const foot = norm(footerLead);
  return pageTexts.slice(1).map((t) => {
    const l = t.split('\n').map(norm).find((x) => x && !x.startsWith(foot) && !/^\d+ \/ \d+$/.test(x));
    return l ? startKey(l) : null;
  });
}

export function paginate({ starts, footLeft, pageHeightPx }) {
  const main = document.querySelector('main');
  const unify = (c) => (c === ' ' ? ' ' : /[‐-―]/.test(c) ? '-' : /[‘’]/.test(c) ? "'" : /[“”]/.test(c) ? '"' : c);

  // Find the block a page starts with: match the line, spaces ignored (the text layer and the
  // DOM place spaces differently around right-aligned dates), then climb while the block opens
  // its parent, so the break falls before the whole role, sub-group or section.
  function locate(root, line) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('style') ? 2 : 1) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    let stream = '';
    const owner = [];
    nodes.forEach((n, i) => { for (const c of n.data) { const u = unify(c); if (!/\s/.test(u)) { stream += u; owner.push(i); } } });
    const target = [...line].map(unify).filter((c) => !/\s/.test(c)).join('').slice(0, 48);
    const at = stream.indexOf(target);
    if (at < 1) return { error: at === 0 ? 'starts at the top of the remaining content' : 'not found' };
    if (stream.indexOf(target, at + 1) >= 0) return { error: 'ambiguous' };
    let el = nodes[owner[at]].parentElement.closest('li, p, h2, header, .role-head, .sub-head');
    if (!el || !root.contains(el)) return { error: 'no block' };
    while (el.parentElement !== root && el.parentElement.firstElementChild === el) el = el.parentElement;
    return { el };
  }

  // Move el and everything after it (at every level up to root) into clones of its ancestors.
  function splitBefore(el, root) {
    let node = el;
    let carry = null;
    let includeNode = true;
    for (;;) {
      const parent = node.parentElement;
      const target = parent === root ? document.createDocumentFragment() : parent.cloneNode(false);
      if (carry) target.appendChild(carry);
      let n = includeNode ? node : node.nextSibling;
      while (n) { const next = n.nextSibling; target.appendChild(n); n = next; }
      if (parent === root) return target;
      carry = target;
      node = parent;
      includeNode = false;
    }
  }

  const roots = [main];
  for (const line of starts) {
    const root = roots[roots.length - 1];
    if (!line) return { error: `page ${roots.length + 1}: no first line in the PDF text` };
    const r = locate(root, line);
    if (r.error) return { error: `page ${roots.length + 1} start "${line.slice(0, 60)}": ${r.error}` };
    const next = root.cloneNode(false);
    next.appendChild(splitBefore(r.el, root));
    roots.push(next);
  }

  // Print layout drops a block's margin where a page breaks: the last block's bottom margin and,
  // after a break, the first block's top margin. A sheet keeps its whole content, so it trims
  // them itself; otherwise a full sheet prints a hair taller than the page and spills over.
  const trim = (start, prop, step) => { for (let n = start; n; n = n[step]) n.style[prop] = '0'; };
  roots.forEach((r, i) => {
    trim(r.lastElementChild, 'marginBottom', 'lastElementChild');
    if (i > 0) trim(r.firstElementChild, 'marginTop', 'firstElementChild');
  });

  const sheets = document.createElement('main');
  sheets.className = 'sheets';
  roots.forEach((r, i) => {
    const page = document.createElement('div');
    page.className = 'page';
    const body = document.createElement('div');
    body.className = 'page-body';
    while (r.firstChild) body.appendChild(r.firstChild);
    const foot = document.createElement('div');
    foot.className = 'page-foot';
    foot.innerHTML = `<span></span><span>${i + 1} / ${roots.length}</span>`;
    foot.firstChild.textContent = footLeft;
    page.append(body, foot);
    sheets.appendChild(page);
  });
  main.replaceWith(sheets);

  const overflow = [...document.querySelectorAll('.page-body')]
    .map((b, i) => ({ page: i + 1, px: Math.round(b.getBoundingClientRect().height - pageHeightPx) }))
    .filter((o) => o.px > 1);
  return { pages: roots.length, overflow };
}
