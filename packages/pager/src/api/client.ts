/**
 * The only place the pager talks to the Central (A.9).
 *
 * Everything is injected — `fetch`, the WebSocket constructor and the clock —
 * so the whole app runs against a fake client in tests, with no socket and no
 * network. The Central is not merged yet; this module codes against the
 * contract: `GET /v1/stream`, `GET /v1/devices/:id/pages`,
 * `POST /v1/pages/:id/read`, `POST /v1/pages/:id/decision`,
 * `POST /v1/pairings`, `POST /v1/devices`, `POST /v1/demo/start`.
 */
import {
  signedDecisionSchema,
  streamMessageSchema,
  type PageRecord,
  type StreamMessage,
} from '@bipeur/core';
import {
  decisionAckSchema,
  demoResponseSchema,
  deviceResponseSchema,
  pageListSchema,
  pageRecordSchema,
  toPageRecord,
  type DemoSpace,
} from './schemas.js';
import type { Connection } from '../state/types.js';
import type { SignedDecision } from '../state/decide.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface StreamHandlers {
  onMessage(message: StreamMessage): void;
  onStatus(connection: Connection): void;
}

export interface PairInput {
  /** The six-character code the Central displays, or the QR link carries. */
  code: string;
  /** Present when the pager was opened from the QR link; optional otherwise. */
  pairingId?: string | null;
  deviceName: string;
  publicKeyJwk: JsonWebKey;
  pushSubscription?: unknown | null;
}

export interface PairResult {
  deviceId: string;
  /**
   * Authenticates every later call, the WebSocket included. A secret: it is
   * stored, sent as a bearer token, and never logged or rendered.
   */
  deviceToken: string;
  name: string;
  pairedAt: number;
}

export interface DecisionAck {
  status: 'accepted' | 'rejected' | 'duplicate';
  reason: string | null;
}

export interface CentralClient {
  connect(handlers: StreamHandlers): () => void;
  fetchPending(deviceId: string): Promise<PageRecord[]>;
  markRead(pageId: string): Promise<void>;
  sendDecision(pageId: string, decision: SignedDecision): Promise<DecisionAck>;
  /** BIP-F-15: register the public key against the code, receive the token. */
  pair(input: PairInput): Promise<PairResult>;
  startDemo(): Promise<DemoSpace>;
}

export class CentralError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${path} failed with ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'CentralError';
  }
}

export interface ClientOptions {
  /** Empty in the browser: same origin, proxied to the Central in dev. */
  baseUrl?: string;
  fetchImpl?: FetchLike;
  webSocketFactory?: WebSocketFactory;
  /** `maxAttempts` counts the reconnection attempts, the first socket excluded. */
  backoff?: { baseMs: number; maxMs: number; maxAttempts: number };
  /**
   * Live read of the device token. A getter, not a value: pairing happens after
   * the client exists, and every device-scoped call needs the header (the
   * Central answers 401 without it).
   */
  getDeviceToken?: () => string | null;
}

/** Bounded exponential back-off: 1 s, 2 s, 4 s … capped, then give up. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

const DEFAULT_BACKOFF = { baseMs: 1000, maxMs: 30_000, maxAttempts: 8 };

export function createCentralClient(options: ClientOptions = {}): CentralClient {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const openSocket = options.webSocketFactory ?? defaultWebSocketFactory();
  const backoff = options.backoff ?? DEFAULT_BACKOFF;

  async function request<T>(path: string, init: RequestInit, parse: (json: unknown) => T): Promise<T> {
    const token = options.getDeviceToken?.() ?? null;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CentralError(path, response.status, detail.slice(0, 200));
    }
    const body: unknown = await response.json().catch(() => ({}));
    return parse(body);
  }

  return {
    connect(handlers) {
      let closed = false;
      let attempt = 0;
      let socket: WebSocketLike | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const schedule = (): void => {
        if (closed || attempt >= backoff.maxAttempts) {
          handlers.onStatus('offline');
          return;
        }
        const delay = backoffDelay(attempt, backoff.baseMs, backoff.maxMs);
        attempt += 1;
        timer = setTimeout(open, delay);
      };

      const open = (): void => {
        if (closed) return;
        const token = options.getDeviceToken?.() ?? null;
        if (!token) {
          // Without a device token the Central refuses the upgrade (401) and
          // destroys the socket: retrying would only spin. The pager says so.
          handlers.onStatus('offline');
          return;
        }
        handlers.onStatus('connecting');
        const current = openSocket(streamUrl(baseUrl, token));
        socket = current;
        current.onopen = () => {
          attempt = 0;
          handlers.onStatus('online');
        };
        current.onmessage = (event) => {
          const message = parseStream(event.data);
          if (message) handlers.onMessage(message);
        };
        current.onclose = () => {
          socket = null;
          if (!closed) {
            handlers.onStatus('offline');
            schedule();
          }
        };
        current.onerror = () => current.close();
      };

      open();
      return () => {
        closed = true;
        if (timer !== null) clearTimeout(timer);
        socket?.close();
      };
    },

    async fetchPending(deviceId) {
      const path = `/v1/devices/${encodeURIComponent(deviceId)}/pages?state=pending`;
      return request(path, { method: 'GET' }, (json) => {
        const parsed = pageListSchema.parse(json);
        return (Array.isArray(parsed) ? parsed : parsed.pages).map(toPageRecord);
      });
    },

    async markRead(pageId) {
      await request(`/v1/pages/${encodeURIComponent(pageId)}/read`, { method: 'POST' }, () => undefined);
    },

    async sendDecision(pageId, decision) {
      const body = JSON.stringify(signedDecisionSchema.parse(decision));
      return request(`/v1/pages/${encodeURIComponent(pageId)}/decision`, { method: 'POST', body }, (json) =>
        decisionAckSchema.parse(json ?? {}),
      );
    },

    async pair(input) {
      const body = JSON.stringify({
        ...(input.pairingId ? { pairing_id: input.pairingId } : {}),
        code: input.code,
        device_name: input.deviceName,
        public_key_jwk: input.publicKeyJwk,
        push_subscription: input.pushSubscription ?? null,
      });
      return request('/v1/devices', { method: 'POST', body }, (json) => {
        const parsed = deviceResponseSchema.parse(json);
        return {
          deviceId: parsed.device_id,
          deviceToken: parsed.device_token,
          name: parsed.name,
          pairedAt: parsed.paired_at,
        };
      });
    },

    async startDemo() {
      return request('/v1/demo/start', { method: 'POST' }, (json) => demoResponseSchema.parse(json));
    },
  };
}

export function parsePage(input: unknown): PageRecord {
  return toPageRecord(pageRecordSchema.parse(input));
}

function parseStream(data: unknown): StreamMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = streamMessageSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * A browser WebSocket cannot carry an Authorization header, so the device
 * token travels in the query string — the form the Central reads first
 * (`packages/central/src/stream.ts`).
 */
export function streamUrl(baseUrl: string, token: string): string {
  const query = `?token=${encodeURIComponent(token)}`;
  if (baseUrl) return `${baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/stream${query}`;
  const location = (globalThis as { location?: Location }).location;
  const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location?.host ?? '127.0.0.1:8787'}/v1/stream${query}`;
}

function defaultWebSocketFactory(): WebSocketFactory {
  return (url) => {
    const Ctor = (globalThis as { WebSocket?: new (target: string) => WebSocket }).WebSocket;
    if (!Ctor) throw new Error('WebSocket is not available in this environment');
    return new Ctor(url) as unknown as WebSocketLike;
  };
}
