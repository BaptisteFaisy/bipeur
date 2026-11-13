// Smoke test used by the `build` job: the Central must boot, answer /healthz,
// accept a page and let a source wait for a decision. Exits non-zero on any
// surprise. Kept dependency-free on purpose: it runs right after `pnpm build`.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = new URL('../packages/central/dist/bin.js', import.meta.url).pathname;

if (!existsSync(ENTRY)) {
  console.log('smoke: @bipeur/central not built yet — skipped');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'bipeur-smoke-'));

/**
 * A port the kernel says is free, not a guess in a range. A fixed or random
 * range collides with whatever else runs on a shared machine: the child then
 * dies with EADDRINUSE while ANOTHER Central answers on that port, and the
 * smoke test happily asserts against a server it does not own — it reported
 * `{"error":"unauthorized"}` instead of saying it never started.
 */
async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ENTRY], {
  env: {
    ...process.env,
    BIPEUR_HOST: '127.0.0.1',
    BIPEUR_PORT: String(port),
    BIPEUR_DB: join(dir, 'smoke.sqlite'),
    BIPEUR_BOOTSTRAP_TOKEN: 'smoke-token',
    BIPEUR_DEMO: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));

let exited = null;
child.on('exit', (code, signal) => {
  exited = { code, signal };
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function untilHealthy(tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    // Our child died: stop probing, or another process on this port would
    // answer and the assertions would be about somebody else's server.
    if (exited) return false;
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await wait(100);
  }
  return false;
}

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

try {
  const healthy = await untilHealthy();
  check('central boots', healthy, exited ? `child exited code=${exited.code} signal=${exited.signal}` : 'no answer on /healthz');
  if (!healthy) throw new Error('the Central never answered: the rest of the smoke test would be meaningless');

  const created = await fetch(`${base}/v1/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer smoke-token' },
    body: JSON.stringify({
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
      cwd: '/tmp/demo',
      branch: 'main',
      stats: '3 commits +120-14',
    }),
  });
  const page = await created.json().catch(() => ({}));
  check('POST /v1/pages answers 2xx', created.status >= 200 && created.status < 300, `status=${created.status}`);
  check('the page carries a line', typeof page.line === 'string' && page.line.length > 0, JSON.stringify(page));
  check('the line ends with the fingerprint tag', /#[0-9a-f]{4}$/.test(page.line ?? ''), page.line);
  check('the line is 80 characters or less', (page.line ?? '').length <= 80, page.line);

  const unauth = await fetch(`${base}/v1/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'tool', tool_name: 'shell', command: 'ls' }),
  });
  check('an unauthenticated source gets 401', unauth.status === 401, `status=${unauth.status}`);

  const decision = await fetch(`${base}/v1/pages/${page.page_id ?? page.id}/decision?wait=1`);
  check('GET decision answers', decision.ok, `status=${decision.status}`);
} finally {
  child.kill('SIGTERM');
  await wait(200);
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log('smoke: FAILED');
  console.log(logs.join('').slice(-2000));
  process.exit(1);
}
console.log('smoke: OK');
