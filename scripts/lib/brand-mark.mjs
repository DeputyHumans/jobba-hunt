// The optional logo mark of the generated pages (tracker, recruiter pages, prep briefs). It is
// read from brand/mark.json, which only a workspace brand folder holds: the shipped brand pack
// has none, so every page stays text-only until the user adds one.
//   { "viewBox": "-5 -5 34 34",
//     "frame": { "x": 3, "y": 3, "size": 18, "strokeWidth": 2 },   a square outline in the ink colour
//     "seal":  { "x": 10, "y": 10, "size": 7 } }                    a filled square in the accent (--blue)

import { existsSync, readFileSync } from 'node:fs';
import { brandFile } from './paths.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// The mark from the brand folder, or null when there is none (or it is not valid JSON).
export function loadMark(file = brandFile('mark.json')) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function markSvg(mark) {
  if (!mark?.frame || !mark?.seal) return '';
  const f = mark.frame;
  const s = mark.seal;
  return `<svg viewBox="${esc(mark.viewBox)}" aria-hidden="true" focusable="false"><rect x="${num(f.x)}" y="${num(f.y)}" width="${num(f.size)}" height="${num(f.size)}" fill="none" stroke="currentColor" stroke-width="${num(f.strokeWidth)}"/><rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.size)}" height="${num(s.size)}" fill="var(--blue)"/></svg>`;
}

// The wordmark beside a mark: one word per line, and a trailing full stop in the accent colour
// ("Example Studio." sets "Studio" over its accent stop).
export function wordmarkName(text) {
  const t = String(text ?? '').trim();
  const stop = t.endsWith('.');
  const words = (stop ? t.slice(0, -1) : t).split(/\s+/).filter(Boolean);
  return `<span class="wordmark-name">${words.map((w, i) => `<span>${esc(w)}${stop && i === words.length - 1 ? '<span class="period">.</span>' : ''}</span>`).join('')}</span>`;
}
