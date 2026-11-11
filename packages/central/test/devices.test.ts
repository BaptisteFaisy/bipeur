/**
 * BIP-F-15 — pairing, single use, five minutes, and revocation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

const JWK = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' };

describe('BIP-F-15 — pairing is single use and expires', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('creates a six-character code valid for five minutes', async () => {
    const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
    expect(pairing.status).toBe(201);
    expect(pairing.body.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(pairing.body.expires_at - bench.clock.now()).toBe(5 * 60 * 1000);
    expect(pairing.body.qr_url).toContain(pairing.body.code);
  });

  it('pairs once and refuses the second attempt', async () => {
    const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
    const request = {
      pairing_id: pairing.body.pairing_id,
      code: pairing.body.code,
      device_name: 'Phone',
      public_key_jwk: JWK,
    };
    const first = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, request);
    expect(first.status).toBe(201);
    expect(first.body.device_token).toMatch(/^bip_/);
    const second = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, request);
    expect(second.status).toBe(409);
  });

  it('refuses an expired pairing link', async () => {
    const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
    bench.clock.advance(5 * 60 * 1000 + 1);
    const created = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
      pairing_id: pairing.body.pairing_id,
      code: pairing.body.code,
      device_name: 'Phone',
      public_key_jwk: JWK,
    });
    expect(created.status).toBe(410);
  });

  it('refuses a wrong code', async () => {
    const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
    const created = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
      pairing_id: pairing.body.pairing_id,
      code: 'AAAAAA',
      device_name: 'Phone',
      public_key_jwk: JWK,
    });
    expect(created.status).toBe(422);
  });

  it('a revoked device is refused everywhere', async () => {
    const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
    const device = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
      pairing_id: pairing.body.pairing_id,
      code: pairing.body.code,
      device_name: 'Phone',
      public_key_jwk: JWK,
    });
    const revoked = await call(bench.central, 'DELETE', `/v1/devices/${device.body.device_id}`, bench.stationToken);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBe(true);
    const pages = await call(bench.central, 'GET', `/v1/devices/${device.body.device_id}/pages`, device.body.device_token);
    expect(pages.status).toBe(403);
    expect(bench.central.audit.list({ type: 'device.revoked' })).toHaveLength(1);
  });

  it('lists the pending pages of a device', async () => {
    const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
    const device = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
      pairing_id: pairing.body.pairing_id,
      code: pairing.body.code,
      device_name: 'Phone',
      public_key_jwk: JWK,
    });
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const list = await call(bench.central, 'GET', `/v1/devices/${device.body.device_id}/pages?state=pending`, device.body.device_token);
    expect(list.status).toBe(200);
    expect(list.body.pages).toHaveLength(1);
    expect(list.body.pages[0].line).toMatch(/#[0-9a-f]{4}$/);
  });
});
