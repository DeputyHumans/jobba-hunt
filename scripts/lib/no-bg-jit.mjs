// Imported first by apply-job.mjs. Node 24 can deadlock in process.exit: Environment::Exit ->
// DisposePlatform -> uv_thread_join on a V8 worker that is stuck in a Maglev compile job waiting for
// a GC (AwaitCollectionBackground) the exiting main thread never runs (seen as repeated hangs after
// the run had recorded its outcome). With no background compile threads, exit has nothing to join.
// The runner is I/O bound, so the lost JIT speed does not matter.
import v8 from 'node:v8';

export const FLAGS = ['--no-maglev', '--no-concurrent-recompilation', '--no-concurrent-sparkplug'];
for (const f of FLAGS) v8.setFlagsFromString(f);
