/**
 * Configuration of the Crew app. The exact REST paths of the Crew Gateway and
 * the shape of the `approval` event are flagged "to verify" in the contest
 * specification (A.9), so every one of them is read from the environment:
 * nothing below is hard-coded inside the relay logic.
 */
export interface CrewConfig {
  /** Base URL of the Crew Gateway, `ws://` or `http://`. */
  gatewayUrl: string;
  /** Path called to resolve an approval: `POST <path>` with the decision. */
  approvalPath: string;
  /** Path called to post a notification to Crew. */
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
  gatewayUrl: 'ws://127.0.0.1:8790',
  approvalPath: '/api/crew/approvals/resolve',
  notificationPath: '/api/crew/notifications',
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
  return {
    gatewayUrl: text(env, 'CREW_GATEWAY_URL', DEFAULTS.gatewayUrl),
    approvalPath: text(env, 'CREW_APPROVAL_PATH', DEFAULTS.approvalPath),
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

/** The Gateway speaks WebSocket; its REST endpoints speak HTTP on the same host. */
export function httpBaseOf(gatewayUrl: string): string {
  const base = gatewayUrl.replace(/\/+$/, '');
  if (base.startsWith('wss://')) return `https://${base.slice('wss://'.length)}`;
  if (base.startsWith('ws://')) return `http://${base.slice('ws://'.length)}`;
  return base;
}

export function endpointOf(gatewayUrl: string, path: string): string {
  return `${httpBaseOf(gatewayUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}
