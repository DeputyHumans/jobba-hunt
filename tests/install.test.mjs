// bin/install, the one-line macOS installer, run against stub commands on a sealed PATH and a
// temporary HOME: nothing is downloaded or installed, every external command only logs its call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_ROOT } from '../scripts/lib/paths.mjs';

const INSTALL = join(CODE_ROOT, 'bin', 'install');
const REAL = ['sh', 'bash', 'cat', 'grep', 'sed', 'awk', 'mkdir', 'rm', 'touch', 'mktemp', 'cp', 'chmod', 'ls', 'tr', 'cut', 'head', 'dirname', 'basename', 'env', 'printf'];
const which = (c) => { try { return execFileSync('/bin/sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).trim(); } catch { return null; } };

const STUBS = {
  // uname, sw_vers and id answer from the test's environment.
  uname: 'echo "${STUB_UNAME:-Darwin}"',
  sw_vers: 'echo "${STUB_MACOS:-15.1}"',
  id: 'echo "${STUB_UID:-501}"',
  sleep: ':',
  // xcode-select: -p answers once the tools are "installed"; --install installs them unless told never to.
  'xcode-select': `case "$1" in
  -p) [ -x "$T/clt/usr/bin/git" ] && { echo "$T/clt"; exit 0; }; exit 2 ;;
  --install) [ -n "\${STUB_CLT_NEVER:-}" ] && exit 0; mkdir -p "$T/clt/usr/bin"; cp "$T/stubs/fake-git" "$T/clt/usr/bin/git"; chmod +x "$T/clt/usr/bin/git" ;;
esac`,
  // curl prints a small installer script for the two URLs the installer pipes into bash.
  curl: `url=""; for a in "$@"; do url="$a"; done
case "$url" in
  *nvm-sh/nvm/*/install.sh) cat <<'EOF'
mkdir -p "$NVM_DIR"
cat > "$NVM_DIR/nvm.sh" <<'NVM'
nvm() { case "$1" in install) mkdir -p "$NVM_DIR/bin"; printf '#!/bin/sh\\necho 22.21.1\\n' > "$NVM_DIR/bin/node"; chmod +x "$NVM_DIR/bin/node"; PATH="$NVM_DIR/bin:$PATH"; export PATH ;; esac; }
NVM
EOF
  ;;
  *claude.ai/install.sh) printf 'mkdir -p "$HOME/.local/bin"; printf "#!/bin/sh\\\\necho claude\\\\n" > "$HOME/.local/bin/claude"; chmod +x "$HOME/.local/bin/claude"\\n' ;;
  *) exit 22 ;;
esac`,
  // git (copied into the Command Line Tools folder): clone makes a checkout whose bootstrap logs.
  'fake-git': `case "$1" in
  clone) dir=""; for a in "$@"; do dir="$a"; done; mkdir -p "$dir/.git" "$dir/bin"
    printf '{ "name": "jobba-hunt" }\\n' > "$dir/package.json"
    printf '#!/bin/sh\\necho bootstrap >> "$JOBBA_STUB_LOG"\\n' > "$dir/bin/bootstrap"; chmod +x "$dir/bin/bootstrap" ;;
esac`,
};

function sandbox() {
  const T = mkdtempSync(join(tmpdir(), 'jobba-install-'));
  mkdirSync(join(T, 'stubs'));
  mkdirSync(join(T, 'sys'));
  mkdirSync(join(T, 'home'));
  for (const c of REAL) { const p = which(c); if (p && p.startsWith('/')) symlinkSync(p, join(T, 'sys', c)); }
  for (const [name, body] of Object.entries(STUBS)) {
    const f = join(T, 'stubs', name);
    writeFileSync(f, `#!/bin/sh\necho "${name} $*" >> "$JOBBA_STUB_LOG"\n${body}\n`);
    chmodSync(f, 0o755);
  }
  return T;
}

// By default the script goes in on stdin, exactly as `curl ... | sh` runs it ($0 is the shell, not a
// file). A path runs that file instead (the installer inside a checkout).
function run(T, env = {}, script = null, shell = '/bin/sh') {
  const r = spawnSync(shell, script ? [script] : ['-s'], {
    input: script ? undefined : readFileSync(INSTALL, 'utf8'),
    encoding: 'utf8',
    env: {
      HOME: join(T, 'home'), PATH: `${join(T, 'stubs')}:${join(T, 'sys')}`, SHELL: '/bin/zsh', T,
      JOBBA_STUB_LOG: join(T, 'log'), JOBBA_POLL_SECONDS: '1', JOBBA_CLT_TIMEOUT_MINUTES: '1', ...env,
    },
  });
  const log = existsSync(join(T, 'log')) ? readFileSync(join(T, 'log'), 'utf8') : '';
  return { code: r.status, out: r.stdout, err: r.stderr, log };
}

const shells = ['/bin/sh', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])];

for (const shell of shells) {
  test(`install (${shell}): a bare Mac gets the tools, Node, Claude Code, the project and bootstrap; a re-run adds nothing`, () => {
    const T = sandbox();
    try {
      const r = run(T, {}, null, shell);
      assert.equal(r.code, 0, r.err + r.out);
      assert.match(r.log, /^xcode-select --install$/m);
      assert.match(r.log, /^curl .*nvm-sh\/nvm\/v0\.41\.0\/install\.sh$/m);
      assert.match(r.log, /^curl .*claude\.ai\/install\.sh$/m);
      assert.match(r.log, /^fake-git clone --branch main https:\/\/github\.com\/DeputyHumans\/jobba-hunt\.git .*\/home\/jobba-hunt$/m);
      assert.match(r.log, /^bootstrap$/m);
      const zshrc = readFileSync(join(T, 'home', '.zshrc'), 'utf8');
      assert.equal(zshrc.match(/\.local\/bin/g)?.length, 1);
      assert.match(r.out, /\/hunt-onboard/);

      rmSync(join(T, 'log'));
      const again = run(T, { PATH: `${join(T, 'home', '.nvm', 'bin')}:${join(T, 'stubs')}:${join(T, 'sys')}` }, null, shell);
      assert.equal(again.code, 0, again.err + again.out);
      assert.doesNotMatch(again.log, /xcode-select --install|^curl /m);
      assert.match(again.log, /^fake-git -C .* pull --ff-only$/m);
      assert.match(again.log, /^bootstrap$/m);
      assert.equal(readFileSync(join(T, 'home', '.zshrc'), 'utf8').match(/\.local\/bin/g)?.length, 1);
    } finally { rmSync(T, { recursive: true, force: true }); }
  });
}

test('install: not macOS, macOS older than 13, or root exits 2 and runs nothing else', () => {
  for (const env of [{ STUB_UNAME: 'Linux' }, { STUB_MACOS: '12.7.4' }, { STUB_UID: '0' }]) {
    const T = sandbox();
    try {
      const r = run(T, env);
      assert.equal(r.code, 2, JSON.stringify(env) + r.err);
      assert.doesNotMatch(r.log, /xcode-select|curl|git/);
    } finally { rmSync(T, { recursive: true, force: true }); }
  }
});

test('install: Command Line Tools that never finish exit 1 with the re-run hint', () => {
  const T = sandbox();
  try {
    const r = run(T, { STUB_CLT_NEVER: '1', JOBBA_CLT_TIMEOUT_MINUTES: '0' });
    assert.equal(r.code, 1);
    assert.match(r.err, /xcode-select --install/);
    assert.doesNotMatch(r.log, /curl/);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('install: a folder that is not a checkout is left untouched (exit 1)', () => {
  const T = sandbox();
  try {
    const dir = join(T, 'home', 'stuff');
    mkdirSync(dir);
    writeFileSync(join(dir, 'keep.txt'), 'mine');
    const r = run(T, { JOBBA_DIR: dir });
    assert.equal(r.code, 1);
    assert.match(r.err, /not a jobba-hunt checkout/);
    assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'mine');
    assert.doesNotMatch(r.log, /clone/);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('install: run from inside a checkout, it sets up that checkout and clones nothing', () => {
  const T = sandbox();
  try {
    const co = join(T, 'home', 'work', 'jobba-hunt');
    mkdirSync(join(co, 'bin'), { recursive: true });
    mkdirSync(join(co, '.git'));
    cpSync(INSTALL, join(co, 'bin', 'install'));
    writeFileSync(join(co, 'package.json'), '{ "name": "jobba-hunt" }\n');
    writeFileSync(join(co, 'bin', 'bootstrap'), '#!/bin/sh\necho "bootstrap in $(pwd)" >> "$JOBBA_STUB_LOG"\n');
    chmodSync(join(co, 'bin', 'bootstrap'), 0o755);
    const r = run(T, {}, join(co, 'bin', 'install'));
    assert.equal(r.code, 0, r.err + r.out);
    assert.doesNotMatch(r.log, / clone /);
    assert.match(r.log, /^bootstrap in .*\/work\/jobba-hunt$/m);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('install: parses under sh, runs only from main, never names a tilde home path', () => {
  assert.equal(spawnSync('/bin/sh', ['-n', INSTALL]).status, 0);
  const text = readFileSync(INSTALL, 'utf8');
  assert.equal(text.trimEnd().split('\n').pop(), 'main "$@"');
  assert.doesNotMatch(text, /(^|[^\w.$])~\//);
});
