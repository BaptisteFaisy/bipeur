/**
 * The Crew Gateway, behind an injectable interface: the relay never imports a
 * transport, so a WebSocket (or, later, a long-poll) is a detail. Reconnection
 * uses a bounded exponential backoff; the relay keeps its own bounded queue.
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

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebSocketGatewayOptions {
  url: string;
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

const defaultSocket: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike;

/** Everything one connection attempt owns; `stop()` and reconnection both use it. */
interface Link {
  socket: WebSocketLike | null;
  handler: ((event: unknown) => void) | null;
  stopped: boolean;
  attempt: number;
  state: GatewayState;
}

function openLink(
  link: Link,
  options: WebSocketGatewayOptions,
  schedule: (fn: () => void, ms: number) => unknown,
  reconnect: () => void,
): void {
  const createSocket = options.createSocket ?? defaultSocket;
  const backoffMs = options.backoffMs ?? 500;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const current = createSocket(options.url);
  link.socket = current;

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
    const delay = Math.min(maxBackoffMs, backoffMs * 2 ** link.attempt);
    link.attempt += 1;
    schedule(reconnect, delay);
  };
}

export function createWebSocketGateway(options: WebSocketGatewayOptions): CrewGateway {
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const link: Link = {
    socket: null,
    handler: null,
    stopped: true,
    attempt: 0,
    state: 'disconnected',
  };
  const reconnect = (): void => {
    if (link.stopped || link.handler === null) return;
    openLink(link, options, schedule, reconnect);
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
