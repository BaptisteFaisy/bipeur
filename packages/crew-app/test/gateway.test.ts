import { describe, expect, it } from 'vitest';
import { createWebSocketGateway, type WebSocketLike } from '../src/gateway.js';

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

function harness(): {
  sockets: FakeSocket[];
  delays: number[];
  runScheduled: () => void;
  gateway: ReturnType<typeof createWebSocketGateway>;
} {
  const sockets: FakeSocket[] = [];
  const delays: number[] = [];
  const scheduled: (() => void)[] = [];
  const gateway = createWebSocketGateway({
    url: 'ws://crew.test/stream',
    backoffMs: 100,
    maxBackoffMs: 400,
    createSocket: () => {
      const socket = makeSocket();
      sockets.push(socket);
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
  return { sockets, delays, runScheduled, gateway };
}

describe('BIP-F-27 — Gateway reconnection', () => {
  it('reconnects with a bounded exponential backoff', () => {
    const { sockets, delays, runScheduled, gateway } = harness();
    gateway.start(() => {});
    expect(sockets).toHaveLength(1);
    sockets[0]?.onopen?.({});
    expect(gateway.state).toBe('connected');

    sockets[0]?.onclose?.({});
    expect(gateway.state).toBe('disconnected');
    expect(delays).toEqual([100]);

    runScheduled();
    expect(sockets).toHaveLength(2);
    sockets[1]?.onclose?.({});
    expect(delays).toEqual([100, 200]);

    runScheduled();
    sockets[2]?.onclose?.({});
    expect(delays).toEqual([100, 200, 400]);

    runScheduled();
    sockets[3]?.onclose?.({});
    expect(delays).toEqual([100, 200, 400, 400]);
  });

  it('resets the backoff once a connection opens', () => {
    const { sockets, delays, runScheduled, gateway } = harness();
    gateway.start(() => {});
    sockets[0]?.onclose?.({});
    runScheduled();
    sockets[1]?.onopen?.({});
    sockets[1]?.onclose?.({});
    expect(delays).toEqual([100, 100]);
  });

  it('forwards decoded events and ignores undecodable frames', () => {
    const { sockets, gateway } = harness();
    const received: unknown[] = [];
    gateway.start((event) => received.push(event));
    sockets[0]?.onmessage?.({ data: JSON.stringify({ type: 'approval', approval_id: 'ap_1' }) });
    sockets[0]?.onmessage?.({ data: '{not json' });
    expect(received).toEqual([{ type: 'approval', approval_id: 'ap_1' }]);
  });

  it('stops reconnecting after stop()', () => {
    const { sockets, delays, runScheduled, gateway } = harness();
    gateway.start(() => {});
    gateway.stop();
    expect(sockets[0]?.closed).toBe(true);
    runScheduled();
    expect(delays).toHaveLength(0);
    expect(gateway.state).toBe('disconnected');
  });
});
