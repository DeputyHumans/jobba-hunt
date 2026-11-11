// The Word copy of a CV, written from the same model as the HTML and PDF (cv.mjs assemble), so
// the two never drift. ATS-plain on purpose: one column, real headings, real list bullets, no
// tables, text boxes, images or fields, and a font every word processor has. Some application
// portals parse .docx more reliably than PDF; this is the copy for them.
//
//   cvDocx(model, { paper })  -> Promise<Buffer>   the .docx bytes
//   docxText(buffer)          -> string             the document's paragraph text, one per line
//                                                   (a zip reader on node:zlib, for checks and tests)

import { inflateRawSync } from 'node:zlib';
import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, Tab, TabStopType, TextRun } from 'docx';
import { displayText, paperOf } from './cv.mjs';

const TWIP = 1440; // per inch
const FONT = 'Arial';
const BULLETS = 'cv-bullets';

const run = (text, opts = {}) => new TextRun({ text, font: FONT, ...opts });

export async function cvDocx(m, { paper = 'letter' } = {}) {
  const sheet = paperOf(paper);
  const t = (s) => displayText(s, m.nobreak);
  const p = m.person;
  const textWidth = Math.round((sheet.widthIn - 1.4) * TWIP);
  const heading = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 80 }, children: [run(text.toUpperCase(), { bold: true, size: 22, color: '23466B' })] });
  const bullet = (children) => new Paragraph({ numbering: { reference: BULLETS, level: 0 }, spacing: { after: 40 }, children });
  // Title and company left, dates at a right tab stop: one line in Word, and "Title · Company Dates"
  // in a parser's text, the order the PDF's text layer has.
  const roleLine = (title, company, dates, size = 20) => new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: textWidth }],
    spacing: { before: 120, after: 20 },
    keepNext: true,
    children: [run(t(title), { bold: true, size }), ...(company ? [run(` · ${t(company)}`, { size })] : []), new TextRun({ font: FONT, size: size - 2, children: [new Tab(), dates] })],
  });

  const body = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 60 }, children: [run(p.name, { bold: true, size: 40 })] }),
    new Paragraph({ spacing: { after: 40 }, children: [run(t(m.headline), { size: 22, color: '23466B' })] }),
    new Paragraph({ spacing: { after: 120 }, children: [run([p.location, p.workplace, p.email, p.linkedin].filter(Boolean).join(' · '), { size: 18 })] }),
    heading('Summary'),
    new Paragraph({ spacing: { after: 60 }, children: [run(t(m.summary), { size: 20 })] }),
    heading('Career Highlights'),
    ...m.highlights.map((h) => bullet([run(`${t(h.label)}: `, { bold: true, size: 20 }), run(t(h.text), { size: 20 })])),
    heading('Skills'),
    ...m.skills.map((g) => bullet([run(`${t(g.label)}: `, { bold: true, size: 20 }), run(t(g.terms.join(', ')), { size: 20 })])),
    heading('Experience'),
  ];
  for (const r of m.roles) {
    body.push(roleLine(r.title, r.company, r.dates));
    body.push(new Paragraph({ spacing: { after: 40 }, keepNext: true, children: [run(t(r.context), { italics: true, size: 19 })] }));
    for (const b of r.blocks) {
      if (b.type === 'sub') body.push(roleLine(b.label, null, b.dates, 19));
      else body.push(bullet([run(t(b.text), { size: 20 })]));
    }
  }
  for (const r of m.earlier) {
    body.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [run(t(r.title), { bold: true, size: 19 }), run(` · ${t(r.company)} · ${r.dates}. ${t(r.line)}`, { size: 19 })] }));
  }
  body.push(heading('Education'));
  for (const e of m.education) body.push(bullet([run(`${t(e.degree)} · ${t(e.school)}`, { size: 20 }), run(` · ${e.year}`, { size: 20 })]));

  const doc = new Document({
    creator: p.name,
    title: m.title,
    description: m.description || '',
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    numbering: {
      config: [{
        reference: BULLETS,
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 280, hanging: 200 } } } }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: Math.round(sheet.widthIn * TWIP), height: Math.round(sheet.heightIn * TWIP) },
          margin: { top: Math.round(0.6 * TWIP), bottom: Math.round(0.6 * TWIP), left: Math.round(0.7 * TWIP), right: Math.round(0.7 * TWIP) },
        },
      },
      children: body,
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------- reading a .docx back ----------
// One entry of a zip archive (stored or deflated), found through the central directory.
export function zipEntry(buf, name) {
  const b = Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i -= 1) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = b.readUInt16LE(eocd + 10);
  let at = b.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k += 1) {
    if (b.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = b.readUInt16LE(at + 10);
    const size = b.readUInt32LE(at + 20);
    const nameLen = b.readUInt16LE(at + 28);
    const extraLen = b.readUInt16LE(at + 30);
    const commentLen = b.readUInt16LE(at + 32);
    const local = b.readUInt32LE(at + 42);
    const entry = b.toString('utf8', at + 46, at + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      const data = b.subarray(start, start + size);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Paragraph text of word/document.xml, one paragraph per line; tabs become a space.
export function docxText(buf) {
  const xml = zipEntry(buf, 'word/document.xml')?.toString('utf8');
  if (!xml) throw new Error('no word/document.xml in the archive');
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
    .map((p) => (p.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:tab\/>/g) || []).map((x) => (x === '<w:tab/>' ? ' ' : unxml(x.replace(/<[^>]+>/g, '')).replace(/\t/g, ' '))).join(''))
    .filter((l) => l.trim())
    .join('\n');
}
