/**
 * BIP-N-03 / A.9 — CORS for a static deployment of the pager.
 *
 * The pager is normally served BY the Central (same origin, no CORS needed).
 * Served from GitHub Pages it is on another origin, and the browser then asks
 * for a preflight before the first call. The allowed origins are explicit:
 * `*` would let any site on the internet use a token it stole.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { startBench } from './helpers.js';

const PAGES_ORIGIN = 'https://tradoooo.github.io';

describe('CORS for a static deployment of the pager', () => {
  let bench: Bench;
  afterEach(async () => {
    await bench?.close();
  });

  it('answers the preflight for an allowed origin', async () => {
    bench = await startBench({ corsOrigins: [PAGES_ORIGIN] });
    const response = await bench.central.app.request('/v1/pages', {
      method: 'OPTIONS',
      headers: {
        origin: PAGES_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(PAGES_ORIGIN);
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    );
  });

  it('does not answer for an origin that is not on the list', async () => {
    bench = await startBench({ corsOrigins: [PAGES_ORIGIN] });
    const response = await bench.central.app.request('/healthz', {
      headers: { origin: 'https://example.invalid' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a real call for an allowed origin', async () => {
    bench = await startBench({ corsOrigins: [PAGES_ORIGIN] });
    const response = await bench.central.app.request('/healthz', {
      headers: { origin: PAGES_ORIGIN },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(PAGES_ORIGIN);
  });

  it('keeps the same-origin deployment working without an Origin header', async () => {
    bench = await startBench({ corsOrigins: [PAGES_ORIGIN] });
    const response = await bench.central.app.request('/healthz');
    expect(response.status).toBe(200);
  });

  it('authorises the private network for an allowed origin (Chrome PNA)', async () => {
    // From a tailnet member's browser the Central resolves to a 100.64/10
    // address: Chrome marks the preflight and blocks without this answer.
    bench = await startBench({ corsOrigins: [PAGES_ORIGIN] });
    const response = await bench.central.app.request('/v1/pages', {
      method: 'OPTIONS',
      headers: {
        origin: PAGES_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization',
        'access-control-request-private-network': 'true',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('does not open the private network to an origin that is not on the list', async () => {
    bench = await startBench({ corsOrigins: [PAGES_ORIGIN] });
    const response = await bench.central.app.request('/v1/pages', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.invalid',
        'access-control-request-method': 'POST',
        'access-control-request-private-network': 'true',
      },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-private-network')).toBeNull();
  });
});
