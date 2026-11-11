/**
 * BIP-N-03 — rate limiting that a caller cannot route around.
 *
 * Found by the pentest bench (`tools/pentest/run.mjs`, threats W1-W3): the
 * limiter was keyed on `X-Forwarded-For`, a header the client writes. Sixty demo
 * spaces went through in a minute against a limit of twenty, and forty pairing
 * attempts produced no 429 at all — so the six-character pairing code was open
 * to brute force. On top of that the key table grew for ever, because a forged
 * token allocates an entry before authentication happens.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clientKey, forwardedAddress, peerAddress } from '../src/client-key.js';
import { DEFAULT_MAX_KEYS, RateLimiter } from '../src/rate-limit.js';
import type { Bench } from './helpers.js';
import { startBench } from './helpers.js';

function fakeContext(headers: Record<string, string>, remoteAddress?: string) {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] ?? undefined },
    env: remoteAddress === undefined ? undefined : { incoming: { socket: { remoteAddress } } },
     
  } as any;
}

describe('the limiter key cannot be forged', () => {
  it('uses the peer address, not a header the caller writes', () => {
    const c = fakeContext({ 'x-forwarded-for': '10.0.0.1' }, '203.0.113.7');
    expect(clientKey(c, false)).toBe('203.0.113.7');
    // A different forged header from the same socket is the same caller.
    const spoofed = fakeContext({ 'x-forwarded-for': '10.0.0.2' }, '203.0.113.7');
    expect(clientKey(spoofed, false)).toBe(clientKey(c, false));
  });

  it('honours X-Forwarded-For only when the operator says there is a proxy', () => {
    const c = fakeContext({ 'x-forwarded-for': '198.51.100.4, 10.0.0.9' }, '10.0.0.9');
    expect(clientKey(c, true)).toBe('198.51.100.4');
    expect(clientKey(c, false)).toBe('10.0.0.9');
  });

  it('normalises an IPv4-mapped IPv6 address and falls back to local', () => {
    expect(peerAddress(fakeContext({}, '::ffff:203.0.113.7'))).toBe('203.0.113.7');
    expect(peerAddress(fakeContext({}, undefined))).toBe('local');
    expect(forwardedAddress(fakeContext({}))).toBeNull();
    expect(forwardedAddress(fakeContext({ 'x-forwarded-for': '  ' }))).toBeNull();
  });
});

describe('the key table is bounded', () => {
  it('never grows past its cap, whatever the number of distinct keys', () => {
    const now = 0;
    const limiter = new RateLimiter(5, 60_000, () => now, 100);
    for (let i = 0; i < 20_000; i += 1) limiter.take(`forged-token-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it('still limits a known key while other keys come and go', () => {
    const now = 0;
    // A cap comfortably above the churn: eviction only kicks in past the cap,
    // and reaching it costs an attacker more requests than the limit itself.
    const limiter = new RateLimiter(2, 60_000, () => now, 5_000);
    expect(limiter.take('real-station')).toBe(true);
    expect(limiter.take('real-station')).toBe(true);
    for (let i = 0; i < 1_000; i += 1) limiter.take(`noise-${i}`);
    expect(limiter.take('real-station')).toBe(false);
    expect(limiter.size).toBeLessThanOrEqual(5_000);
  });

  it('evicts the oldest key rather than growing when the cap is reached', () => {
    const now = 0;
    const limiter = new RateLimiter(5, 60_000, () => now, 4);
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) limiter.take(key);
    expect(limiter.size).toBeLessThanOrEqual(4);
    // Eviction can only relax a limit, never tighten it: the newest key is held.
    expect(limiter.take('f')).toBe(true);
  });

  it('frees a key once its window has expired', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1_000, () => now, 10);
    limiter.take('a');
    expect(limiter.size).toBe(1);
    now = 5_000;
    // The sweep is cadenced, so force it through the cap path.
    for (let i = 0; i < 70; i += 1) limiter.take(`b${i}`);
    expect(limiter.take('a')).toBe(true);
  });

  it('defaults to a sane cap', () => {
    expect(DEFAULT_MAX_KEYS).toBeGreaterThan(0);
    const limiter = new RateLimiter(1, 1000, () => 0);
    expect(limiter.take('x')).toBe(true);
    expect(limiter.take('x')).toBe(false);
  });
});

describe('over HTTP: a forged header no longer buys a fresh bucket', () => {
  let bench: Bench;
  afterEach(async () => {
    await bench?.close();
  });

  it('limits demo spaces across distinct X-Forwarded-For values', async () => {
    bench = await startBench({ demo: true, trustProxy: false });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const response = await bench.central.app.request('/v1/demo/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}` },
        body: '{}',
      });
      statuses.push(response.status);
    }
    // Twenty are allowed by the pairing limiter; the five others must be 429.
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(20);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(5);
  });

  it('limits pairing attempts, so a six-character code cannot be brute forced', async () => {
    bench = await startBench({ trustProxy: false });
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const response = await bench.central.app.request('/v1/devices', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.9.${i}` },
        body: JSON.stringify({
          code: 'AAAAAA',
          device_name: 'probe',
          public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
        }),
      });
      statuses.push(response.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === 201).length).toBe(0);
  });
});
