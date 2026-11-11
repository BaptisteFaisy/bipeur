/**
 * BIP-F-09 / BIP-F-10 — attention budget and quiet hours, plus the seven green
 * requests of the A.17 recipe: six deliveries and one held.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

describe('BIP-F-09 — seven green requests give six deliveries and one held', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench({ budgetPerHour: 6 });
  });
  afterEach(async () => {
    await bench.close();
  });

  it('holds the seventh page and releases it an hour later', async () => {
    const states: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
        kind: 'question',
        question: `pick ${index}`,
        ttl_seconds: 7200,
        options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
      });
      states.push(created.body.state);
    }
    expect(states.slice(0, 6)).toEqual(Array(6).fill('delivered'));
    expect(states[6]).toBe('queued');
    expect(bench.central.audit.list({ type: 'page.held' })).toHaveLength(1);

    expect(bench.central.store.listPages({ state: 'queued', limit: 10 })).toHaveLength(1);

    bench.clock.advance(3_600_001);
    bench.central.sweep();
    expect(bench.central.store.listPages({ state: 'queued', limit: 10 })).toHaveLength(0);
    expect(bench.central.audit.list({ type: 'page.delivered' })).toHaveLength(7);
    expect(bench.central.audit.list({ type: 'budget.flushed' })).toHaveLength(1);
  });

  it('a held page that outlives its own TTL is a refusal, never an approval', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
        kind: 'question',
        question: `short ${index}`,
        options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
      });
      ids.push(created.body.page_id);
    }
    bench.clock.advance(16 * 60 * 1000);
    bench.central.sweep();
    expect(bench.central.store.listPages({ state: 'pending', limit: 10 })).toHaveLength(0);
    expect(bench.central.audit.list({ type: 'page.decided' })).toHaveLength(0);
    const held = ids[6]!;
    expect(bench.central.store.pageById(held)?.state).toBe('expired');
  });

  it('never holds a red page', async () => {
    for (let index = 0; index < 8; index += 1) {
      const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
        kind: 'tool',
        tool_name: 'shell',
        command: `rm -rf build-${index}`,
      });
      expect(created.body.risk).toBe('red');
      expect(created.body.state).toBe('delivered');
    }
    expect(bench.central.audit.list({ type: 'page.held' })).toHaveLength(0);
  });

  it('never holds a family 9 page', async () => {
    for (let index = 0; index < 7; index += 1) {
      await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
        kind: 'question',
        question: `green ${index}`,
        options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
      });
    }
    const emergency = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'registry unreachable',
      code: 911,
      options: [{ code: 'A', label: 'retry' }, { code: 'B', label: 'abort' }],
    });
    expect(emergency.body.code).toBe(911);
    expect(emergency.body.state).toBe('delivered');
  });
});

describe('BIP-F-10 — quiet hours keep only red and family 9', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
    bench.central.gate.setQuietHours({ enabled: true, start: '23:00', end: '07:00' });
  });
  afterEach(async () => {
    await bench.close();
  });

  it('logs the held page to the digest and refuses it', async () => {
    bench.clock.set(new Date('2026-11-11T23:30:00Z').getTime());
    const quiet = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'ship the release?',
      options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
    });
    expect(quiet.body.state).toBe('expired');
    expect(bench.central.audit.list({ type: 'quiet.suppressed' })).toHaveLength(1);
    expect(bench.central.store.listNotices(10)).toHaveLength(1);
    const waited = await call(bench.central, 'GET', `/v1/pages/${quiet.body.page_id}/decision?wait=0`, bench.stationToken);
    expect(waited.body.status).toBe('expired');

    const red = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'rm -rf packages/core',
    });
    expect(red.body.state).toBe('delivered');
  });
});
