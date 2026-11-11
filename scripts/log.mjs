#!/usr/bin/env node
// The action log, readable (npm run log): every state change the hunt recorded, oldest first.
//   node scripts/log.mjs [--since <iso date or time | 6h | 2d>] [--job <id>] [--limit n] [--json]
// Default output is a table in the user's time zone; --json prints one JSON object
// { success, count, rows } (the last-line contract of every CLI here).

import { parseArgs, out, fail } from './cloak-core.mjs';
import { readActions, ACTIONS_LOG } from './lib/actions-log.mjs';
import { display } from './lib/paths.mjs';
import { tz } from './lib/profile.mjs';

const { flags } = parseArgs(process.argv.slice(2));

function sinceOf(v, now = Date.now()) {
  if (v == null || v === true) return null;
  const rel = /^(\d+)\s*([hd])$/i.exec(String(v).trim());
  if (rel) return new Date(now - Number(rel[1]) * (rel[2].toLowerCase() === 'h' ? 36e5 : 864e5)).toISOString();
  if (Number.isNaN(Date.parse(v))) fail(`--since needs an ISO date or time, or Nh / Nd (got ${v})`);
  return new Date(Date.parse(v)).toISOString();
}

const limit = flags.limit == null || flags.limit === true ? null : Number(flags.limit);
if (limit != null && !(Number.isInteger(limit) && limit > 0)) fail('--limit needs a positive whole number');
const rows = readActions({ since: sinceOf(flags.since), job: typeof flags.job === 'string' ? flags.job : null, limit });

if (flags.json) {
  out({ success: true, count: rows.length, log: display(ACTIONS_LOG), rows });
  process.exit(0);
}

const zone = tz() || 'UTC';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const when = (iso) => { const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
const detail = (d) => (d == null ? '' : typeof d === 'string' ? d : Object.entries(d).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' '));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const table = rows.map((r) => [when(r.at), r.actor || '', r.action || '', r.job_id || '', clip(detail(r.detail).replace(/\s+/g, ' '), 90)]);
const head = [`When (${zone})`, 'Actor', 'Action', 'Job', 'Detail'];
const widths = head.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
const line = (cols) => cols.map((c, i) => (i === cols.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd();
if (!rows.length) console.log(`No actions logged${flags.since || flags.job ? ' for that filter' : ''} (${display(ACTIONS_LOG)}).`);
else console.log([line(head), line(widths.map((w) => '-'.repeat(w))), ...table.map(line)].join('\n'));
