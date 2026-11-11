// Plain text from a .docx file with no external tool: a minimal zip reader (central directory,
// stored or deflated entries through node:zlib) plus a paragraph-aware read of word/document.xml.
// Used by onboarding to ingest a CV or cover letter the user supplies as Word.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    out.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = (name) => {
    const e = out.get(name);
    if (!e) return null;
    const lNameLen = buf.readUInt16LE(e.local + 26);
    const lExtraLen = buf.readUInt16LE(e.local + 28);
    const start = e.local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data);
    throw new Error(`unsupported zip compression method ${e.method}`);
  };
  return { names: [...out.keys()], read };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e]).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

export function documentXmlToText(xml) {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, t) => `\u0000${t}\u0001`)
    .replace(/<[^>]+>/g, '')
    .replace(/\u0000([^\u0001]*)\u0001/g, (_, t) => unescape(t))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function docxToText(path) {
  const zip = zipEntries(readFileSync(path));
  const xml = zip.read('word/document.xml');
  if (!xml) throw new Error('word/document.xml not found: not a Word document');
  return documentXmlToText(xml.toString('utf8'));
}
