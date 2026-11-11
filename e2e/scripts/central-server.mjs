#!/usr/bin/env node
/**
 * Starts a Central for the E2E suite: fresh SQLite file, fixed station token,
 * demo mode on, loopback only. The runtime descriptor (port, token, database)
 * is written next to it so the tests never guess an address.
 *
 * Usage: node e2e/scripts/central-server.mjs
 * Environment:
 *   BIPEUR_E2E_PORT      port to bind (default 8799)
 *   BIPEUR_E2E_TOKEN     station token of the first post (default e2e-station-token)
 *   BIPEUR_E2E_DB_DIR    directory of the SQLite files and the descriptor
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number.parseInt(process.env.BIPEUR_E2E_PORT ?? '8799', 10);
const TOKEN = process.env.BIPEUR_E2E_TOKEN ?? 'e2e-station-token';
const DB_DIR = resolve(process.env.BIPEUR_E2E_DB_DIR ?? resolve(ROOT, 'e2e/.runtime'));
const BIN = resolve(ROOT, 'packages/central/dist/bin.js');

/**
 * Builds the Central and the pager. Always: a stale `dist/` silently tests the
 * previous code, which is how a contract change can look green. Set
 * `BIPEUR_E2E_SKIP_BUILD=1` to reuse an existing build.
 */
async function ensureBuild() {
  if (process.env.BIPEUR_E2E_SKIP_BUILD === '1') {
    if (!existsSync(BIN)) throw new Error(`BIPEUR_E2E_SKIP_BUILD=1 but ${BIN} is missing`);
    return;
  }
  console.log('[e2e] building the Central and the pager…');
  await run('pnpm', ['build'], ROOT);
}

function run(command, args, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${command} exited with ${code}`))));
  });
}

async function waitForHealth(url, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      /* the Central is not listening yet */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`the Central never answered on ${url}/healthz`);
}

async function main() {
  await ensureBuild();
  mkdirSync(DB_DIR, { recursive: true });
  const dbPath = resolve(DB_DIR, `central-${PORT}.sqlite`);
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  const url = `http://127.0.0.1:${PORT}`;
  const child = spawn(process.execPath, [BIN], {
    cwd: ROOT,
    env: {
      ...process.env,
      BIPEUR_HOST: '127.0.0.1',
      BIPEUR_PORT: String(PORT),
      BIPEUR_DB: dbPath,
      BIPEUR_BOOTSTRAP_TOKEN: TOKEN,
      BIPEUR_DEMO: '1',
      BIPEUR_RULES: resolve(ROOT, '.bipeur/rules.yaml'),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const stop = () => {
    child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await waitForHealth(url);
  writeFileSync(
    resolve(DB_DIR, `central-${PORT}.json`),
    JSON.stringify({ url, port: PORT, token: TOKEN, dbPath }, null, 2),
  );
  console.log(`[e2e] Central ready on ${url} (token ${TOKEN})`);
}

await main();
