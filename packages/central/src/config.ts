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
  /**
   * Believe `X-Forwarded-For` when keying the rate limiter. Off by default:
   * the header belongs to the client, so trusting it lets anyone mint a fresh
   * bucket per request. Turn it on only behind a proxy that rewrites it
   * (Tailscale Funnel, nginx, Caddy).
   */
  trustProxy?: boolean;
  /**
   * Browser origins allowed to call the API from another origin. The pager is
   * normally served BY the Central (same origin, no CORS needed); a static
   * deployment — GitHub Pages — puts it on another origin, and then the browser
   * asks for a preflight before the first call.
   */
  corsOrigins: string[];
  sweepIntervalMs: number;
  /**
   * Where the published Merkle roots are appended (BIP-F-45). Null keeps the
   * transparency internal to the database: the root is computed and served, but
   * nothing leaves the machine, so nobody outside could catch a rewrite.
   */
  anchorPath: string | null;
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
    trustProxy: flagFrom(env.BIPEUR_TRUST_PROXY),
    corsOrigins: listFrom(env.BIPEUR_CORS_ORIGINS, ['https://tradoooo.github.io', 'https://baptistefaisy.github.io']),
    sweepIntervalMs: intFrom(env.BIPEUR_SWEEP_INTERVAL_MS, 1000, 0, 60_000),
    anchorPath: env.BIPEUR_ANCHOR_PATH?.trim() ? resolve(env.BIPEUR_ANCHOR_PATH.trim()) : null,
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

/** Comma-separated list, with a default. Empty string means "the default". */
function listFrom(raw: string | undefined, fallback: string[]): string[] {
  const values = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : fallback;
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
