import { describe, expect, it } from 'vitest';
import { createWebSocketGateway, type SocketOptions, type WebSocketLike } from '../src/gateway.js';

interface FakeSocket extends WebSocketLike {
  closed: boolean;
}

function makeSocket(): FakeSocket {
  return {
    closed: false,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close() {
      this.closed = true;
    },
  };
}

function harness(headers?: () => Promise<Record<string, string>> | Record<string, string>) {
  const sockets: FakeSocket[] = [];
  const seen: SocketOptions[] = [];
  const delays: number[] = [];
  const scheduled: (() => void)[] = [];
  const gateway = createWebSocketGateway({
    url: 'ws://crew.test/api/ws',
    headers,
    backoffMs: 100,
    maxBackoffMs: 400,
    createSocket: (_url, options) => {
      const socket = makeSocket();
      sockets.push(socket);
      seen.push(options);
      return socket;
    },
    schedule: (fn, ms) => {
      delays.push(ms);
      scheduled.push(fn);
      return 0;
    },
  });
  const runScheduled = (): void => {
    const next = scheduled.shift();
    next?.();
  };
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };
  return { sockets, seen, delays, runScheduled, settle, gateway };
}

describe('BIP-F-27 — Gateway reconnection', () => {
  it('reconnects with a bounded exponential backoff', async () => {
    const { sockets, delays, runScheduled, settle, gateway } = harness();
    gateway.start(() => {});
    await settle();
    expect(sockets).toHaveLength(1);
    sockets[0]?.onopen?.({});
    expect(gateway.state).toBe('connected');

    sockets[0]?.onclose?.({});
    expect(gateway.state).toBe('disconnected');
    expect(delays).toEqual([100]);

    runScheduled();
    await settle();
    expect(sockets).toHaveLength(2);
    sockets[1]?.onclose?.({});
    expect(delays).toEqual([100, 200]);

    runScheduled();
    await settle();
    sockets[2]?.onclose?.({});
    expect(delays).toEqual([100, 200, 400]);

    runScheduled();
    await settle();
    sockets[3]?.onclose?.({});
    expect(delays).toEqual([100, 200, 400, 400]);
  });

  it('resets the backoff once a connection opens', async () => {
    const { sockets, delays, runScheduled, settle, gateway } = harness();
    gateway.start(() => {});
    await settle();
    sockets[0]?.onclose?.({});
    runScheduled();
    await settle();
    sockets[1]?.onopen?.({});
    sockets[1]?.onclose?.({});
    expect(delays).toEqual([100, 100]);
  });

  it('forwards decoded frames and ignores undecodable ones', async () => {
    const { sockets, settle, gateway } = harness();
    const received: unknown[] = [];
    gateway.start((event) => received.push(event));
    await settle();
    sockets[0]?.onmessage?.({ data: JSON.stringify({ type: 'approval', data: { id: 'ap_1' } }) });
    sockets[0]?.onmessage?.({ data: '{not json' });
    expect(received).toEqual([{ type: 'approval', data: { id: 'ap_1' } }]);
  });

  it('carries the auth cookie header on every connection attempt', async () => {
    let token = 'tok_v1';
    const { sockets, seen, runScheduled, settle, gateway } = harness(() => ({ cookie: `mc_token_5476=${token}` }));
    gateway.start(() => {});
    await settle();
    expect(seen[0]?.headers).toEqual({ cookie: 'mc_token_5476=tok_v1' });

    token = 'tok_v2';
    sockets[0]?.onclose?.({});
    runScheduled();
    await settle();
    expect(seen[1]?.headers).toEqual({ cookie: 'mc_token_5476=tok_v2' });
  });

  it('connects anyway when the auth header cannot be produced yet', async () => {
    const { sockets, seen, settle, gateway } = harness(async () => {
      throw new Error('no secret');
    });
    gateway.start(() => {});
    await settle();
    await settle();
    expect(sockets).toHaveLength(1);
    expect(seen[0]?.headers).toEqual({});
  });

  it('stops reconnecting after stop()', async () => {
    const { sockets, runScheduled, settle, gateway } = harness();
    gateway.start(() => {});
    await settle();
    sockets[0]?.onclose?.({});
    gateway.stop();
    runScheduled();
    await settle();
    expect(sockets).toHaveLength(1);
    expect(gateway.state).toBe('disconnected');
  });

  it('closes a live socket on stop()', async () => {
    const { sockets, settle, gateway } = harness();
    gateway.start(() => {});
    await settle();
    gateway.stop();
    expect(sockets[0]?.closed).toBe(true);
  });
});
