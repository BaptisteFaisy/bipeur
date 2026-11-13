/**
 * POST /page — the minimal contract: one line, one tap.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

describe('POST /page — the minimal contract', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('composes a line from a message and a priority', async () => {
    const created = await call(bench.central, 'POST', '/page', bench.stationToken, {
      message: 'night build finished',
      priority: 'normal',
    });
    expect(created.status).toBe(201);
    expect(created.body.line).toContain('night build finished');
    expect(created.body.risk).toBe('amber');
    expect(created.body.code).toBe(310);
  });

  it('maps critical to red and low to green', async () => {
    const critical = await call(bench.central, 'POST', '/page', bench.stationToken, {
      message: 'the database is on fire',
      priority: 'critical',
    });
    expect(critical.body.risk).toBe('red');
    expect(critical.body.code).toBe(110);

    const low = await call(bench.central, 'POST', '/page', bench.stationToken, {
      message: 'coverage is green',
      priority: 'low',
    });
    expect(low.body.risk).toBe('green');
  });

  it('rejects an unauthenticated call', async () => {
    const response = await bench.central.app.request('/page', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a missing message', async () => {
    const missing = await call(bench.central, 'POST', '/page', bench.stationToken, {});
    expect(missing.status).toBe(422);
  });
});