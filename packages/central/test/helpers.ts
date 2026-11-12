/**
 * Test bench: a real SQLite file in a temporary directory, a fake clock and the
 * same `createServer` the binary runs. No network, no sleep, no sound.
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CentralServer } from '../src/server.js';
import { createServer } from '../src/server.js';
import type { Config } from '../src/config.js';

export interface Clock {
  now: () => number;
  set(at: number): void;
  advance(ms: number): void;
}

export function fakeClock(start = 1_760_000_000_000): Clock {
  let current = start;
  return {
    now: () => current,
    set(at: number): void {
      current = at;
    },
    advance(ms: number): void {
      current += ms;
    },
  };
}

export interface Bench {
  central: CentralServer;
  config: Config;
  dir: string;
  clock: Clock;
  stationToken: string;
  close(): Promise<void>;
}

export function tempDir(prefix = 'bipeur-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** The repository's own rules file: the tests classify like production does. */
export const REPO_RULES = fileURLToPath(new URL('../../../.bipeur/rules.yaml', import.meta.url));

export function benchConfig(dir: string, clock: Clock, overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0,
    dbPath: join(dir, 'central.sqlite'),
    rulesPath: join(dir, 'rules.yaml'),
    budgetPerHour: 6,
    retentionDays: 30,
    vapid: null,
    corsOrigins: ['https://baptistefaisy.github.io'],
    demo: false,
    bootstrapToken: 'test-station-token',
    stationAlias: 'main',
    rateLimitPerMinute: 100_000,
    sweepIntervalMs: 0,
    now: clock.now,
    ...overrides,
  };
}

export async function startBench(overrides: Partial<Config> = {}): Promise<Bench> {
  const dir = tempDir();
  const clock = fakeClock();
  const config = benchConfig(dir, clock, overrides);
  copyFileSync(REPO_RULES, config.rulesPath);
  const central = await createServer(config);
  const bench: Bench = {
    central,
    config,
    dir,
    clock,
    stationToken: overrides.bootstrapToken ?? 'test-station-token',
    async close(): Promise<void> {
      await bench.central.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return bench;
}

/**
 * Reopens the very same file: the restart of BIP-P-12. The bench is mutated in
 * place, so `close()` at the end of a test always closes the live store.
 */
export async function restart(bench: Bench): Promise<Bench> {
  await bench.central.close();
  bench.central = await createServer(bench.config);
  return bench;
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

/** Shape of the JSON answers the tests assert on; `any` keeps them readable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonBody = any;

export async function call(
  central: CentralServer,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: JsonBody }> {
  const response = await central.app.request(path, {
    method,
    headers: authHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}
