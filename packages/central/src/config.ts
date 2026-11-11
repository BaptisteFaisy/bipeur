/**
 * Configuration of the Central (A.8). Every value has a safe default, so the
 * demo runs with nothing set. Nothing here is ever logged: the bootstrap token
 * is printed once by `bin.ts`, and the VAPID private key never leaves memory.
 */
import { resolve } from 'node:path';
import { DEFAULT_BUDGET_PER_HOUR } from '@bipeur/core';

export const CENTRAL_VERSION = '0.1.0';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  rulesPath: string;
  budgetPerHour: number;
  retentionDays: number;
  /** null when Web Push is not configured: the sender then becomes a no-op. */
  vapid: VapidConfig | null;
  demo: boolean;
  /** null means "generate one on boot and print it once". */
  bootstrapToken: string | null;
  stationAlias: string;
  rateLimitPerMinute: number;
  sweepIntervalMs: number;
  /** Injected clock: the domain logic never reads the wall clock itself. */
  now: () => number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.BIPEUR_HOST?.trim() || '127.0.0.1',
    port: intFrom(env.BIPEUR_PORT, 8787, 0, 65535),
    dbPath: resolve(env.BIPEUR_DB?.trim() || './data/bipeur.sqlite'),
    rulesPath: resolve(env.BIPEUR_RULES?.trim() || './.bipeur/rules.yaml'),
    budgetPerHour: intFrom(env.BIPEUR_BUDGET_PER_HOUR, DEFAULT_BUDGET_PER_HOUR, 0, 1000),
    retentionDays: intFrom(env.BIPEUR_RETENTION_DAYS, 30, 1, 3650),
    vapid: readVapid(env),
    demo: flagFrom(env.BIPEUR_DEMO),
    bootstrapToken: env.BIPEUR_BOOTSTRAP_TOKEN?.trim() || null,
    stationAlias: env.BIPEUR_STATION_ALIAS?.trim() || 'main',
    rateLimitPerMinute: intFrom(env.BIPEUR_RATE_LIMIT_PER_MINUTE, 240, 1, 1_000_000),
    sweepIntervalMs: intFrom(env.BIPEUR_SWEEP_INTERVAL_MS, 1000, 0, 60_000),
    now: () => Date.now(),
  };
}

function intFrom(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt((raw ?? '').trim(), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function flagFrom(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function readVapid(env: NodeJS.ProcessEnv): VapidConfig | null {
  const publicKey = env.BIPEUR_VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.BIPEUR_VAPID_PRIVATE_KEY?.trim() ?? '';
  if (publicKey.length === 0 || privateKey.length === 0) return null;
  return {
    publicKey,
    privateKey,
    subject: env.BIPEUR_VAPID_SUBJECT?.trim() || 'mailto:beeper@localhost',
  };
}
