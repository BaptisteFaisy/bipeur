import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputDir, portFor, reportDir, runtimeDir } from './helpers/ports.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SHARED_PORT = portFor('sharedCentral');
const BASE_URL = `http://127.0.0.1:${SHARED_PORT}`;

/**
 * The E2E suite runs outside the pull-request CI: the verdict of a PR stays
 * inside five minutes. The suite is split into two projects so two CI jobs can
 * play it in parallel, each inside its own five-minute budget. Every port and
 * every runtime directory derives from `BIPEUR_E2E_PORT_BASE`
 * (`helpers/ports.ts`), so the two jobs never collide on the same machine.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: outputDir(),
  reporter: [['list'], ['html', { open: 'never', outputFolder: reportDir() }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // The browser-heavy scenarios plus P7: its simulator waits (~22 s) are
      // kept apart from P5's real 30 s TTL so the two halves weigh the same.
      name: 'group-a',
      testMatch: [/p[1-4]-.*\.spec\.ts/, /p7-.*\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'group-b',
      testMatch: /p[5-6]-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node e2e/scripts/central-server.mjs',
    cwd: REPO_ROOT,
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      BIPEUR_E2E_PORT: String(SHARED_PORT),
      BIPEUR_E2E_DB_DIR: runtimeDir(),
    },
  },
});
