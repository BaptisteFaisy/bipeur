/**
 * Governance numbers: reputation, chattiness, stuck detection — pure — and the
 * heartbeat an agent calls to learn how the Central sees it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isChatty, isStuck, reputationOf } from '../src/governance.js';
import type { SourceActivity } from '../src/store/types.js';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

const activity = (overrides: Partial<SourceActivity> = {}): SourceActivity => ({
  created: 0,
  delivered: 0,
  approved: 0,
  denied: 0,
  cancelled: 0,
  createdLastHour: 0,
  ...overrides,
});

describe('reputationOf', () => {
  it('is neutral when the agent has never paged', () => {
    expect(reputationOf(activity())).toBeCloseTo(0.5);
  });

  it('is maximal for an agent that never cancels itself', () => {
    expect(reputationOf(activity({ created: 10 }))).toBeCloseTo(1);
  });

  it('penalises self-cancellations', () => {
    expect(reputationOf(activity({ created: 10, cancelled: 5 }))).toBeCloseTo(0.5);
  });

  it('never goes below zero', () => {
    expect(reputationOf(activity({ created: 1, cancelled: 100 }))).toBe(0);
  });
});

describe('isChatty', () => {
  it('is true above the attention budget', () => {
    expect(isChatty(activity({ createdLastHour: 7 }))).toBe(true);
  });

  it('is false at or below the budget', () => {
    expect(isChatty(activity({ createdLastHour: 6 }))).toBe(false);
  });
});

describe('isStuck', () => {
  const now = 1_000_000_000_000;

  it('is true after six silent hours', () => {
    expect(isStuck(now - 7 * 3_600_000, now)).toBe(true);
  });

  it('is false when recent, or when the station never appeared', () => {
    expect(isStuck(now - 1_000, now)).toBe(false);
    expect(isStuck(null, now)).toBe(false);
  });
});

describe('POST /v1/heartbeat — an agent asks how it is seen', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('answers with the reputation, the chattiness and the stuck flag', async () => {
    const beat = await call(bench.central, 'POST', '/v1/heartbeat', bench.stationToken, {});
    expect(beat.status).toBe(200);
    expect(beat.body.ok).toBe(true);
    expect(beat.body.alias).toBe('main');
    expect(beat.body.reputation).toBeCloseTo(0.5);
    expect(beat.body.chatty).toBe(false);
    expect(beat.body.stuck).toBe(false);
  });

  it('refuses an unauthenticated beat', async () => {
    const response = await bench.central.app.request('/v1/heartbeat', { method: 'POST' });
    expect(response.status).toBe(401);
  });
});