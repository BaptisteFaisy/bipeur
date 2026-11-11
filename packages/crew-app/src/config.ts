/**
 * Configuration of the Crew app, aligned on the real Gateway contract.
 *
 * Sources (see docs/CREW.md):
 * - kiro.dev/docs/crew/apps/sdk/ — default base URL, token exchange path;
 * - github.com/kirodotdev/KiroCrew `packages/kirocrew-client-py` — cookie
 *   auth (`mc_token_<port>`), `/api/ws`, approval routes;
 * - `src/kiro_crew/dashboard/handlers/notifications_push.py` — the
 *   implicitly allowed `/api/notifications/push` producer endpoint.
 *
 * Environment overrides stay available for tests and unusual deployments,
 * but every default below is a path the Gateway actually serves.
 */
export interface CrewConfig {
  /** Base URL of the Crew Gateway, `http://` or `https://`. */
  gatewayUrl: string;
  /** App name used for the token exchange and the secret lookup. */
  appName: string;
  /** `POST` path that exchanges the app secret for a token. */
  tokenPath: string;
  /** WebSocket path of the event stream. */
  wsPath: string;
  /** `POST` path template resolving a slot-owned approval. */
  approvalPath: string;
  /** `POST` path template resolving an approval without a slot. */
  globalApprovalPath: string;
  /** `POST` path of the app notification producer (journal notices). */
  notificationPath: string;
  /** Beeper Central. */
  beeperUrl: string;
  beeperToken: string;
  /** Station alias shown on the pager line. */
  station: string;
  /** Lifetime of a page created from a Crew approval. */
  ttlSeconds: number;
  /** Local queue bound: past this, the oldest event is dropped and counted. */
  queueLimit: number;
  backoffMs: number;
  maxBackoffMs: number;
  /** Total attempts when resolving an approval (1 initial + 2 retries). */
  resolveAttempts: number;
  /** Ceiling of one decision wait, under the 50 s MCP budget. */
  waitSeconds: number;
}

export const DEFAULTS = {
  gatewayPort: 5476,
  appName: 'bipeur',
  tokenPath: '/api/apps/{name}/token',
  wsPath: '/api/ws',
  approvalPath: '/api/chat/slots/{slot}/approve',
  globalApprovalPath: '/api/approvals/{id}/{action}',
  notificationPath: '/api/notifications/push',
  beeperUrl: 'http://127.0.0.1:8787',
  station: 'crew',
  ttlSeconds: 900,
  queueLimit: 200,
  backoffMs: 500,
  maxBackoffMs: 30_000,
  resolveAttempts: 3,
  waitSeconds: 50,
} as const;

function text(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value.length === 0 ? fallback : value;
}

function number(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CrewConfig {
  const port = text(env, 'KIROCREW_PORT', String(DEFAULTS.gatewayPort));
  return {
    gatewayUrl: text(env, 'CREW_GATEWAY_URL', `http://localhost:${port}`),
    appName: text(env, 'KIROCREW_APP_NAME', text(env, 'CREW_APP_NAME', DEFAULTS.appName)),
    tokenPath: text(env, 'CREW_TOKEN_PATH', DEFAULTS.tokenPath),
    wsPath: text(env, 'CREW_WS_PATH', DEFAULTS.wsPath),
    approvalPath: text(env, 'CREW_APPROVAL_PATH', DEFAULTS.approvalPath),
    globalApprovalPath: text(env, 'CREW_GLOBAL_APPROVAL_PATH', DEFAULTS.globalApprovalPath),
    notificationPath: text(env, 'CREW_NOTIFICATION_PATH', DEFAULTS.notificationPath),
    beeperUrl: text(env, 'BIPEUR_URL', DEFAULTS.beeperUrl),
    beeperToken: text(env, 'BIPEUR_TOKEN', ''),
    station: text(env, 'BIPEUR_STATION', DEFAULTS.station),
    ttlSeconds: number(env, 'CREW_PAGE_TTL', DEFAULTS.ttlSeconds),
    queueLimit: number(env, 'CREW_QUEUE_LIMIT', DEFAULTS.queueLimit),
    backoffMs: number(env, 'CREW_BACKOFF_MS', DEFAULTS.backoffMs),
    maxBackoffMs: number(env, 'CREW_MAX_BACKOFF_MS', DEFAULTS.maxBackoffMs),
    resolveAttempts: number(env, 'CREW_RESOLVE_ATTEMPTS', DEFAULTS.resolveAttempts),
    waitSeconds: number(env, 'CREW_WAIT_SECONDS', DEFAULTS.waitSeconds),
  };
}

/** Strip a trailing slash and normalise a `ws(s)://` base to `http(s)://`. */
export function httpBaseOf(gatewayUrl: string): string {
  const base = gatewayUrl.replace(/\/+$/, '');
  if (base.startsWith('wss://')) return `https://${base.slice('wss://'.length)}`;
  if (base.startsWith('ws://')) return `http://${base.slice('ws://'.length)}`;
  return base;
}

export function wsBaseOf(gatewayUrl: string): string {
  const base = httpBaseOf(gatewayUrl);
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}`;
  return `ws://${base.slice('http://'.length)}`;
}

export function endpointOf(gatewayUrl: string, path: string): string {
  return `${httpBaseOf(gatewayUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

export function wsEndpointOf(config: CrewConfig): string {
  return `${wsBaseOf(config.gatewayUrl)}${config.wsPath}`;
}

/**
 * The Gateway only reads the `mc_token_<port>` cookie keyed by the port in
 * the Host header (kirocrew-client `_auth_cookie_name`). A URL without an
 * explicit port uses its scheme default.
 */
export function cookieNameOf(gatewayUrl: string): string {
  let port: number | null;
  try {
    port = new URL(httpBaseOf(gatewayUrl)).port === '' ? null : Number(new URL(httpBaseOf(gatewayUrl)).port);
  } catch {
    port = null;
  }
  if (port === null) port = httpBaseOf(gatewayUrl).startsWith('https') ? 443 : 80;
  return `mc_token_${port}`;
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    vars[key] === undefined ? match : encodeURIComponent(vars[key] as string),
  );
}
