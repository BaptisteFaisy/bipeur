import { describe, expect, it } from 'vitest';
import { CentralError, createCentralApi } from '../src/central.js';
import type { SignedDecision } from '@bipeur/core';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

/** A Central that answers in memory: no socket, no port, no timer. */
function fakeCentral(): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.endsWith('/v1/devices') && method === 'POST') {
      return json({ device_id: 'dev_1', device_token: 'bip_token' });
    }
    if (url.includes('/decision') && method === 'POST') {
      return json({ accepted: true, page_id: 'pg_1', verdict: 'choice', latency_ms: 12 });
    }
    if (url.includes('/v1/devices/') && url.includes('/pages')) {
      return json({ pages: [{ page_id: 'pg_1', fingerprint: 'd'.repeat(64) }] });
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DECISION: SignedDecision = {
  page_id: 'pg_1',
  fingerprint: 'e'.repeat(64),
  verdict: 'choice',
  choice: 'A',
  nonce: 'abcdefghijklmnop',
  expires_at: 1_700_000_060_000,
  device_id: 'dev_1',
  signature: 'c2lnbmF0dXJlLXZhbHVl',
};

describe('BIP-F-33 — the emulator is a device of the Central', () => {
  it('pairs itself with the code and the public key', async () => {
    const { fetchImpl, calls } = fakeCentral();
    const api = createCentralApi({ baseUrl: 'http://127.0.0.1:8787', fetchImpl });
    const pairing = await api.pair('ABC123', { kty: 'EC', crv: 'P-256' }, 'bip-pager');

    expect(pairing).toEqual({ deviceId: 'dev_1', token: 'bip_token' });
    expect(calls[0]?.url).toBe('http://127.0.0.1:8787/v1/devices');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toMatchObject({
      code: 'ABC123',
      device_name: 'bip-pager',
      public_key_jwk: { kty: 'EC', crv: 'P-256' },
    });
  });

  it('posts the signed decision with the device token', async () => {
    const { fetchImpl, calls } = fakeCentral();
    const api = createCentralApi({ baseUrl: 'http://127.0.0.1:8787', fetchImpl });
    const ack = await api.postDecision('pg_1', DECISION, 'bip_token');

    expect(ack.accepted).toBe(true);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8787/v1/pages/pg_1/decision');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['authorization']).toBe('Bearer bip_token');
    expect(calls[0]?.body).toMatchObject({
      page_id: 'pg_1',
      verdict: 'choice',
      choice: 'A',
      device_id: 'dev_1',
    });
  });

  it('reads the fingerprint of a page the gateway did not push', async () => {
    const { fetchImpl, calls } = fakeCentral();
    const api = createCentralApi({ baseUrl: 'http://127.0.0.1:8787', fetchImpl });
    const fingerprint = await api.fingerprintOf('pg_1', 'dev_1', 'bip_token');

    expect(fingerprint).toBe('d'.repeat(64));
    expect(calls[0]?.url).toBe('http://127.0.0.1:8787/v1/devices/dev_1/pages?state=pending');
    expect(calls[0]?.headers['authorization']).toBe('Bearer bip_token');
  });

  it('has no fingerprint for a page it does not know', async () => {
    const { fetchImpl } = fakeCentral();
    const api = createCentralApi({ baseUrl: 'http://127.0.0.1:8787', fetchImpl });
    expect(await api.fingerprintOf('pg_other', 'dev_1', 'bip_token')).toBeNull();
  });

  it('refuses an unreachable Central instead of pretending', async () => {
    const api = createCentralApi({
      baseUrl: 'http://127.0.0.1:8787',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(api.pair('ABC123', { kty: 'EC' }, 'bip-pager')).rejects.toBeInstanceOf(CentralError);
  });

  it('refuses an answer that is not the shape of the Central', async () => {
    const api = createCentralApi({
      baseUrl: 'http://127.0.0.1:8787',
      fetchImpl: (async () => json({ nope: true })) as unknown as typeof fetch,
    });
    await expect(api.pair('ABC123', { kty: 'EC' }, 'bip-pager')).rejects.toBeInstanceOf(CentralError);
  });
});
