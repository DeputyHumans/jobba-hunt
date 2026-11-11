#!/usr/bin/env node
// npm run bikeshed -- <args> / npm run gws -- <args>: the project's own CLIs, run with their
// credentials and config inside the workspace (workspace/.secrets, see scripts/lib/env.mjs).
// Always sign in through these (npm run bikeshed -- login, npm run gws -- auth login): a global
// install or a bare npm exec would keep the credentials in the home folder, where the scripts
// never look.

import './lib/env.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { childEnv } from './lib/env.mjs';
import { toolBin } from './lib/paths.mjs';

const [tool, ...args] = process.argv.slice(2);
if (!['bikeshed', 'gws'].includes(tool)) {
  console.error('usage: node scripts/tool.mjs bikeshed|gws <args>');
  process.exit(2);
}
const bin = toolBin(tool);
if (!existsSync(bin)) {
  console.error(`${tool} CLI not found in node_modules/.bin: run npm ci`);
  process.exit(127);
}
const r = spawnSync(bin, args, { stdio: 'inherit', env: childEnv(tool) });
process.exit(r.status ?? 1);
