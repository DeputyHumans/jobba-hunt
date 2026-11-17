// CV generator core. Pure: no browser, no filesystem. One source of truth
// (<workspace>/collateral/cv/master.json) plus one variant file per target role produce a
// single-column CV whose every line traces to a claim in collateral/claim-bank.md. The same model
// feeds the never-claim lint, keyword coverage and the PDF text-layer checks, so what is linted
// is exactly what a recruiter and an ATS read.
//
// Owner-specific settings live in master.json, never here:
//   source_ref_prefixes  citation prefixes that count as provenance where no claim row exists
//                        (e.g. ["CV"] accepts "CV:12" or "CV:12-14", a line in a source CV)
//   nobreak              phrases kept on one line with no-break spaces (e.g. "SOC 2")
//   links                { "<company or product name>": "<url>" }: each name links on the CV
//   employers            { "<key>": { name, dates, claims } }: a role with "via": "<key>" was a
//                        client engagement through that employer ("Client (via Employer)")
// All default to empty. A role may also list "clients": [{ name, claims }], which a variant's
// practice section shows as "Featured clients".

// A line reference into a source document ("CV:12", "CV:12-14"), or null when none is configured.
export function sourceRefRe(prefixes = []) {
  const ok = (prefixes || []).filter((x) => /^[A-Za-z][A-Za-z0-9_]*$/.test(String(x)));
  return ok.length ? new RegExp(`^(?:${ok.join('|')}):\\d+(-\\d+)?$`) : null;
}

// A retired row ("| C20 | **Retired …") keeps its ID reserved but no longer counts as provenance.
export function claimIdsFromBank(md) {
  return new Set([...md.matchAll(/^\| (C\d{2,}) \|(?! \*\*Retired)/gm)].map((m) => m[1]));
}

// ---------- validation ----------
export function validateVariant(master, v, claimIds) {
  const errs = [];
  const sourceRef = sourceRefRe(master.source_ref_prefixes);
  const checkClaims = (where, claims) => {
    if (!claims || !claims.length) { errs.push(`${where}: no claim`); return; }
    for (const c of claims) if (!claimIds.has(c) && !(sourceRef && sourceRef.test(c))) errs.push(`${where}: unknown claim ${c}`);
  };
  checkClaims('person', master.person.claims);
  if (v.contact) {
    for (const k of Object.keys(v.contact)) if (!CONTACT_KEYS.includes(k)) errs.push(`contact: unknown key ${k}`);
    if ('phone' in v.contact && v.contact.phone !== 'profile' && v.contact.phone !== null) errs.push('contact.phone: only "profile" (the number in profile/person.json) or null is allowed');
  }
  checkClaims('summary', v.summary?.claims);
  (v.highlights || []).forEach((h) => checkClaims(`highlight "${h.label}"`, h.claims));
  (v.skills || []).forEach((g) => checkClaims(`skills "${g.label}"`, g.claims));
  // One experience-shaped entry: the experience list and the practice section share it.
  const checkEntry = (e, where) => {
    const role = master.roles[e.role];
    if (!role) { errs.push(`${where}: unknown role ${e.role}`); return; }
    checkClaims(`role ${e.role}`, role.claims);
    if (role.via) {
      const emp = master.employers?.[role.via];
      if (!emp) errs.push(`role ${e.role}: unknown employer ${role.via}`);
      else checkClaims(`employer ${role.via}`, emp.claims);
    }
    if (e.title) {
      const t = role.titles?.[e.title];
      if (!t) errs.push(`role ${e.role}: unknown title ${e.title}`);
      else checkClaims(`role ${e.role} title`, t.claims);
    }
    const ctx = role.contexts?.[e.context || 'default'];
    if (!ctx) errs.push(`role ${e.role}: unknown context ${e.context}`);
    else checkClaims(`role ${e.role} context`, ctx.claims);
    for (const it of e.items || []) {
      if (typeof it === 'object') {
        if (!role.subheads?.[it.sub]) errs.push(`role ${e.role}: unknown sub-head ${it.sub}`);
        continue;
      }
      const b = master.bullets[it];
      if (!b) errs.push(`role ${e.role}: unknown bullet ${it}`);
      else checkClaims(`bullet ${it}`, b.claims);
    }
  };
  for (const e of v.experience || []) checkEntry(e, 'experience');
  if (v.practice) {
    checkEntry(v.practice, 'practice');
    const role = master.roles[v.practice.role];
    if (v.practice.clients) {
      if (!role?.clients?.length) errs.push(`practice: role ${v.practice.role} has no clients`);
      else role.clients.forEach((c) => checkClaims(`client ${c.name}`, c.claims));
    }
    if ('heading' in v.practice && !String(v.practice.heading || '').trim()) errs.push('practice.heading: empty');
  }
  for (const id of v.earlier || []) {
    const r = master.roles[id];
    if (!r || !r.line) errs.push(`earlier: unknown role ${id}`);
    else checkClaims(`earlier ${id}`, r.line.claims);
  }
  (master.education || []).forEach((ed, i) => checkClaims(`education ${i}`, ed.claims));
  checkClaims('languages', master.languages?.claims);
  return errs;
}

// ---------- model ----------
// A variant may override the contact line for one target role: a new location, `workplace: null`
// to drop a "Remote (US)" that would misread for an on-site role, and the phone. The variant file
// never holds a number: `phone: "profile"` shows the one in profile/person.json, `phone: null`
// hides it. Without either, person.json's show_phone_on_cv decides (wantsPhone).
const CONTACT_KEYS = ['location', 'workplace', 'phone'];
export const wantsPhone = (v, showByDefault = false) => {
  const c = v?.contact;
  if (c && 'phone' in c) return c.phone === 'profile';
  return Boolean(showByDefault);
};
// The caller reads the number and passes it in only when wantsPhone says so.
export function contactFor(person, contact, phone) {
  if (!contact && !phone) return person;
  const p = { ...person };
  if (contact && 'location' in contact) p.location = contact.location;
  if (contact && 'workplace' in contact) p.workplace = contact.workplace;
  if (phone) p.phone = phone;
  return p;
}
// Text with the one number this CV may carry taken out, for the never-claim lint (which fails on
// any phone number) and the publish privacy check.
export const withoutPhone = (text, phone) => (phone ? String(text).split(phone).join('') : String(text));

export const PRACTICE_HEADING = 'Independent Practice';

export function assemble(master, v, { phone } = {}) {
  const entry = (e) => {
    const r = master.roles[e.role];
    const blocks = (e.items || []).map((it) => (typeof it === 'object'
      ? { type: 'sub', ...r.subheads[it.sub] }
      : { type: 'li', text: master.bullets[it].text }));
    const title = e.title ? r.titles[e.title].text : r.title;
    const company = r.via ? `${r.company} (via ${master.employers[r.via].name})` : r.company;
    return { id: e.role, title, company, dates: r.dates, context: r.contexts[e.context || 'default'].text, blocks };
  };
  const roles = (v.experience || []).map(entry);
  // A practice (one's own consultancy or freelance work) sits below Experience in its own
  // section, with its featured clients.
  const practice = v.practice
    ? {
      ...entry(v.practice),
      heading: String(v.practice.heading || PRACTICE_HEADING),
      clients: v.practice.clients ? master.roles[v.practice.role].clients.map((c) => c.name) : [],
    }
    : null;
  const earlier = (v.earlier || []).map((id) => {
    const r = master.roles[id];
    return { id, title: r.title, company: r.company, dates: r.dates, line: r.line.text };
  });
  return {
    person: contactFor(master.person, v.contact, phone),
    title: v.title || `${master.person.name}, ${v.target_title}, CV`,
    description: v.description || v.headline,
    headline: v.headline,
    target_title: v.target_title,
    summary: v.summary.text,
    highlights: v.highlights.map((h) => ({ label: h.label, text: h.text })),
    skills: v.skills.map((g) => ({ label: g.label, terms: g.terms })),
    roles,
    earlier,
    practice,
    education: master.education,
    nobreak: master.nobreak || [],
    links: master.links || {},
  };
}

// The person block a CV and a letter print: the workspace identity (profile/person.json) with
// master.json's person fields over it where they are set. profile is person() at the call site.
export function cvPerson(profile = {}, own = {}) {
  const link = String(profile.links?.linkedin || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  const base = {
    name: profile.name || '',
    location: profile.location?.display || [profile.location?.city, profile.location?.region].filter(Boolean).join(', '),
    workplace: profile.workplace || '',
    email: String(profile.application_email || profile.email || ''),
    linkedin: link,
  };
  const set = Object.fromEntries(Object.entries(own || {}).filter(([, v]) => v !== '' && v != null));
  return { ...base, ...set, claims: own?.claims || [] };
}

export const eduText = (e) => (e.note ? `${e.degree} (${e.note})` : e.degree);
const practiceLines = (p) => (p ? [`${p.title} · ${p.company}`, p.dates, p.context, ...p.blocks.map((b) => (b.type === 'sub' ? `${b.label} ${b.dates}` : b.text)),
  ...(p.clients.length ? [`Featured clients: ${p.clients.join(', ')}`] : [])] : []);

export function modelText(m) {
  return [
    ...[m.person.name, m.headline, m.person.location, m.person.workplace, m.person.phone, m.person.email, m.person.linkedin].filter((x) => x != null && x !== ''),
    m.summary,
    ...m.highlights.map((h) => `${h.label}: ${h.text}`),
    ...m.skills.map((g) => `${g.label}: ${g.terms.join(', ')}`),
    ...m.roles.flatMap((r) => [`${r.title} · ${r.company}`, r.dates, r.context, ...r.blocks.map((b) => (b.type === 'sub' ? `${b.label} ${b.dates}` : b.text))]),
    ...m.earlier.flatMap((r) => [`${r.title} · ${r.company}`, r.dates, r.line]),
    ...practiceLines(m.practice),
    ...m.education.flatMap((e) => [eduText(e), e.school, e.year]),
  ].join('\n');
}

// The body sections of a CV as labelled segments, for the repetition check. The name, headline,
// contact line, role titles and dates are left out: they repeat by design (header and footer).
export function bodySegments(m) {
  return [
    ['summary', m.summary],
    ...m.highlights.map((h) => [`highlight "${h.label}"`, `${h.label}: ${h.text}`]),
    ...m.skills.map((g) => [`skills "${g.label}"`, `${g.label}: ${g.terms.join(', ')}`]),
    ...m.roles.flatMap((r) => [[`${r.id} context`, r.context], ...r.blocks.filter((b) => b.type !== 'sub').map((b, i) => [`${r.id} bullet ${i + 1}`, b.text])]),
    ...m.earlier.map((r) => [`earlier ${r.id}`, r.line]),
    ...(m.practice ? [[`${m.practice.id} context`, m.practice.context], ...m.practice.blocks.filter((b) => b.type !== 'sub').map((b, i) => [`${m.practice.id} bullet ${i + 1}`, b.text])] : []),
  ];
}

// Phrases of n or more words that one CV says twice: a reader notices a CV that repeats itself.
// One finding per pair of places, with the first repeated phrase.
export function repeatedPhrases(segments, n = 5) {
  const words = (s) => String(s).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9+]+/g) || [];
  const seen = new Map();
  segments.forEach(([where, text], si) => {
    const w = words(text);
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n).join(' ');
      if (!seen.has(g)) seen.set(g, []);
      seen.get(g).push(si);
    }
  });
  const out = [];
  const pairs = new Set();
  for (const [g, at] of seen) {
    if (at.length < 2) continue;
    const key = [...new Set(at)].sort((a, b) => a - b).join(',');
    if (pairs.has(key)) continue;
    pairs.add(key);
    out.push({ phrase: g, where: [...new Set(at)].map((i) => segments[i][0]) });
  }
  return out;
}

// ---------- HTML ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Display text only (never attributes): curly quotes and apostrophes, and no-break spaces
// inside units a line break would split (master.json nobreak). Plain UTF-8, so ATS-safe.
const nobreakPairs = (list) => (list || []).filter((p) => /\s/.test(String(p))).map((p) => [String(p), String(p).replace(/ /g, '\u00a0')]);
const typoWith = (pairs) => (s) => pairs.reduce((t, [a, b]) => t.split(a).join(b), String(s))
  .replace(/(^|[\s(\[])"/g, '$1“').replace(/"/g, '”')
  .replace(/(\w)'(\w)/g, '$1’$2').replace(/(^|[\s(\[])'/g, '$1‘').replace(/'/g, '’');
// The same display text without HTML (curly quotes, no-break units), for the .docx copy.
export const displayText = (s, nobreak = []) => typoWith(nobreakPairs(nobreak))(s);
// Numeric ranges ("10–25", "2020–21") sit in a nowrap span: no break at the dash, and no
// invisible joiner characters in the PDF text layer.
const txWith = (typo) => (s) => esc(typo(s)).replace(/(\d+–\d+)/g, '<span class="nb">$1</span>');

// Lists carry a real bullet glyph as text with a hanging indent: the glyph plus the x-offset
// between an item's first line and its wraps is what lets a parser (or a PDF text layer) split
// items instead of merging a whole list into one paragraph.
const bul = (items) => `<ul class="bul">${items.map((h) => `<li><span class="b">• </span>${h}</li>`).join('')}</ul>`;

// Company and product names in master.json links become links: a recruiter reading the HTML or
// PDF can open each one. Only text between tags is touched, never inside a tag or an existing
// anchor, so the text layer an ATS reads is unchanged. Longest names first, so "Acme Corp
// Labs" wins over "Acme Corp". typo is the display-text transform the names went through.
export function linkify(html, links, typo = (s) => String(s)) {
  const names = Object.keys(links || {}).filter((n) => n.trim()).sort((a, b) => b.length - a.length);
  let out = html;
  for (const name of names) {
    const shown = esc(typo(name)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w.-])(${shown})(?![\\w-])`, 'gi');
    out = out.split(/(<a\b[^>]*>[^]*?<\/a>)/).map((part) => (part.startsWith('<a') ? part
      : part.split(/(<[^>]+>)/).map((t) => (t.startsWith('<') ? t : t.replace(re, `<a class="co" href="${esc(links[name])}">$1</a>`))).join(''))).join('');
  }
  return out;
}

function roleHead(tx, title, company, dates, cls = 'role-head') {
  return `<div class="${cls}"><span class="role-name"><span class="role-title">${tx(title)}</span>`
    + `${company ? `<span class="role-sep"> · </span><span class="role-company">${tx(company)}</span>` : ''}</span>`
    + `<span class="dates">${esc(dates)}</span></div>`;
}

export function renderHtml(m, css) {
  const typo = typoWith(nobreakPairs(m.nobreak));
  const tx = txWith(typo);
  const p = m.person;
  const sep = '<span class="sep"> · </span>';
  // A sub-head and its bullets form one group that never breaks across pages, so a page
  // break falls between programmes, not inside one.
  const roles = m.roles.map((r) => {
    let body = '';
    let open = [];
    let inSub = false;
    const flush = () => { if (open.length) { body += bul(open); open = []; } if (inSub) body += '</div>'; };
    for (const b of r.blocks) {
      if (b.type === 'sub') {
        flush();
        inSub = true;
        body += `<div class="sub-group"><div class="sub-head"><span>${tx(b.label)}</span><span class="dates">${esc(b.dates)}</span></div>`;
      } else {
        open.push(tx(b.text));
      }
    }
    flush();
    // A short role (three bullets or fewer, no sub-heads) never breaks across pages: it cannot
    // split 2 + 2 (checkPageSplit), so a split would leave a lone bullet on a page. A four-bullet
    // role may still split 2 + 2; kept whole it would jump to the next page and leave a gap.
    const short = !r.blocks.some((b) => b.type === 'sub') && r.blocks.length <= 3;
    return `<div class="role${short ? ' keep' : ''}">${roleHead(tx, r.title, r.company, r.dates)}<p class="context">${tx(r.context)}</p>${body}</div>`;
  }).join('\n');
  // Earlier roles are one paragraph each, "Title · Company · Dates. Description.". Dates stay
  // inline: a right-hand dates column next to a wrapping paragraph comes out of a PDF text layer
  // as one detached line of dates.
  const earlier = m.earlier.length
    ? `<div class="earlier">${m.earlier.map((r) => `<p class="role early"><span class="role-title">${tx(r.title)}</span>`
      + `<span class="role-sep"> · </span><span class="role-company">${tx(r.company)}</span><span class="role-sep"> · </span>`
      + `<span class="early-dates">${esc(r.dates)}</span><span class="early-line">. ${tx(r.line)}</span></p>`).join('\n')}</div>`
    : '';
  const pr = m.practice;
  const practice = pr
    ? `<section class="practice"><h2>${tx(pr.heading)}</h2><div class="role">${roleHead(tx, pr.title, pr.company, pr.dates)}`
      + `<p class="context">${tx(pr.context)}</p>${pr.blocks.some((b) => b.type !== 'sub') ? bul(pr.blocks.filter((b) => b.type !== 'sub').map((b) => tx(b.text))) : ''}`
      + `${pr.clients.length ? `<p class="clients">Featured clients: ${pr.clients.map(tx).join(', ')}</p>` : ''}</div></section>`
    : '';
  const contact = [p.location, p.workplace, p.phone].filter((x) => x != null && x !== '').map(esc)
    .concat(`<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`, ...(p.linkedin ? [`<a href="https://www.${esc(p.linkedin)}/">${esc(p.linkedin)}</a>`] : []))
    .join(sep);
  const body = linkify(`<section class="summary"><h2>Summary</h2><p>${tx(m.summary)}</p></section>
<section class="highlights"><h2>Career Highlights</h2>${bul(m.highlights.map((h) => `<strong>${tx(h.label)}:</strong> ${tx(h.text)}`))}</section>
<section class="skills"><h2>Skills</h2>${bul(m.skills.map((g) => `<strong>${tx(g.label)}:</strong> ${tx(g.terms.join(', '))}`))}</section>
<section class="experience"><h2>Experience</h2>
${roles}
${earlier}
</section>
${practice}
<section class="education"><h2>Education</h2><ul class="bul">${m.education.map((e) => `<li class="edu"><span class="b">• </span>${roleHead(tx, eduText(e), e.school, e.year, 'role-head inline')}</li>`).join('')}</ul></section>`, m.links, typo);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(m.title)}</title>
<meta name="author" content="${esc(p.name)}">
<meta name="description" content="${esc(m.description)}">
<style>${css}</style></head>
<body><main>
<header>
<h1>${esc(p.name)}</h1>
<p class="headline">${m.headline.split(' · ').map((part, i) => `<span class="${i ? 'hs' : 'ht'}">${tx(part)}</span>`).join('<span class="hsep"> · </span>')}</p>
<p class="contact">${contact}</p>
</header>
${body}
</main></body></html>
`;
}

// ---------- paper, fonts, footer ----------
// Sheet sizes for preferences.cv.paper: letter (default) or a4. heightIn drives the static
// pagination's page-body height; css is the @page size keyword.
export const PAPER = {
  letter: { name: 'letter', format: 'Letter', css: 'letter', widthCss: '8.5in', heightCss: '11in', widthIn: 8.5, heightIn: 11, pt: [612, 792] },
  a4: { name: 'a4', format: 'A4', css: 'A4', widthCss: '210mm', heightCss: '297mm', widthIn: 210 / 25.4, heightIn: 297 / 25.4, pt: [595, 842] },
};
export const paperOf = (name) => PAPER[String(name || 'letter').toLowerCase()] || PAPER.letter;

// CV page margins in inches: page.pdf prints with them, and each screen sheet pads with them.
export const CV_MARGINS = { top: 0.5, bottom: 0.55, x: 0.62 };

// The sheet size as the custom properties template.css reads (Letter is the stylesheet default).
export const sheetCss = (paper = PAPER.letter) => `:root { --sheet-w: ${paper.widthCss}; --sheet-h: ${paper.heightCss}; }`;
// The saved, paginated HTML prints one sheet per page with no browser margin (and so no URL or
// date lines from the browser).
export const pageRuleCss = (paper = PAPER.letter) => `@page { size: ${paper.css}; margin: 0; }`;

// @font-face sources become data: URIs, so the saved HTML renders with the bundled fonts in any
// viewer, including one that sandboxes the page and loads no local file. readFont(fileName)
// returns the font's bytes (the build resolves it in brand/fonts).
const FONT_MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
export function inlineFonts(css, readFont) {
  return String(css).replace(/url\((['"]?)([^'")]+\.(woff2|woff|ttf|otf))\1\)/g, (all, q, ref, ext) => {
    const name = ref.split('/').pop();
    const bytes = readFont(name);
    if (!bytes) throw new Error(`font file ${name} not found`);
    return `url(data:${FONT_MIME[ext]};base64,${Buffer.from(bytes).toString('base64')})`;
  });
}

// The footer page.pdf draws in the bottom margin: "<left> ... N / M". Chromium renders the
// template in its own document, so the face it uses is declared inside it (fontFaceCss, with
// an inlined source) or it falls back to a system font.
export function pdfFooterTemplate(left, { fontFaceCss = '', family = "'Nunito Sans', Helvetica, Arial, sans-serif", marginX = CV_MARGINS.x } = {}) {
  return `<style>${fontFaceCss}</style><div style="width:100%;padding:0 ${marginX}in;display:flex;justify-content:space-between;font-family:${family};font-size:10px;color:#6b7480;letter-spacing:0.2px;">`
    + `<span>${esc(left)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

// ---------- lint ----------
export function lintText(text, rules) {
  const hits = [];
  for (const r of rules.patterns || []) {
    const m = text.match(new RegExp(r.re, 'i'));
    if (m) hits.push({ id: r.id, match: m[0], why: r.why });
  }
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const r of rules.sentence_rules || []) {
    for (const s of sentences) {
      if (new RegExp(r.if, 'i').test(s) && !new RegExp(r.requires, 'i').test(s)) hits.push({ id: r.id, match: s.trim().slice(0, 120), why: r.why });
    }
  }
  return hits;
}

// ---------- keywords ----------
const norm = (s) => ` ${String(s).toLowerCase().replace(/[‐-―/-]/g, ' ').replace(/\s+/g, ' ')} `;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function has(normText, keyword) {
  // Plural-tolerant: "roadmap" matches "roadmaps", "startup" matches "startups".
  return keyword.split('|').some((alt) => new RegExp(`[^a-z0-9]${escRe(norm(alt).trim())}(s|es)?[^a-z0-9]`).test(normText));
}

export function coverage(text, keywords) {
  const t = norm(text);
  const matched = keywords.filter((k) => has(t, k));
  const missing = keywords.filter((k) => !has(t, k));
  return { matched, missing, pct: keywords.length ? Math.round((100 * matched.length) / keywords.length) : 100 };
}

// Rank CVs for one job description. The vocabulary is the union of every CV's
// target_keywords; the JD's terms are those it contains; each CV scores the share of
// those terms its own text covers.
export function rankForJd(jdText, cvs) {
  const vocab = [...new Set(cvs.flatMap((c) => c.keywords))];
  const jd = norm(jdText);
  const jdTerms = vocab.filter((k) => has(jd, k));
  return cvs.map((c) => {
    const t = norm(c.text);
    const matched = jdTerms.filter((k) => has(t, k));
    return { slug: c.slug, pct: jdTerms.length ? Math.round((100 * matched.length) / jdTerms.length) : 0, matched, missing: jdTerms.filter((k) => !has(t, k)), jd_terms: jdTerms.length };
  }).sort((a, b) => b.pct - a.pct || a.missing.length - b.missing.length);
}

// Targeted CVs (a recruiter list's own folder, build-cv --dir) join the standard variants for a
// --match. With a candidate, only that targeted CV joins: the other tailored CVs' keywords would
// move the yardstick the same way a candidate's own keywords do.
export function variantPool(standard, extra = [], candidate = null) {
  const pool = [...standard, ...(candidate ? extra.filter((v) => v.slug === candidate) : extra)];
  const seen = new Set();
  for (const v of [...standard, ...extra]) {
    if (seen.has(v.slug)) throw new Error(`duplicate CV slug ${v.slug}: a targeted CV may not reuse a standard slug`);
    seen.add(v.slug);
  }
  return pool;
}

// ---------- PDF text-layer checks (pdf.mjs pageTexts output) ----------
const HEADINGS = ['SUMMARY', 'CAREER HIGHLIGHTS', 'SKILLS', 'EXPERIENCE', 'EDUCATION'];
const dash = (s) => s.replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
// The section headings of one CV in reading order: a practice section sits before Education.
export const headingsFor = (m) => (m.practice ? [...HEADINGS.slice(0, 4), dash(m.practice.heading).toUpperCase(), 'EDUCATION'] : HEADINGS);
const headRoles = (m) => [...m.roles, ...m.earlier, ...(m.practice ? [m.practice] : [])];

export function checkExtracted(text, m) {
  const errs = [];
  // A bullet glyph starts an item, as it does for an ATS segmenter, even when the text layer
  // joins short same-indent items into one line.
  const lines = text.split('\n').flatMap((l) => l.split(/\s(?=• )/)).map((l) => dash(l).replace(/^• /, '')).filter(Boolean);
  if (lines[0] !== m.person.name) errs.push(`first line is "${lines[0]}", not the name`);
  if (!lines.some((l) => l.includes(m.person.email))) errs.push('email missing from the text layer');
  let last = -1;
  for (const h of headingsFor(m)) {
    const i = lines.findIndex((l) => l.toUpperCase() === h);
    if (i < 0) errs.push(`heading ${h} missing`);
    else if (i < last) errs.push(`heading ${h} out of order`);
    else last = i;
  }
  const exp = lines.findIndex((l) => l.toUpperCase() === 'EXPERIENCE');
  for (const r of headRoles(m)) {
    const i = lines.findIndex((l, k) => k > exp && l.includes(dash(r.title)) && (l.includes(dash(r.company)) || (lines[k + 1] || '').includes(dash(r.company))));
    if (i < 0) { errs.push(`role "${r.title} · ${r.company}" not found`); continue; }
    if (!lines.slice(i, i + 4).some((l) => l.includes(dash(r.dates)))) errs.push(`role "${r.title}": dates ${r.dates} not right after the title`);
  }
  for (const g of m.skills) if (!lines.some((l) => l.startsWith(`${g.label}:`))) errs.push(`skills group "${g.label}" does not start its own line`);
  return errs;
}

// A role that breaks across the page boundary must keep at least two bullets on each side:
// a lone bullet at the top of page 2 (or under a role head at the bottom of page 1) reads
// as a layout accident. Input is the text of page 1 and page 2 (pdf.mjs pageTexts).
export function checkPageSplit(p1, p2, m) {
  const items = (t) => t.split('\n').flatMap((l) => l.split(/\s(?=• )/)).map((l) => dash(l)).filter(Boolean);
  const heads = headRoles(m).map((r) => ({ title: dash(r.title), company: dash(r.company), name: r.title }));
  const subs = m.roles.flatMap((r) => r.blocks.filter((b) => b.type === 'sub').map((b) => dash(b.label)));
  const isHead = (l) => heads.find((h) => l.includes(h.title) && l.includes(h.company));
  const isBoundary = (l) => isHead(l) || subs.some((s) => l.startsWith(s)) || headingsFor(m).includes(l.toUpperCase());
  const a = items(p1);
  const b = items(p2);
  if (!b.length || !b[0].startsWith('• ')) return [];
  let i = a.length - 1;
  while (i >= 0 && !isBoundary(a[i])) i -= 1;
  const owner = i >= 0 ? isHead(a[i]) || { name: a[i] } : { name: '(unknown)' };
  const before = a.slice(i + 1).filter((l) => l.startsWith('• ')).length;
  let after = 0;
  while (after < b.length && b[after].startsWith('• ')) after += 1;
  const errs = [];
  if (before < 2) errs.push(`"${owner.name}" splits across pages with ${before} bullet${before === 1 ? '' : 's'} on page 1`);
  if (after < 2) errs.push(`"${owner.name}" splits across pages with ${after} bullet${after === 1 ? '' : 's'} on page 2`);
  return errs;
}
