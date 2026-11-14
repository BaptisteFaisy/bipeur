/**
 * BIP-F-43 — the reflex guard measures a habit, not a single click.
 *
 * A human who approves in 150 ms has signed, willingly, without reading. The
 * median of the device's own recent decisions is the habit; a minimum sample
 * count avoids calling a person reflexive after their first two pages; a
 * deliberate hold lifts the median by itself, so the counter follows the
 * intention and needs no reset button.
 */
import { describe, expect, it } from 'vitest';
import {
  reflexState,
  REFLEX_MIN_SAMPLES,
  REFLEX_THRESHOLD_MS,
  REFLEX_WINDOW,
} from '../src/reflex.js';

describe('the median habit of one device', () => {
  it('does not call two quick decisions a habit', () => {
    const state = reflexState([200, 250]);
    expect(state.reflex).toBe(false);
    expect(state.reason).toBe('not_enough_history');
    expect(state.samples).toBe(2);
    expect(state.median_ms).toBe(225);
  });

  it('marks the next page a canary when the median falls under 1.5 s', () => {
    const state = reflexState([200, 250, 300]);
    expect(state.reflex).toBe(true);
    expect(state.median_ms).toBe(250);
    expect(state.reason).toBe('reflex');
    expect(state.threshold_ms).toBe(REFLEX_THRESHOLD_MS);
  });

  it('is a median, not a mean: one slow decision does not launder a habit of reflexes', () => {
    const state = reflexState([100, 200, 150, 90_000, 80_000]);
    expect(state.reflex).toBe(true);
    expect(state.median_ms).toBe(200);
  });

  it('one reflex does not condemn a careful human', () => {
    const state = reflexState([8_000, 9_000, 150, 7_000, 9_500]);
    expect(state.reflex).toBe(false);
    expect(state.median_ms).toBe(8_000);
    expect(state.reason).toBe('slow_enough');
  });

  it('lifts itself when the human deliberately holds', () => {
    const reflex = reflexState([200, 250, 300]);
    expect(reflex.reflex).toBe(true);
    // The canary demands one second. Its latency is at least one second, and
    // each deliberate answer lifts the median — but a MEDIAN is sticky by
    // construction: three reflexes still weigh as much as three holds, so the
    // guard stays on until the intention really dominates the history.
    const oneHold = reflexState([200, 250, 300, 1_001]);
    expect(oneHold.median_ms).toBe(275);
    expect(oneHold.reflex).toBe(true);
    const threeHolds = reflexState([200, 250, 300, 1_001, 1_200, 1_300]);
    expect(threeHolds.median_ms).toBe(650.5);
    expect(threeHolds.reflex).toBe(true);
    // Seven deliberate answers and the habit is a deliberate one.
    const careful = reflexState([200, 250, 300, 2_000, 2_000, 2_000, 2_000, 2_000, 2_000, 2_000]);
    expect(careful.median_ms).toBe(2_000);
    expect(careful.reflex).toBe(false);
    expect(careful.reason).toBe('slow_enough');
  });

  it('keeps only the ten most recent decisions: a habit can change', () => {
    const oldQuick = Array(10).fill(200) as number[];
    expect(reflexState(oldQuick).reflex).toBe(true);
    const afterTenSlow = [...oldQuick, ...Array(10).fill(3_000) as number[]];
    const state = reflexState(afterTenSlow);
    expect(state.samples).toBe(REFLEX_WINDOW);
    expect(state.median_ms).toBe(3_000);
    expect(state.reflex).toBe(false);
    expect(REFLEX_MIN_SAMPLES).toBe(3);
  });

  it('ignores impossible negative and non-finite samples', () => {
    const state = reflexState([200, -100, Number.NaN, Number.POSITIVE_INFINITY, 300, 250]);
    expect(state.reflex).toBe(true);
    expect(state.samples).toBe(3);
    expect(state.median_ms).toBe(250);
  });

  it('lets a deployment change the threshold without changing the rule', () => {
    expect(reflexState([200, 250, 300], 200).reflex).toBe(false);
    expect(reflexState([200, 250, 300], 251).reflex).toBe(true);
  });
});
