/**
 * BIP-F-44 — the cost of human attention.
 *
 * "Six pages an hour" is a limit, not a measurement. This is the measurement:
 * what a human actually spent, derived from the facts of the journal alone.
 * The properties that matter are the ones a naive counter gets wrong — a page
 * nobody read still cost the interruption; a page read and never decided must
 * not be counted as decided twice; a quiet week must not dilute a busy hour.
 */
import { describe, expect, it } from 'vitest';
import { attentionCost, attentionSeries, type AttentionSample } from '../src/attention.js';
import { HOUR, MINUTE } from '../src/time.js';

const T0 = 1_760_000_000_000;

function sample(over: Partial<AttentionSample> = {}): AttentionSample {
  return {
    source_id: 'src_a',
    created_at: T0,
    delivered_at: T0 + 1_000,
    read_at: T0 + 11_000,
    decided_at: T0 + 21_000,
    latency_ms: 10_000,
    verdict: 'approve',
    ...over,
  };
}

describe('the bill of one station', () => {
  it('counts the wait and the decision, never twice', () => {
    const cost = attentionCost([sample()]);
    expect(cost.read_ms).toBe(10_000);
    expect(cost.decide_ms).toBe(10_000);
    expect(cost.human_ms).toBe(20_000);
    expect(cost.human_minutes).toBe(0.3);
  });

  it('adds nothing for a page nobody read', () => {
    const cost = attentionCost([sample({ read_at: null, decided_at: null, latency_ms: null, verdict: null })]);
    expect(cost.read_ms).toBe(0);
    expect(cost.decide_ms).toBe(0);
    expect(cost.pages).toBe(1);
    expect(cost.delivered).toBe(1);
    expect(cost.read).toBe(0);
    expect(cost.decided).toBe(0);
  });

  it('counts a page delivered late as the wait it was', () => {
    const cost = attentionCost([sample({ delivered_at: T0 + 5_000, read_at: T0 + 25_000 })]);
    expect(cost.read_ms).toBe(20_000);
  });

  it('falls back to creation when a page has no delivery stamp', () => {
    const cost = attentionCost([sample({ delivered_at: null, read_at: T0 + 30_000 })]);
    expect(cost.read_ms).toBe(30_000);
  });

  it('never lets a clock skew go negative', () => {
    const cost = attentionCost([sample({ read_at: T0 + 1_000, delivered_at: T0 + 9_000 })]);
    expect(cost.read_ms).toBe(0);
  });

  it('separates approvals from denials, and says the rate', () => {
    const cost = attentionCost([
      sample(),
      sample({ verdict: 'deny' }),
      sample({ verdict: 'deny' }),
      sample({ decided_at: null, latency_ms: null, verdict: null }),
    ]);
    expect(cost.decided).toBe(3);
    expect(cost.approved).toBe(1);
    expect(cost.denied).toBe(2);
    expect(cost.denial_rate).toBeCloseTo(2 / 3, 10);
  });

  it('has no denial rate when nothing was decided', () => {
    expect(attentionCost([]).denial_rate).toBe(0);
    expect(attentionCost([sample({ decided_at: null, latency_ms: null, verdict: null })]).denial_rate).toBe(0);
  });

  it('reports the median decision time, not the mean', () => {
    // Mean would be 30 500 ms; the habit is 1 000 ms and one outlier.
    const cost = attentionCost([
      sample({ latency_ms: 1_000 }),
      sample({ latency_ms: 2_000 }),
      sample({ latency_ms: 89_000 }),
    ]);
    expect(cost.decision_median_ms).toBe(2_000);
    expect(cost.decide_ms).toBe(92_000);
  });

  it('measures interruptions per hour over the span of the samples', () => {
    const spread = attentionCost([
      sample({ created_at: T0 }),
      sample({ created_at: T0 + HOUR }),
    ]);
    expect(spread.interruptions_per_hour).toBe(2);
    // One page alone: the span is zero, so the rate is the page itself.
    expect(attentionCost([sample()]).interruptions_per_hour).toBe(1);
  });

  it('does not dilute a busy hour with a quiet week', () => {
    const busy = Array.from({ length: 6 }, (_, i) => sample({ created_at: T0 + i * 60_000 }));
    const cost = attentionCost([...busy, sample({ created_at: T0 + 7 * DAY_MS })]);
    // 7 pages over 7 days: under one per hour, but the six-in-a-minute are the
    // fact that matters and the rate must not read as 6/h.
    expect(cost.interruptions_per_hour).toBeLessThan(1);
    expect(cost.pages).toBe(7);
  });
});

const DAY_MS = 24 * HOUR;

describe('the series of a day', () => {
  it('keeps every hour of the window, empty ones included', () => {
    const series = attentionSeries([sample()], T0 + HOUR, 24);
    expect(series).toHaveLength(24);
    expect(series.filter((bucket) => bucket.pages === 0).length).toBe(23);
  });

  it('puts a page in the hour it was created in', () => {
    const series = attentionSeries(
      [sample({ created_at: T0 + 3 * HOUR }), sample({ created_at: T0 + 3 * HOUR + 1_000 })],
      T0 + 24 * HOUR,
      24,
    );
    const filled = series.filter((bucket) => bucket.pages > 0);
    expect(filled).toHaveLength(1);
    expect(filled[0]!.pages).toBe(2);
  });

  it('carries the human time of the hour, not only the count', () => {
    const series = attentionSeries([sample({ created_at: T0 + HOUR })], T0 + 24 * HOUR, 24);
    const filled = series.find((bucket) => bucket.pages > 0)!;
    expect(filled.human_ms).toBe(20_000);
  });

  it('ignores a page outside the window', () => {
    const series = attentionSeries([sample({ created_at: T0 })], T0 + 24 * HOUR, 6);
    expect(series.every((bucket) => bucket.pages === 0)).toBe(true);
  });

  it('never overflows the last bucket with a page at the very edge', () => {
    const series = attentionSeries([sample({ created_at: T0 + 24 * HOUR - 1 })], T0 + 24 * HOUR, 24);
    expect(series.at(-1)!.pages).toBe(1);
  });

  it('sums to the bill of the same samples', () => {
    const samples = [
      sample({ created_at: T0 + MINUTE }),
      sample({ created_at: T0 + HOUR }),
      sample({ created_at: T0 + 2 * HOUR, verdict: 'deny' }),
    ];
    const series = attentionSeries(samples, T0 + 24 * HOUR, 24);
    const billed = series.reduce((sum, bucket) => sum + bucket.human_ms, 0);
    expect(billed).toBe(attentionCost(samples).human_ms);
  });
});
