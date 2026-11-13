/**
 * Bounded delegation (BIP-F-36): pre-approve a class of commands, spend it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

describe('bounded delegation', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('creates a delegation and spends it on a matching command', async () => {
    const created = await call(bench.central, 'POST', '/v1/delegations', bench.stationToken, {
      pattern: 'git push*',
      ttl_seconds: 600,
      remaining: 3,
    });
    expect(created.status).toBe(201);
    expect(created.body.remaining).toBe(3);
    const id = created.body.delegation_id as string;

    const consume = await call(bench.central, 'POST', '/v1/delegations/consume', bench.stationToken, {
      command: 'git push origin main',
    });
    expect(consume.body.matched).toBe(true);
    expect(consume.body.remaining).toBe(2);
    expect(consume.body.delegation_id).toBe(id);
  });

  it('does not match another command', async () => {
    await call(bench.central, 'POST', '/v1/delegations', bench.stationToken, {
      pattern: 'git push*',
    });
    const consume = await call(bench.central, 'POST', '/v1/delegations/consume', bench.stationToken, {
      command: 'rm -rf /',
    });
    expect(consume.body.matched).toBe(false);
  });

  it('stops matching once revoked', async () => {
    const created = await call(bench.central, 'POST', '/v1/delegations', bench.stationToken, {
      pattern: 'git push*',
    });
    const id = created.body.delegation_id as string;
    await call(bench.central, 'DELETE', `/v1/delegations/${id}`, bench.stationToken, {});

    const consume = await call(bench.central, 'POST', '/v1/delegations/consume', bench.stationToken, {
      command: 'git push origin main',
    });
    expect(consume.body.matched).toBe(false);
  });

  it('rejects a missing pattern', async () => {
    const bad = await call(bench.central, 'POST', '/v1/delegations', bench.stationToken, {});
    expect(bad.status).toBe(422);
  });

  it('lists the delegations of the station', async () => {
    await call(bench.central, 'POST', '/v1/delegations', bench.stationToken, { pattern: 'publish*' });
    const response = await bench.central.app.request('/v1/delegations', {
      headers: { authorization: `Bearer ${bench.stationToken}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { delegations: unknown[] };
    expect(body.delegations).toHaveLength(1);
  });
});