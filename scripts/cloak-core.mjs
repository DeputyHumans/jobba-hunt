// CloakBrowser plumbing shared by the LinkedIn and Dice readers, the probes and the apply
// runner: CLI args and the JSON last-line contract, the persistent browser profile and its
// lock, login-wall detection and element helpers.
//   - library, not a CLI: openContext throws ProfileBusyError instead of exiting, so each
//     runner decides what a busy profile means (skip, no retry loop);
//   - profiles live under CLOAK_PROFILE_DIR (lib/env.mjs defaults it to <workspace>/data/browser),
//     one folder per platform: linkedin, dice;
//   - the wrapper is pinned in package.json, which fixes the Chromium build per platform
//     (PINNED_BINARY), so a profile's cookie jar is never seen from two browser builds.
//
// SAFETY: one attempt per action, no retries, always close the context.

import './lib/env.mjs';
import { readlinkSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { display } from './lib/paths.mjs';

export class ProfileBusyError extends Error {
  constructor(dir) {
    super(`profile busy: another browser process holds ${display(dir)}. Skip this run; do not loop.`);
    this.profileBusy = true;
    this.profile = display(dir);
    this.dir = dir;
  }
}

// ---------- args / output ----------
export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else positional.push(a);
  }
  return { positional, flags };
}

// Every CLI command prints exactly one JSON object as its last stdout line.
export function out(obj) {
  console.log(JSON.stringify(obj));
}
export function fail(message, extra = {}) {
  out({ success: false, error: message, ...extra });
  process.exit(1);
}

// ---------- profile + locks ----------
export const profileBase = () => process.env.CLOAK_PROFILE_DIR;

export function profileDir(platform = 'linkedin', flags = {}) {
  const base = profileBase();
  if (!base) throw new Error('CLOAK_PROFILE_DIR is not set (scripts/lib/env.mjs sets it; import it first)');
  const name = flags.profile || process.env.CLOAK_PROFILE || platform;
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// A crashed run leaves Chromium's SingletonLock behind. The symlink targets
// "<host>-<pid>"; if that pid is dead the lock is stale and safe to remove.
export function clearStaleLock(dir) {
  let target;
  try { target = readlinkSync(join(dir, 'SingletonLock')); } catch { return; }
  const m = target.match(/-(\d+)$/);
  if (!m) return;
  const pid = Number(m[1]);
  try { process.kill(pid, 0); return; }
  catch (e) { if (e.code === 'EPERM') return; }
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { rmSync(join(dir, f), { force: true }); } catch { /* ignore */ }
  }
}

export function profilePids(dir) {
  try {
    const stdout = execFileSync('pgrep', ['-f', `user-data-dir=${dir}`], { encoding: 'utf8' });
    return [...new Set(stdout.split('\n').map((s) => Number(s.trim())))].filter((n) => n && n !== process.pid);
  } catch { return []; }
}

// Opt-in only (--force-reap): kills whatever holds the profile. Never use it while another
// run (a tick, a probe, an apply) might still be using that profile.
export function reapProfile(dir) {
  let killed = 0;
  for (const pid of profilePids(dir)) {
    try { process.kill(pid, 'SIGKILL'); killed++; } catch { /* gone */ }
  }
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { rmSync(join(dir, f), { force: true }); } catch { /* ignore */ }
  }
  return killed;
}

const LOCK_WAIT_MS = Number(process.env.CLOAK_LOCK_WAIT_MS) || 120_000;
// The wrapper is pinned in package.json (cloakbrowser 0.6.4); its own per-platform default fixes the
// Chromium build (macOS and Linux ship different builds), and npm run setup installs that build into
// .cache/. CLOAKBROWSER_VERSION pins another build explicitly. undefined means the wrapper default.
export const PINNED_BINARY = process.env.CLOAKBROWSER_VERSION || undefined;

let ACTIVE_CONTEXT = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(sig, () => {
    Promise.resolve(ACTIVE_CONTEXT && ACTIVE_CONTEXT.close()).catch(() => {}).finally(() => process.exit(130));
  });
}

async function loadCloak() {
  try {
    return await import('cloakbrowser');
  } catch (err) {
    throw new Error(`cloakbrowser not installed. Run: npm ci && npm run setup (${err.message})`);
  }
}

// `dir` overrides the <CLOAK_PROFILE_DIR>/<platform> profile folder.
export async function openContext(platform, { headed = false, flags = {}, dir: ownDir = null } = {}) {
  const { launchPersistentContext } = await loadCloak();
  const dir = ownDir || profileDir(platform, flags);
  if (ownDir) mkdirSync(ownDir, { recursive: true });
  const launch = () => launchPersistentContext({
    userDataDir: dir,
    // One cookie jar seen from two Chromium builds is a fingerprint mismatch.
    browserVersion: PINNED_BINARY,
    headless: !headed,
    humanize: true,
    humanPreset: 'careful',
    locale: 'en-US',
  });

  if (flags['force-reap']) reapProfile(dir);

  // Cooperative acquisition: clear locks left by DEAD processes, wait for a LIVE
  // holder to finish, never kill it.
  const deadline = Date.now() + LOCK_WAIT_MS;
  let context;
  for (;;) {
    clearStaleLock(dir);
    try { context = await launch(); break; }
    catch (err) {
      const locked = /ProcessSingleton|already in use|SingletonLock/i.test(String(err));
      if (!locked) throw err;
      if (Date.now() >= deadline) throw new ProfileBusyError(dir);
      await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)));
    }
  }

  ACTIVE_CONTEXT = context;
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);
  return { context, page, profile: dir };
}

// ---------- login-wall detection (LinkedIn) ----------
export async function isLoggedOut(page) {
  const url = page.url();
  if (/\/(login|checkpoint|authwall)/.test(url)) return true;
  if (await page.locator('#global-nav, .global-nav__me, img.global-nav__me-photo').count() > 0) return false;
  // Fail toward "logged out": a false positive only stops a sweep.
  return (await page.locator('a[href*="/login"], .authwall, form.login__form').count()) > 0;
}

// ---------- element helpers ----------
export async function firstVisible(locator) {
  const n = await locator.count();
  for (let i = 0; i < n; i++) {
    const el = locator.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return locator.first();
}

// Polls until something visible matches; null on timeout (never a hidden fallback).
export async function waitFirstVisible(page, selector, timeout = 15000) {
  const deadline = Date.now() + timeout;
  const loc = page.locator(selector);
  for (;;) {
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const cand = loc.nth(i);
      if (await cand.isVisible().catch(() => false)) return cand;
    }
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(300);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));
