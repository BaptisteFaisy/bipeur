/**
 * The WebSocket stream (`GET /v1/stream`) and the demo space (BIP-F-31).
 * A real server on an ephemeral loopback port; no external network.
 */
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

interface Frame {
  type: string;
  page?: { page_id: string; line: string };
  page_id?: string;
  central?: string;
  budget?: number;
}

/** Buffers every frame from the moment the socket exists: no lost `hello`. */
class Collector {
  private readonly frames: Frame[] = [];
  private readonly waiters: { wanted: string | undefined; resolve: (frame: Frame) => void }[] = [];

  constructor(socket: WebSocket) {
    socket.on('message', (raw: Buffer) => this.push(JSON.parse(raw.toString()) as Frame));
  }

  /** Resolves with the first frame of that type, past or future. */
  next(wanted: string): Promise<Frame> {
    const found = this.frames.find((frame) => frame.type === wanted);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${wanted}`)), 5000);
      this.waiters.push({
        wanted,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  }

  private push(frame: Frame): void {
    this.frames.push(frame);
    for (const waiter of [...this.waiters]) {
      if (waiter.wanted !== undefined && waiter.wanted !== frame.type) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  }
}

async function connect(url: string): Promise<{ socket: WebSocket; frames: Collector }> {
  const socket = new WebSocket(url);
  const frames = new Collector(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => reject(new Error(`status ${response.statusCode}`)));
  });
  return { socket, frames };
}

describe('BIP-F-19 — the stream announces hello and every page event', () => {
  let bench: Bench | null = null;
  afterEach(async () => {
    if (bench) await bench.close();
    bench = null;
  });

  it('sends hello then page.delivered to the paired pager', async () => {
    bench = await startBench();
    const { url } = await bench.central.listen();
    const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
    const device = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
      pairing_id: pairing.body.pairing_id,
      code: pairing.body.code,
      device_name: 'Pager',
      public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' },
    });
    const { socket, frames } = await connect(`${url.replace('http', 'ws')}/v1/stream?token=${device.body.device_token}`);
    const hello = await frames.next('hello');
    expect(hello.central).toContain('bipeur-central');
    expect(hello.budget).toBe(6);

    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const delivered = await frames.next('page.delivered');
    expect(delivered.page?.page_id).toBe(created.body.page_id);
    expect(delivered.page?.line).toMatch(/#[0-9a-f]{4}$/);
    socket.close();
  });

  it('refuses a socket without a valid device token', async () => {
    bench = await startBench();
    const { url } = await bench.central.listen();
    await expect(connect(`${url.replace('http', 'ws')}/v1/stream?token=nope`)).rejects.toBeTruthy();
  });
});

describe('BIP-F-31 — the demo space is isolated and wiped', () => {
  it('answers 404 when demo mode is off', async () => {
    const bench = await startBench({ demo: false });
    const started = await call(bench.central, 'POST', '/v1/demo/start', bench.stationToken, {});
    expect(started.status).toBe(404);
    await bench.close();
  });

  it('starts a visitor with a station, a device and a pager url', async () => {
    const bench = await startBench({ demo: true });
    const started = await call(bench.central, 'POST', '/v1/demo/start', bench.stationToken, {});
    expect(started.status).toBe(201);
    expect(started.body.visitor_id).toMatch(/^vis_/);
    expect(started.body.station_token).toMatch(/^bip_/);
    expect(started.body.device_token).toMatch(/^bip_/);
    expect(started.body.pager_url).toBe('/');
    expect(started.body.device_private_key_jwk.d).toBeTruthy();

    const created = await call(bench.central, 'POST', '/v1/pages', started.body.station_token, {
      kind: 'question',
      question: 'demo works?',
      options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.page_id).toBeTruthy();
    await bench.close();
  });
});
