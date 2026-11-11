// Node 24 deadlock: process.exit -> Environment::Exit -> DisposePlatform -> uv_thread_join on a V8
// worker stuck in a Maglev compile job waiting for a GC (AwaitCollectionBackground) that the
// exiting main thread never runs. The runner hung after recording its outcome. It now turns V8's
// background compilers off before anything else loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('no-bg-jit: turns off Maglev and every background compile thread', async () => {
  const { FLAGS } = await import('../scripts/lib/no-bg-jit.mjs');
  for (const f of ['--no-maglev', '--no-concurrent-recompilation', '--no-concurrent-sparkplug']) assert.ok(FLAGS.includes(f), f);
});

test('no-bg-jit: apply-job.mjs imports it before any other module', () => {
  const src = readFileSync(new URL('../scripts/apply-job.mjs', import.meta.url), 'utf8');
  const first = src.split('\n').find((l) => /^import\s/.test(l));
  assert.match(first, /^import '\.\/lib\/no-bg-jit\.mjs';$/);
});
