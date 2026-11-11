/**
 * Gateway configuration, from the environment (`.env.example`).
 *
 * The protocol is plaintext and dates from 1995: the gateway listens on the
 * loopback and refuses any other interface unless `LOGIn` credentials are
 * configured (BIP-N-03, `.kiro/steering/rfc1861.md`).
 */
import { DEFAULT_TTL_MS } from '@bipeur/core';

export interface SnppCredentials {
  id: string;
  password: string;
}

export interface SnppConfig {
  host: string;
  port: number;
  centralUrl: string;
  token: string;
  credentials: SnppCredentials | null;
  defaultTtlHours: number;
  decisionWaitSeconds: number;
  idleTimeoutMs: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** `127.0.0.1`, `::1`, `localhost` and the rest of 127/8. */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  if (value === '::ffff:127.0.0.1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
}

/** `LOGIN=id:password`. Anything else is a configuration error, not a guess. */
export function parseCredentials(raw: string | undefined): SnppCredentials | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return null;
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new ConfigError('BIPEUR_SNPP_LOGIN must be "id:password"');
  }
  return { id: value.slice(0, separator), password: value.slice(separator + 1) };
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 4440;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ConfigError(`BIPEUR_SNPP_PORT is not a port: ${raw}`);
  }
  return port;
}

/**
 * Read the environment. Throws `ConfigError` on anything unsafe rather than
 * starting a plaintext paging gateway on a public interface.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SnppConfig {
  const host = (env.BIPEUR_SNPP_HOST ?? '127.0.0.1').trim() || '127.0.0.1';
  const credentials = parseCredentials(env.BIPEUR_SNPP_LOGIN);
  if (!isLoopbackHost(host) && !credentials) {
    throw new ConfigError(
      `BIPEUR_SNPP_HOST=${host} is not a loopback address: set BIPEUR_SNPP_LOGIN=id:password, ` +
        'or listen on 127.0.0.1 — SNPP is plaintext (RFC 1861)',
    );
  }
  return {
    host,
    port: readPort(env.BIPEUR_SNPP_PORT),
    centralUrl: (env.BIPEUR_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, ''),
    token: env.BIPEUR_TOKEN ?? '',
    credentials,
    defaultTtlHours: DEFAULT_TTL_MS / 3_600_000,
    decisionWaitSeconds: 25,
    idleTimeoutMs: 300_000,
  };
}
