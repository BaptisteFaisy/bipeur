import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PORT = Number.parseInt(process.env.BIPEUR_E2E_PORT ?? '8799', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * The E2E suite runs outside the pull-request CI: the verdict of a PR stays
 * inside five minutes. The Central is started by the launcher script, which
 * builds the pager when needed and writes its descriptor down.
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
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/scripts/central-server.mjs',
    cwd: REPO_ROOT,
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
