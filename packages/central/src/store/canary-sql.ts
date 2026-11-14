/**
 * The reads the anti-rubber-stamping guard needs (BIP-F-43).
 *
 * The habit of a device is its own history: the latencies of the decisions it
 * signed, oldest first. Nothing is accumulated in memory and nothing is
 * denormalised — the `decisions` table already carries `latency_ms`, written by
 * the very path that accepts a decision, so the guard reads the fact instead of
 * keeping a parallel count.
 */
import type { DatabaseSync } from 'node:sqlite';
import { num, type SqlRow } from './rows.js';
import { REFLEX_WINDOW } from '@bipeur/core';

/** The last `REFLEX_WINDOW` latencies of one device, in chronological order. */
export function decisionLatencies(db: DatabaseSync, deviceId: string): number[] {
  const rows = db
    .prepare(
      `SELECT latency_ms AS value FROM decisions
        WHERE device_id = ?
        ORDER BY decided_at DESC
        LIMIT ?`,
    )
    .all(deviceId, REFLEX_WINDOW) as SqlRow[];
  // The query is newest-first so a long history costs the same as a short one;
  // the habit is read oldest-first, because that is the order it formed in.
  return rows.map((row) => num(row, 'value')).reverse();
}
