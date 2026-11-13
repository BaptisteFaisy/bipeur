/**
 * The Crew Gateway event stream, behind an injectable interface: the relay
 * never imports a transport. The real stream is the Gateway's `/api/ws`
 * WebSocket, authenticated with the same `mc_token_<port>` cookie as REST
 * (kirocrew-client `create_ws` reuses the client's auth cookie).
 *
 * Reconnection uses a bounded exponential backoff — the official client's
 * policy is base 1 s, cap 30 s (`ws_client.py`); ours is configurable with
 * the same shape. Every reconnect attempt re-reads the cookie header, so a
 * token exchanged while the socket was down rides the next handshake.
 */
import { WebSocket } from 'ws';

export type GatewayState = 'connected' | 'disconnected';

export interface CrewGateway {
  readonly state: GatewayState;
  start(handler: (event: unknown) => void): void;
  stop(): void;
}

/** The subset of a WebSocket this module needs, so a test can fake it. */
export interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

export interface SocketOptions {
  headers: Record<string, string>;
}

export type WebSocketFactory = (url: string, options: SocketOptions) => WebSocketLike;

export interface WebSocketGatewayOptions {
  url: string;
  /** Called on every connection attempt; supplies the auth cookie header. */
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  createSocket?: WebSocketFactory;
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Injected so a test never waits on a real timer. */
  schedule?: (fn: () => void, ms: number) => unknown;
  onState?: (state: GatewayState, attempt: number) => void;
}

function decode(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return undefined;
    }
  }
  if (data instanceof Uint8Array) return decode(new TextDecoder().decode(data));
  return data;
}

const defaultSocket: WebSocketFactory = (url, options) =>
  new WebSocket(url, { headers: options.headers }) as unknown as WebSocketLike;

/** Everything one connection attempt owns; `stop()` and reconnection both use it. */
interface Link {
  socket: WebSocketLike | null;
  handler: ((event: unknown) => void) | null;
  stopped: boolean;
  attempt: number;
  state: GatewayState;
}

function wireSocket(
  link: Link,
  current: WebSocketLike,
  options: WebSocketGatewayOptions,
  schedule: (fn: () => void, ms: number) => unknown,
  reconnect: () => void,
): void {
  current.onopen = () => {
    link.attempt = 0;
    link.state = 'connected';
    options.onState?.('connected', link.attempt);
  };
  current.onmessage = (message) => {
    const event = decode(message.data);
    if (event !== undefined) link.handler?.(event);
  };
  // `close` always follows `error`: one reconnection path, never two.
  current.onerror = () => undefined;
  current.onclose = () => {
    if (link.socket !== current) return;
    link.socket = null;
    link.state = 'disconnected';
    options.onState?.('disconnected', link.attempt);
    if (link.stopped) return;
    const delay = Math.min(options.maxBackoffMs ?? 30_000, (options.backoffMs ?? 500) * 2 ** link.attempt);
    link.attempt += 1;
    schedule(reconnect, delay);
  };
}

async function openLink(
  link: Link,
  options: WebSocketGatewayOptions,
  schedule: (fn: () => void, ms: number) => unknown,
  reconnect: () => void,
): Promise<void> {
  const createSocket = options.createSocket ?? defaultSocket;
  let headers: Record<string, string> = {};
  try {
    headers = (await options.headers?.()) ?? {};
  } catch {
    // No auth yet: connect anyway. The Gateway refuses the handshake and the
    // bounded backoff retries — a dead relay must not be a thrown promise.
  }
  if (link.stopped) return;
  const current = createSocket(options.url, { headers });
  link.socket = current;
  wireSocket(link, current, options, schedule, reconnect);
}

export function createWebSocketGateway(options: WebSocketGatewayOptions): CrewGateway {
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const link: Link = { socket: null, handler: null, stopped: true, attempt: 0, state: 'disconnected' };
  const reconnect = (): void => {
    if (link.stopped || link.handler === null) return;
    void openLink(link, options, schedule, reconnect);
  };

  return {
    get state() {
      return link.state;
    },
    start(handler) {
      link.handler = handler;
      if (!link.stopped) return;
      link.stopped = false;
      link.attempt = 0;
      reconnect();
    },
    stop() {
      link.stopped = true;
      const current = link.socket;
      link.socket = null;
      current?.close();
      link.state = 'disconnected';
    },
  };
}
