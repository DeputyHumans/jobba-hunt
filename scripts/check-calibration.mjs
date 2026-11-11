#!/usr/bin/env node
// Check /hunt-triage calibration scores against the known-role set.
//   node scripts/check-calibration.mjs --file <results.json> [--fixture <calibration.json>]
// The set is the workspace's data/calibration.json (written by /hunt-onboard), or --fixture.
// Exit 0 when every expectation holds, 1 otherwise.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, out, fail } from './cloak-core.mjs';
import { DATA_DIR, display, resolveArgPath } from './lib/paths.mjs';
import { checkCalibration } from './lib/triage.mjs';

const { flags } = parseArgs(process.argv.slice(2));
if (typeof flags.file !== 'string') fail('Pass --file <results.json>');
const fixturePath = typeof flags.fixture === 'string' ? resolveArgPath(flags.fixture) : join(DATA_DIR, 'calibration.json');
if (!existsSync(fixturePath)) fail(`no calibration set at ${display(fixturePath)}: build it in /hunt-onboard (phase 6) or pass --fixture <calibration.json>`);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const r = checkCalibration(JSON.parse(readFileSync(resolveArgPath(flags.file), 'utf8')), fixture);
out({ success: r.pass, fixture: display(fixturePath), ...r });
process.exit(r.pass ? 0 : 1);
