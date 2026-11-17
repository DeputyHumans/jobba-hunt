// The hunt-wide pause: <workspace>/config/pause.json {paused, reason, since, by}. While paused,
// a live tick views nothing (it reads like closed hours and asks to come back in an hour),
// auto-apply stops and the runner refuses real submits. Dry runs stay allowed. No file, or
// paused false, means not paused. Only the user sets or lifts it.
import { existsSync, readFileSync } from 'node:fs';
import { configFile } from './config.mjs';

export function readPause(file = configFile('pause.json')) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function pauseBlock(p) {
  return p && p.paused ? `paused: ${p.reason || 'no reason given'}` : null;
}
