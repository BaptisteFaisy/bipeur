/**
 * Chaos bench, part 3 — the WebSocket stream under abuse (BIP-F-19).
 *
 * Fifty clients, abrupt disappearances, malformed inbound frames, an invalid
 * token on the socket URL, and the recovery path when a page is delivered
 * while no pager listens. Real sockets on a kernel-assigned loopback port.
 *
 * Note for the threat model: the device token travels in the query string of
 * `GET /v1/stream?token=…`. The Central never logs request URLs, but any
 * reverse proxy or access log in front of it would capture a live credential
 * (documented as an open weakness, not fixed here — application code is out
 * of this branch's scope).
 */
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

let bench: Bench | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.terminate();
    } catch {
      /* already gone */
    }
  }
  if (bench) {
    await bench.close();
    bench = null;
  }
});

/** Buffers every frame from the moment the socket exists: no race, no loss. */
class Frames {
  private readonly seen: string[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw: Buffer) => this.seen.push(raw.toString()));
  }

  /** Resolves with the first buffered or future frame matching `wanted`. */
  next(wanted: string, timeoutMs = 5000): Promise<string> {
    const found = this.seen.find((frame) => frame.includes(wanted));
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${wanted}`)), timeoutMs);
      this.socket.on('message', (raw: Buffer) => {
        const text = raw.toString();
        if (!text.includes(wanted)) return;
        clearTimeout(timer);
        resolve(text);
      });
    });
  }
}

function connect(url: string): Frames {
  const socket = new WebSocket(url);
  socket.on('error', () => undefined); // an aborted upgrade must not crash the test
  sockets.push(socket);
  return new Frames(socket);
}

function opened(frames: Frames): Promise<void> {
  return new Promise((resolve, reject) => {
    frames.socket.once('open', resolve);
    frames.socket.once('unexpected-response', (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)));
  });
}

async function pair(name: string): Promise<{ deviceId: string; deviceToken: string }> {
  const pairing = await call(bench!.central, 'POST', '/v1/pairings', bench!.stationToken);
  expect(pairing.status).toBe(201);
  const pairKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const res = await call(bench!.central, 'POST', '/v1/devices', bench!.stationToken, {
    device_name: name,
    public_key_jwk: pairKeys.publicKey.export({ format: 'jwk' }),
    code: pairing.body.code,
  });
  expect(res.status).toBe(201);
  return { deviceId: res.body.device_id as string, deviceToken: res.body.device_token as string };
}

describe('the stream under abuse', () => {
  it('refuses an invalid token on the socket URL and accepts a valid one', async () => {
    bench = await startBench();
    const { url } = await bench.central.listen();
    const device = await pair('stream-device');
    const wsBase = url.replace('http', 'ws');

    const bad = connect(`${wsBase}/v1/stream?token=bogus-token`);
    await expect(opened(bad)).rejects.toThrow(/401/);

    const good = connect(`${wsBase}/v1/stream?token=${device.deviceToken}`);
    const hello = good.next('"hello"');
    await opened(good);
    expect(JSON.parse(await hello).type).toBe('hello');
    expect(bench.central.hub.count()).toBe(1);
  });

  it('carries 50 clients, survives abrupt disappears and malformed frames', async () => {
    bench = await startBench();
    const { url } = await bench.central.listen();
    const device = await pair('stream-fleet');
    const wsUrl = `${url.replace('http', 'ws')}/v1/stream?token=${device.deviceToken}`;
    const fleet: Frames[] = [];
    for (let i = 0; i < 50; i += 1) {
      const client = connect(wsUrl);
      await opened(client);
      fleet.push(client);
    }
    expect(bench.central.hub.count()).toBe(50);

    // Half the fleet disappears the dirty way: terminate, no close frame.
    for (const client of fleet.slice(0, 25)) client.socket.terminate();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // A survivor sends garbage the hub never expects (it is a broadcast-only
    // channel): binary, a forged event, a huge frame. The server must not care.
    const survivor = fleet[25];
    survivor.socket.send(Buffer.from([0x00, 0xff, 0xfe, 0x41]));
    survivor.socket.send('{"type": "page.decided", "page_id": "pg_forged"}');
    survivor.socket.send('x'.repeat(1_000_000));
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The Central still serves HTTP and still broadcasts to the living.
    const broadcast = survivor.next('page.delivered');
    const page = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'broadcast after the storm?',
      dedupe_key: 'chaos-ws-1',
    });
    expect(page.status).toBe(201);
    const health = await call(bench.central, 'GET', '/healthz', bench.stationToken);
    expect(health.body.ok).toBe(true);
    expect(await broadcast).toContain(page.body.page_id as string);
    expect(fleet.slice(26).every((client) => client.socket.readyState === WebSocket.OPEN)).toBe(true);
  });

  it('a page delivered while no pager listens is found again on resync', async () => {
    bench = await startBench();
    const device = await pair('stream-offline');
    const page = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'delivered into the void?',
      dedupe_key: 'chaos-ws-2',
    });
    expect(page.body.state).toBe('delivered');
    expect(bench.central.hub.count()).toBe(0);

    const { url } = await bench.central.listen();
    const client = connect(`${url.replace('http', 'ws')}/v1/stream?token=${device.deviceToken}`);
    await opened(client);
    const resync = await call(bench.central, 'GET', `/v1/devices/${device.deviceId}/pages`, device.deviceToken);
    const ids = (resync.body.pages as { page_id: string }[]).map((entry) => entry.page_id);
    expect(ids).toContain(page.body.page_id as string);
  });
});
