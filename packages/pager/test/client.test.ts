/**
 * The Central client, exercised against a fake `fetch` and a fake WebSocket.
 * No test opens a socket or touches the network: every byte is injected.
 */
import { describe, expect, it, vi } from 'vitest';
import type { StreamMessage } from '@bipeur/core';
import {
  backoffDelay,
  CentralError,
  createCentralClient,
  type WebSocketLike,
} from '../src/api/client.js';
import type { SignedDecision } from '../src/state/decide.js';
import { makePage } from './support/fixtures.js';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { impl, calls };
}

const decision: SignedDecision = {
  page_id: 'pg_1',
  fingerprint: 'a'.repeat(64),
  verdict: 'approve',
  choice: null,
  nonce: 'nonce-12345678',
  expires_at: 2_000_000,
  device_id: 'dev_1',
  signature: 'c2lnbmF0dXJl',
};

describe('the client codes against the Central contract', () => {
  it('fetches the pending pages of a device', async () => {
    const page = makePage({ id: 'pg_1' });
    const { impl, calls } = fakeFetch(() => jsonResponse({ pages: [page] }));
    const client = createCentralClient({ fetchImpl: impl });
    const pages = await client.fetchPending('dev_1');
    expect(calls[0]?.url).toBe('/v1/devices/dev_1/pages?state=pending');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(pages).toHaveLength(1);
    expect(pages[0]?.line).toBe(page.line);
  });

  it('accepts a bare array as well as an envelope', async () => {
    const { impl } = fakeFetch(() => jsonResponse([makePage({ id: 'pg_1' })]));
    const client = createCentralClient({ fetchImpl: impl });
    expect(await client.fetchPending('dev_1')).toHaveLength(1);
  });

  it('marks a page as read', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({}));
    const client = createCentralClient({ fetchImpl: impl });
    await client.markRead('pg_1');
    expect(calls[0]?.url).toBe('/v1/pages/pg_1/read');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('posts a signed decision and reads the acknowledgement', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ status: 'accepted', reason: null }));
    const client = createCentralClient({ fetchImpl: impl });
    const ack = await client.sendDecision('pg_1', decision);
    expect(calls[0]?.url).toBe('/v1/pages/pg_1/decision');
    expect(JSON.parse(String(calls[0]?.init?.body)).signature).toBe('c2lnbmF0dXJl');
    expect(ack.status).toBe('accepted');
  });

  it('surfaces a rejected decision instead of throwing it away', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ status: 'rejected', reason: 'replayed nonce' }));
    const client = createCentralClient({ fetchImpl: impl });
    const ack = await client.sendDecision('pg_1', decision);
    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('replayed nonce');
  });

  it('pairs then registers the device', async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.url === '/v1/pairings'
        ? jsonResponse({ pairing_id: 'pair_1', device_id: 'dev_1' })
        : jsonResponse({ id: 'dev_1', name: 'Beeper', paired_at: 42 }),
    );
    const client = createCentralClient({ fetchImpl: impl });
    const pair = await client.pair({
      code: 'A1B2C3',
      deviceName: 'Beeper',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
    });
    expect(pair).toEqual({ pairingId: 'pair_1', deviceId: 'dev_1' });

    const device = await client.registerDevice({
      code: 'A1B2C3',
      deviceName: 'Beeper',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      pairingId: pair.pairingId,
      deviceId: pair.deviceId,
      pushSubscription: null,
    });
    expect(device.id).toBe('dev_1');
    expect(calls[1]?.url).toBe('/v1/devices');
  });

  it('starts the demo', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ ok: true }));
    const client = createCentralClient({ fetchImpl: impl });
    await client.startDemo();
    expect(calls[0]?.url).toBe('/v1/demo/start');
  });

  it('raises a typed error on a non-2xx answer', async () => {
    const { impl } = fakeFetch(() => new Response('nope', { status: 401 }));
    const client = createCentralClient({ fetchImpl: impl });
    await expect(client.fetchPending('dev_1')).rejects.toBeInstanceOf(CentralError);
  });

  it('rejects a page that does not match the wire schema', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ pages: [{ id: 'pg_1' }] }));
    const client = createCentralClient({ fetchImpl: impl });
    await expect(client.fetchPending('dev_1')).rejects.toThrow();
  });
});

describe('the WebSocket stream', () => {
  function fakeSocket() {
    const sockets: WebSocketLike[] = [];
    const factory = (url: string): WebSocketLike => {
      const socket: WebSocketLike = {
        url,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close: vi.fn(),
      } as WebSocketLike & { url: string };
      sockets.push(socket);
      return socket;
    };
    return { factory, sockets };
  }

  it('opens /v1/stream and reports the status', () => {
    const { factory, sockets } = fakeSocket();
    const client = createCentralClient({ webSocketFactory: factory, baseUrl: 'http://127.0.0.1:8787' });
    const statuses: string[] = [];
    const stop = client.connect({ onMessage: () => undefined, onStatus: (s) => statuses.push(s) });
    expect((sockets[0] as unknown as { url: string }).url).toBe('ws://127.0.0.1:8787/v1/stream');
    sockets[0]!.onopen?.();
    expect(statuses).toEqual(['connecting', 'online']);
    stop();
  });

  it('parses a valid stream message and drops a malformed one', () => {
    const { factory, sockets } = fakeSocket();
    const client = createCentralClient({ webSocketFactory: factory, baseUrl: 'http://x' });
    const received: StreamMessage[] = [];
    const stop = client.connect({ onMessage: (m) => received.push(m), onStatus: () => undefined });
    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'hello', central: '0.1.0', budget: 6 }) });
    sockets[0]!.onmessage?.({ data: 'not json' });
    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'nope' }) });
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('hello');
    stop();
  });

  it('reconnects with a bounded back-off after a close', () => {
    vi.useFakeTimers();
    const { factory, sockets } = fakeSocket();
    const client = createCentralClient({
      webSocketFactory: factory,
      baseUrl: 'http://x',
      backoff: { baseMs: 100, maxMs: 400, maxAttempts: 4 },
    });
    const statuses: string[] = [];
    const stop = client.connect({ onMessage: () => undefined, onStatus: (s) => statuses.push(s) });
    sockets[0]!.onclose?.();
    expect(statuses).toContain('offline');
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
    sockets[1]!.onclose?.();
    vi.advanceTimersByTime(200);
    expect(sockets).toHaveLength(3);
    stop();
    vi.useRealTimers();
  });

  it('gives up after the bounded number of reconnection attempts', () => {
    vi.useFakeTimers();
    const { factory, sockets } = fakeSocket();
    const client = createCentralClient({
      webSocketFactory: factory,
      baseUrl: 'http://x',
      backoff: { baseMs: 10, maxMs: 20, maxAttempts: 2 },
    });
    const statuses: string[] = [];
    client.connect({ onMessage: () => undefined, onStatus: (s) => statuses.push(s) });
    sockets[0]!.onclose?.();
    vi.advanceTimersByTime(50);
    sockets[1]!.onclose?.();
    vi.advanceTimersByTime(50);
    sockets[2]!.onclose?.();
    vi.advanceTimersByTime(50);
    // The first socket plus two reconnection attempts, then the pager stops.
    expect(sockets).toHaveLength(3);
    expect(statuses.at(-1)).toBe('offline');
    vi.useRealTimers();
  });

  it('never exceeds the cap of the back-off', () => {
    expect(backoffDelay(0, 1000, 30_000)).toBe(1000);
    expect(backoffDelay(1, 1000, 30_000)).toBe(2000);
    expect(backoffDelay(10, 1000, 30_000)).toBe(30_000);
  });
});
