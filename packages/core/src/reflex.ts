/**
 * The anti-rubber-stamping guard (BIP-F-43).
 *
 * Without this, everything else in Beeper is decoration: a human who approves
 * in 150 ms has signed, willingly, without reading. The pager is the one place
 * where attention is *forced* to be deliberate — and the moment it becomes a
 * reflex, the signature behind a red page means nothing.
 *
 * So the device's own habit is measured, and a habit that is too fast turns the
 * next pages into CANARIES: they demand the gesture an approval is supposed to
 * cost (one second of press-and-hold, the red-page gesture), and they say why
 * on the screen.
 *
 * The median, not the mean: one hesitation must not launder a habit of
 * reflexes, and one reflex must not condemn a careful human. The minimum
 * number of samples, not a timer: a device that decided twice is not a habit
 * yet.
 */
import { median } from './time.js';

/** Below this median, a device is treated as approving without reading. */
export const REFLEX_THRESHOLD_MS = 1_500;

/** Fewer than this decisions and there is no habit to measure. */
export const REFLEX_MIN_SAMPLES = 3;

/** How many recent decisions the habit is read from. */
export const REFLEX_WINDOW = 10;

export interface ReflexState {
  /** True when the next page must be a canary. */
  reflex: boolean;
  /** Median of the window, null when there is not enough history. */
  median_ms: number | null;
  samples: number;
  threshold_ms: number;
  reason: 'reflex' | 'slow_enough' | 'not_enough_history';
}

/**
 * The habit of one device, read from its own recent decision latencies.
 *
 * A page decided by a deliberate gesture costs at least the hold, so its
 * latency lifts the median by itself: the counter follows the INTENTION, not
 * the speed of a single click. No exception, no manual reset — a guard that
 * has to be told to forget is a guard that can be told to forget.
 */
export function reflexState(
  latencies: readonly number[],
  thresholdMs: number = REFLEX_THRESHOLD_MS,
): ReflexState {
  const window = latencies.slice(-REFLEX_WINDOW).filter((ms) => Number.isFinite(ms) && ms >= 0);
  const value = median(window);
  if (window.length < REFLEX_MIN_SAMPLES || value === null) {
    return {
      reflex: false,
      median_ms: value,
      samples: window.length,
      threshold_ms: thresholdMs,
      reason: 'not_enough_history',
    };
  }
  if (value < thresholdMs) {
    return {
      reflex: true,
      median_ms: value,
      samples: window.length,
      threshold_ms: thresholdMs,
      reason: 'reflex',
    };
  }
  return {
    reflex: false,
    median_ms: value,
    samples: window.length,
    threshold_ms: thresholdMs,
    reason: 'slow_enough',
  };
}

/** What the canary page says on the screen, in 80 characters or less. */
export const CANARY_NOTE = 'CANARY: decided too fast lately, hold to approve';

/** The gesture a canary demands: the same one a red page already demands. */
export const CANARY_HOLD_MS = 1_000;
