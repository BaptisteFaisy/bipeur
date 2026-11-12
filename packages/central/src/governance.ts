/**
 * Governance of the fleet: per-agent reputation and chattiness, derived from
 * the log and the tables — never from what an agent says about itself.
 *
 * The numbers feed the dashboard (BIP-F-30), so an operator can tell at a
 * glance which agent pages only when it must, and which one is a noise maker.
 */

import type { SourceActivity } from './store/types.js';

/** Pages per hour above which a source is "chatty" (the attention budget). */
export const CHATTY_DEFAULT_THRESHOLD = 6;

/** A station silent for this long is presumed stuck (stall detection). */
export const STUCK_AFTER_MS = 6 * 3_600_000;

/**
 * Reputation, 0 to 1, neutral 0.5. A source is trusted when it does not cry
 * wolf: every page it cancels itself is a false alarm. Approvals and denials
 * are both legitimate asks — the human decided, either way.
 */
export function reputationOf(activity: SourceActivity): number {
  if (activity.created === 0) return 0.5;
  const falseAlarms = Math.min(activity.cancelled, activity.created);
  return clamp(1 - falseAlarms / activity.created, 0, 1);
}

/** Is the source paging more often than the budget allows? */
export function isChatty(activity: SourceActivity, threshold = CHATTY_DEFAULT_THRESHOLD): boolean {
  return activity.createdLastHour > threshold;
}

/** Has the station been silent long enough to be presumed stuck? */
export function isStuck(lastSeenAt: number | null, now: number): boolean {
  return lastSeenAt !== null && now - lastSeenAt > STUCK_AFTER_MS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}