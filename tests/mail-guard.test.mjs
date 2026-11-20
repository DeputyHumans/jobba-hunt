// onboard mail-guard: deny every tool of a mail connector except its reads, in .claude/settings.local.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONNECTORS, guardRules, mergeDeny } from '../scripts/lib/mail-guard.mjs';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

const G = 'mcp__claude_ai_Gmail__';

test('gmail: the catalog write tools and every live tool that is not a read are denied; the reads never are', () => {
  const live = ['search_threads', 'get_message', 'get_thread', 'send_message', 'brand_new_tool', `${G}create_draft`];
  const r = guardRules({ connector: 'gmail', tools: live });
  assert.deepEqual(r.kept.sort(), [`${G}get_message`, `${G}get_thread`, `${G}search_threads`]);
  for (const w of CONNECTORS.gmail.write) assert.ok(r.deny.includes(`${G}${w}`), w);
  assert.ok(r.deny.includes(`${G}brand_new_tool`), 'an unknown live tool is denied');
  for (const k of r.kept) assert.ok(!r.deny.includes(k), k);
  assert.deepEqual(r.unknown, [`${G}brand_new_tool`]);
});

test('gmail: a live list without any read tool is refused, and a foreign server prefix is refused', () => {
  assert.throws(() => guardRules({ connector: 'gmail', tools: ['send_message'] }), /no read tool/);
  assert.throws(() => guardRules({ connector: 'gmail', tools: ['mcp__other__search_threads'] }), /another server/);
  assert.throws(() => guardRules({ connector: 'outlook' }), /unknown connector/);
  const noLive = guardRules({ connector: 'gmail' });
  assert.equal(noLive.kept.length, 3);
  assert.ok(noLive.deny.includes(`${G}send_message`));
});

test('mergeDeny keeps every other setting and deny entry, and adds each rule once', () => {
  const cfg = { permissions: { allow: ['Bash(ls)'], deny: ['Bash(rm:*)', `${G}send_message`] }, env: { A: '1' } };
  const merged = mergeDeny(cfg, [`${G}send_message`, `${G}reply`]);
  assert.deepEqual(merged.permissions.allow, ['Bash(ls)']);
  assert.deepEqual(merged.permissions.deny, ['Bash(rm:*)', `${G}send_message`, `${G}reply`]);
  assert.deepEqual(merged.env, { A: '1' });
  assert.deepEqual(cfg.permissions.deny, ['Bash(rm:*)', `${G}send_message`], 'the input is not changed');
});

test('npm run onboard -- mail-guard --connector gmail writes the deny list; usage errors exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobba-guard-'));
  const file = join(dir, 'settings.local.json');
  writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
  const run = (...a) => spawnSync(process.execPath, [join(CODE_ROOT, 'scripts', 'onboard.mjs'), 'mail-guard', ...a], { encoding: 'utf8', env: { ...process.env, JOBBA_CLAUDE_LOCAL_SETTINGS: file } });
  try {
    const r = run('--connector', 'gmail', '--tools', 'search_threads,get_message,get_thread,send_message,odd_tool');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const res = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(res.connector, 'gmail');
    assert.equal(res.kept.length, 3);
    assert.deepEqual(res.unknown, [`${G}odd_tool`]);
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(cfg.permissions.allow, ['Bash(ls)']);
    assert.ok(cfg.permissions.deny.includes(`${G}odd_tool`) && cfg.permissions.deny.includes(`${G}send_message`));
    assert.ok(!cfg.permissions.deny.some((d) => /search_threads|get_message|get_thread/.test(d)));
    assert.equal(run('--connector', 'gmail', '--tools', 'send_message').status, 1);
    assert.equal(run('--connector', 'nope').status, 2);
    assert.equal(run().status, 2);
    assert.equal(run('--deny', 'mcp__x__send').status, 0, 'the plain --deny form still works');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
