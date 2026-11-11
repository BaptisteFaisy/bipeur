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
  type DeviceRecord,
  type PageRecord,
  type StreamMessage,
} from '@bipeur/core';
import {
  decisionAckSchema,
  deviceResponseSchema,
  pageListSchema,
  pageRecordSchema,
  pairingResponseSchema,
  toPageRecord,
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
  code: string;
  deviceName: string;
  publicKeyJwk: JsonWebKey;
}

export interface PairResult {
  pairingId: string;
  deviceId: string;
}

export interface RegisterInput extends PairInput {
  pairingId: string;
  deviceId: string;
  pushSubscription: unknown | null;
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
  pair(input: PairInput): Promise<PairResult>;
  registerDevice(input: RegisterInput): Promise<DeviceRecord>;
  startDemo(): Promise<void>;
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
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
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
        handlers.onStatus('connecting');
        const current = openSocket(streamUrl(baseUrl));
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
        code: input.code,
        device_name: input.deviceName,
        public_key_jwk: input.publicKeyJwk,
      });
      return request('/v1/pairings', { method: 'POST', body }, (json) => {
        const parsed = pairingResponseSchema.parse(json);
        return { pairingId: parsed.pairing_id, deviceId: parsed.device_id };
      });
    },

    async registerDevice(input) {
      const body = JSON.stringify({
        pairing_id: input.pairingId,
        device_id: input.deviceId,
        device_name: input.deviceName,
        public_key_jwk: input.publicKeyJwk,
        push_subscription: input.pushSubscription,
      });
      return request('/v1/devices', { method: 'POST', body }, (json) => {
        const parsed = deviceResponseSchema.parse(json);
        return {
          id: parsed.id,
          name: parsed.name,
          public_key_jwk: input.publicKeyJwk,
          push_subscription: input.pushSubscription,
          paired_at: parsed.paired_at,
          revoked_at: null,
        } satisfies DeviceRecord;
      });
    },

    async startDemo() {
      await request('/v1/demo/start', { method: 'POST' }, () => undefined);
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

function streamUrl(baseUrl: string): string {
  if (baseUrl) return `${baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/stream`;
  const location = (globalThis as { location?: Location }).location;
  const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location?.host ?? '127.0.0.1:8787'}/v1/stream`;
}

function defaultWebSocketFactory(): WebSocketFactory {
  return (url) => {
    const Ctor = (globalThis as { WebSocket?: new (target: string) => WebSocket }).WebSocket;
    if (!Ctor) throw new Error('WebSocket is not available in this environment');
    return new Ctor(url) as unknown as WebSocketLike;
  };
}
