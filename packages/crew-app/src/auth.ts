/**
 * App-token authentication against the Crew Gateway.
 *
 * Contract (sources in docs/CREW.md):
 * - the secret lives in `KIROCREW_PROXY_SECRET` when the Gateway launched the
 *   backend (beside `KIROCREW_APP_NAME`), else in
 *   `${KIROCREW_HOME|~/.kiro/crew}/apps/{name}/.app_secret`
 *   (kirocrew-client `_read_app_secret`);
 * - `POST /api/apps/{name}/token` with the `X-App-Secret` header answers
 *   `{"token": ...}` (Gateway `handlers/core.py api_app_token`);
 * - the token travels as the `mc_token_<port>` cookie on every request,
 *   including the WebSocket handshake (kirocrew-client `_cookie_headers`);
 * - a 401/403 means the token expired: exchange again once, then retry.
 *
 * The secret and the token are never logged and never leave this module
 * except inside a Cookie header.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cookieNameOf, endpointOf, fillTemplate, type CrewConfig } from './config.js';

export interface CrewAuth {
  /** A valid token, exchanged on first use and re-exchanged after expiry. */
  token(): Promise<string>;
  /** The `Cookie` header value carrying the token ('' when unavailable). */
  cookieHeader(): Promise<string>;
  /** Drop the token so the next call re-exchanges it (on 401/403). */
  invalidate(): void;
}

export interface CrewAuthDeps {
  fetchImpl?: typeof fetch;
  /** Read the secret file; injectable so tests never touch the real path. */
  readSecretFile?: (path: string) => string;
  timeoutMs?: number;
}

export class CrewAuthError extends Error {
  constructor(
    message: string,
    readonly kind: 'no_secret' | 'exchange_failed' = 'exchange_failed',
  ) {
    super(message);
    this.name = 'CrewAuthError';
  }
}

/** The secret, in the order the official client looks for it, plus a test hook. */
export function readAppSecret(appName: string, env: NodeJS.ProcessEnv, readFile?: (p: string) => string): string {
  const fromEnv = (env['KIROCREW_PROXY_SECRET'] ?? '').trim();
  if (fromEnv.length > 0 && env['KIROCREW_APP_NAME'] === appName) return fromEnv;
  const explicit = (env['CREW_APP_SECRET'] ?? '').trim();
  if (explicit.length > 0) return explicit;
  const home = env['KIROCREW_HOME'] ?? join(homedir(), '.kiro', 'crew');
  const path = join(home, 'apps', appName, '.app_secret');
  try {
    return (readFile ?? ((p: string) => readFileSync(p, 'utf-8')))(path).trim();
  } catch {
    return '';
  }
}

export function createCrewAuth(config: CrewConfig, env: NodeJS.ProcessEnv, deps: CrewAuthDeps = {}): CrewAuth {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const secret = readAppSecret(config.appName, env, deps.readSecretFile);
  let current: string | null = null;
  let exchanging: Promise<string> | null = null;

  const exchange = async (): Promise<string> => {
    if (secret.length === 0) {
      throw new CrewAuthError(`no app secret found for "${config.appName}"`, 'no_secret');
    }
    const url = endpointOf(config.gatewayUrl, fillTemplate(config.tokenPath, { name: config.appName }));
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-App-Secret': secret },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new CrewAuthError(`token exchange unreachable: ${reasonOf(error)}`);
    }
    if (!response.ok) {
      // The Gateway answers one opaque 403 for every refusal reason.
      throw new CrewAuthError(`token exchange answered ${response.status}`);
    }
    const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === 'string' ? body.token : '';
    if (token.length === 0) throw new CrewAuthError('token exchange answered no token');
    return token;
  };

  return {
    async token() {
      if (current !== null) return current;
      exchanging ??= exchange()
        .then((fresh) => {
          current = fresh;
          return fresh;
        })
        .finally(() => {
          exchanging = null;
        });
      return exchanging;
    },
    async cookieHeader() {
      const token = await this.token();
      return `${cookieNameOf(config.gatewayUrl)}=${token}`;
    },
    invalidate() {
      current = null;
    },
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
