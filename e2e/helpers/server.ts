/**
 * A Central of its own, for the scenarios that need a fresh budget or a
 * fresh clock. The launcher script is the same one the Playwright webServer
 * uses, so both behave identically.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Central } from './central.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../..');

export interface DedicatedCentral {
  central: Central;
  stop(): Promise<void>;
}

/** Waits for the Central to answer, without sleeping more than 200 ms. */
async function waitForHealth(url: string, attempts = 200): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      /* the Central is not listening yet */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`the Central never answered on ${url}/healthz`);
}

/** Starts a Central on its own port, with its own database. */
export async function startDedicatedCentral(port: number): Promise<DedicatedCentral> {
  const dbDir = mkdtempSync(join(tmpdir(), 'bipeur-e2e-'));
  const token = `e2e-token-${port}`;
  const child = spawn(process.execPath, [resolve(REPO_ROOT, 'e2e/scripts/central-server.mjs')], {
    env: {
      ...process.env,
      BIPEUR_E2E_PORT: String(port),
      BIPEUR_E2E_DB_DIR: dbDir,
      BIPEUR_E2E_TOKEN: token,
    },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url);
  return {
    central: new Central({ url, token }),
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((done) => setTimeout(done, 300));
    },
  };
}
