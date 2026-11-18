// The Node.js minimum: package.json engines.node, the newest minimum any pinned dependency
// declares (pdfjs-dist needs 22.13). doctor checks against it; bin/bootstrap reads the same field.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_ROOT } from './paths.mjs';

export const parseVersion = (v) => String(v).replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0).concat([0, 0, 0]).slice(0, 3);

const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// A version satisfies a range of ">=X", ">= X" or "^X" alternatives joined by "||".
export function satisfies(version, range) {
  const v = parseVersion(version);
  return String(range).split('||').some((alt) => {
    const m = /^\s*(>=|\^)\s*v?([\d.]+)\s*$/.exec(alt);
    if (!m) return false;
    const min = parseVersion(m[2]);
    if (m[1] === '>=') return cmp(v, min) >= 0;
    return v[0] === min[0] && cmp(v, min) >= 0;
  });
}

const engines = JSON.parse(readFileSync(join(CODE_ROOT, 'package.json'), 'utf8')).engines?.node || '>=0.0.0';
export const MIN_NODE = engines.replace(/^>=\s*/, '');
export const nodeOk = (version = process.versions.node) => satisfies(version, engines);
