import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_ROOT, HOME, DATA_DIR, display, resolveArgPath, toolBin, insideProject } from '../scripts/lib/paths.mjs';
import { parseDotEnv, childEnv } from '../scripts/lib/env.mjs';
import { deepMerge, loadConfig, loadSearchConfig } from '../scripts/lib/config.mjs';
import { person, preferences, answers, filePrefix, cvFileBase, coverFileBase, CV_FILE_RE, applicationEmail, operatorName, tz } from '../scripts/lib/profile.mjs';
import { logAction, readActions } from '../scripts/lib/actions-log.mjs';
import { notifyCommand, notify } from '../scripts/lib/notify.mjs';
import { planLinks } from '../scripts/skills-link.mjs';
import { documentXmlToText, zipEntries } from '../scripts/lib/docx-text.mjs';
import { termsFrom, scan } from '../scripts/check-pii.mjs';
import { MIN_NODE, parseVersion, satisfies, nodeOk } from '../scripts/lib/node-version.mjs';

test('paths: the test runner points HOME at a temporary copy of the synthetic workspace and DATA_DIR at a temp dir', () => {
  assert.ok(!HOME.startsWith(CODE_ROOT));
  assert.ok(existsSync(join(HOME, '.synthetic')));
  assert.ok(!DATA_DIR.startsWith(CODE_ROOT));
});

test('paths: display never prints an absolute path for project, workspace or data paths', () => {
  assert.equal(display(join(CODE_ROOT, 'scripts', 'tick.mjs')), join('scripts', 'tick.mjs'));
  assert.equal(display(join(DATA_DIR, 'state', 'jobs.json')), join('$JOBBA_DATA_DIR', 'state', 'jobs.json'));
});

test('paths: resolveArgPath reads back display paths and repo-relative paths', () => {
  assert.equal(resolveArgPath('$JOBBA_DATA_DIR/a/b.pdf'), join(DATA_DIR, 'a', 'b.pdf'));
  assert.equal(resolveArgPath('$JOBBA_HOME/profile/person.json'), join(HOME, 'profile', 'person.json'));
  assert.equal(resolveArgPath('package.json'), join(CODE_ROOT, 'package.json'));
  assert.equal(resolveArgPath(null), null);
});

test('paths: toolBin resolves to node_modules/.bin unless overridden', () => {
  assert.equal(toolBin('bikeshed'), join(CODE_ROOT, 'node_modules', '.bin', 'bikeshed'));
  process.env.JOBBA_BIKESHED_BIN = '/opt/x/bikeshed';
  assert.equal(toolBin('bikeshed'), '/opt/x/bikeshed');
  delete process.env.JOBBA_BIKESHED_BIN;
  assert.ok(insideProject(join(CODE_ROOT, 'x')));
});

test('env: parseDotEnv reads KEY=VALUE lines, quotes and export prefixes, skips comments', () => {
  assert.deepEqual(parseDotEnv('# c\nA=1\nexport B="two words"\nC=\'3\'\nbad line\n'), { A: '1', B: 'two words', C: '3' });
});

test('env: the CloakBrowser cache and browser profiles default to in-folder locations', () => {
  assert.equal(process.env.CLOAKBROWSER_CACHE_DIR, join(CODE_ROOT, '.cache', 'cloakbrowser'));
  assert.equal(process.env.CLOAK_PROFILE_DIR, join(DATA_DIR, 'browser'));
});

test('env: gws never sees host credentials and gets an in-folder home', () => {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = '/somewhere/adc.json';
  const env = childEnv('gws');
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.ok(env.HOME.startsWith(join(HOME, '.secrets')));
  assert.ok(env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR.startsWith(join(HOME, '.secrets')));
  assert.equal(env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND, 'file');
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
});

test('env: bikeshed config lives under workspace/.secrets unless a token is set', () => {
  assert.equal(childEnv('bikeshed').XDG_CONFIG_HOME, join(HOME, '.secrets', 'xdg'));
  process.env.BIKESHED_TOKEN = 'bsk_test';
  assert.notEqual(childEnv('bikeshed').XDG_CONFIG_HOME, join(HOME, '.secrets', 'xdg'));
  delete process.env.BIKESHED_TOKEN;
});

test('config: deepMerge merges objects and lets arrays and scalars from the workspace win', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] }), { a: { b: 1, c: 3 }, l: [9] });
});

test('config: template defaults load when the workspace has no file; search config takes the schedule from preferences', () => {
  const limits = loadConfig('limits.json');
  assert.equal(typeof limits.linkedin_jobs.searches_per_day.max, 'number');
  const s = loadSearchConfig('searches.json');
  assert.equal(s.tick.tz, 'America/Chicago');
  assert.equal(s.tick.start, '07:00');
  assert.deepEqual(s.tick.days, [1, 2, 3, 4, 5]);
});

test('profile: the synthetic persona drives names, prefixes and email', () => {
  assert.equal(person().name, 'Jordan Example');
  assert.equal(filePrefix(), 'jordan-example');
  assert.equal(cvFileBase('head-of-engineering'), 'jordan-example-cv-head-of-engineering');
  assert.equal(coverFileBase('acme'), 'jordan-example-cover-letter-acme');
  assert.match('jordan-example-cv-head-of-engineering.pdf', CV_FILE_RE);
  assert.equal(applicationEmail(), 'jordan@example.com');
  assert.equal(operatorName(), 'Jordan Example');
  assert.equal(tz(), 'America/Chicago');
  assert.equal(answers().eeo.gender, 'decline');
  assert.equal(preferences().tailoring.review, 'bikeshed');
});

test('profile: filePrefix falls back to a slug of the name, then a neutral default', () => {
  assert.equal(filePrefix({ name: 'Zoë Ångström-Lee' }), 'zoe-angstrom-lee');
  assert.equal(filePrefix({}), 'candidate');
});

test('actions log: entries append as JSON lines, filter by job and time, and clip long values', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'jobba-log-')), 'log', 'actions.jsonl');
  logAction({ action: 'tick.done', source: 'linkedin', detail: 'x'.repeat(1000) }, { path, now: new Date('2026-01-05T10:00:00Z') });
  logAction({ actor: 'user', action: 'triage.decided', job_id: '9000000001' }, { path, now: new Date('2026-01-06T10:00:00Z') });
  const all = readActions({ path });
  assert.equal(all.length, 2);
  assert.ok(all[0].detail.length <= 400);
  assert.equal(readActions({ path, job: '9000000001' }).length, 1);
  assert.equal(readActions({ path, since: '2026-01-06T00:00:00Z' }).length, 1);
  assert.throws(() => logAction({}, { path }));
});

test('notify: osascript on macOS, notify-send on Linux, nothing elsewhere; off prints only', async () => {
  assert.equal(notifyCommand('t', 'm', 'darwin')[0], 'osascript');
  assert.equal(notifyCommand('t', 'm', 'linux')[0], 'notify-send');
  assert.equal(notifyCommand('t', 'm', 'win32'), null);
  let called = false;
  assert.equal(await notify('t', 'm', { mode: 'off', run: () => { called = true; } }), false);
  assert.equal(called, false);
});

test('skills-link: plans relative links, replaces wrong ones, removes stale ones, never touches real dirs', () => {
  const rel = (n) => join('..', '..', '.agents', 'skills', n);
  const existing = new Map([['a', { kind: 'link', target: rel('a') }], ['b', { kind: 'link', target: '/abs/b' }], ['old', { kind: 'link', target: 'x' }], ['real', { kind: 'dir' }]]);
  const ops = planLinks(['a', 'b', 'c', 'real'], existing);
  assert.deepEqual(ops.map((o) => `${o.op}:${o.name}`).sort(), ['create:c', 'remove:old', 'replace:b', 'skip-real-dir:real']);
  assert.equal(ops.find((o) => o.name === 'c').target, rel('c'));
});

test('docx-text: paragraphs, tabs, breaks and entities come out as plain text', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Jordan &amp; Co</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(documentXmlToText(xml), 'Jordan & Co\nA\tB\nC');
  assert.throws(() => zipEntries(Buffer.from('not a zip')), /not a zip/);
});

test('check-pii: terms come from the workspace and match case-insensitively, phones by digits', () => {
  const terms = termsFrom({ person: { name: 'Jordan Example', email: 'jordan@example.com', phone: '(555) 555-0100' }, answers: { profile: { street_address: '100 Main St' } }, master: { roles: { a: { company: 'Initech' } } } });
  const files = { 'a.md': 'hello JORDAN example', 'b.js': 'call 555.555.0100', 'c.txt': 'nothing here', 'd.md': 'worked at initech' };
  const hits = scan(Object.keys(files), terms, (f) => files[f]);
  assert.deepEqual([...new Set(hits.map((h) => h.file))].sort(), ['a.md', 'b.js', 'd.md']);
});

test('check-pii: template placeholders are skipped; employers, clients and linked names are terms', () => {
  const terms = termsFrom({ master: {
    roles: { a: { company: '<employer>' }, b: { company: 'Initech', clients: [{ name: 'Hooli' }] } },
    employers: { g: { name: 'Globex Consulting' } },
    links: { Ledgerly: 'https://ledgerly.example' },
  } });
  assert.deepEqual(terms.sort(), ['Globex Consulting', 'Hooli', 'Initech', 'Ledgerly']);
});

test('check-pii: an allowed term drops only that exact term, case-insensitively, never a wider one', () => {
  const master = { roles: { a: { company: 'Initech' }, b: { company: 'Hooli Labs' } } };
  const person = { email: 'jordan@initech.example' };
  const terms = termsFrom({ person, master, allow: ['INITECH'] });
  assert.ok(!terms.includes('Initech'));
  assert.ok(terms.includes('jordan@initech.example'), 'an allowed name never frees a wider term');
  assert.ok(terms.includes('Hooli Labs'));
  assert.deepEqual(scan(['a.md'], terms, () => 'Copyright 2026 Initech'), []);
  assert.equal(scan(['a.md'], terms, () => 'mail jordan@initech.example').length, 1);
});

test('package.json pins every dependency exactly', () => {
  const pkg = JSON.parse(readFileSync(join(CODE_ROOT, 'package.json'), 'utf8'));
  for (const [name, v] of Object.entries(pkg.dependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, `${name} must be pinned`);
});

test('every skill in .agents/skills has a SKILL.md with name and description frontmatter', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const dir = join(CODE_ROOT, '.agents', 'skills');
  for (const s of readdirSync(dir)) {
    const p = join(dir, s, 'SKILL.md');
    assert.ok(existsSync(p), `${s} has SKILL.md`);
    const head = readFileSync(p, 'utf8').split('\n---')[0];
    assert.match(head, /\nname:\s*\S/, `${s} frontmatter has name`);
    assert.match(head, /\ndescription:\s*\S/, `${s} frontmatter has description`);
  }
});

test('node-version: satisfies reads >=, ^ and || ranges', () => {
  assert.deepEqual(parseVersion('v22.13.1'), [22, 13, 1]);
  assert.ok(satisfies('22.13.0', '>=22.13.0 || >=24'));
  assert.ok(!satisfies('22.12.0', '>=22.13.0 || >=24'));
  assert.ok(satisfies('22.13.0', '^20.19.0 || >=22.12.0'));
  assert.ok(satisfies('20.19.3', '^20.19.0 || >=22.12.0'));
  assert.ok(!satisfies('21.0.0', '^20.19.0'));
  assert.ok(satisfies('22.13.0', '>= 20'));
  assert.ok(nodeOk(MIN_NODE) && !nodeOk('20.19.0'));
});

test('package.json engines is the newest minimum any dependency requires', () => {
  const pkg = JSON.parse(readFileSync(join(CODE_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, `>=${MIN_NODE}`);
  for (const name of Object.keys(pkg.dependencies)) {
    const range = JSON.parse(readFileSync(join(CODE_ROOT, 'node_modules', name, 'package.json'), 'utf8')).engines?.node;
    if (range) assert.ok(satisfies(MIN_NODE, range), `${name} needs ${range}; engines says >=${MIN_NODE}`);
  }
});

test('doctor, setup and bootstrap take the Node minimum from package.json engines', () => {
  assert.match(readFileSync(join(CODE_ROOT, 'scripts', 'doctor.mjs'), 'utf8'), /nodeOk\(/);
  const setup = readFileSync(join(CODE_ROOT, 'scripts', 'setup.mjs'), 'utf8');
  assert.match(setup, /nodeOk\(/);
  assert.match(setup, /'marked'/, 'setup checks every dependency doctor checks');
  assert.match(readFileSync(join(CODE_ROOT, 'bin', 'bootstrap'), 'utf8'), /engines\.node/);
});

void writeFileSync; void mkdirSync;
