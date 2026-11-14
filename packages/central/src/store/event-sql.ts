/**
 * Reads of the audit log the transparency layer needs (BIP-F-45).
 *
 * `listEvents` answers the dashboard: newest first, filtered, and without the
 * row id. A Merkle tree is the opposite shape — append order, ids included,
 * because the position of an event in the log *is* one of the facts a proof
 * commits to. These queries are read-only, and they never touch a payload: the
 * log holds none (BIP-N-03).
 */
import type { DatabaseSync } from 'node:sqlite';
import { num, toEvent, type SqlRow } from './rows.js';
import type { EventCount, EventRecord } from './types.js';

export function eventCount(db: DatabaseSync): EventCount {
  const row = db.prepare('SELECT COUNT(*) AS count, MAX(id) AS last FROM events').get() as SqlRow;
  const count = num(row, 'count');
  if (count === 0) return { count: 0, lastId: 0 };
  return { count, lastId: num(row, 'last') };
}

export function eventById(db: DatabaseSync, id: number): EventRecord | null {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as SqlRow | undefined;
  return row ? { id: num(row, 'id'), event: toEvent(row) } : null;
}

/** Append-order page: the events whose id is strictly greater than `afterId`. */
export function eventRange(db: DatabaseSync, afterId: number, limit: number): EventRecord[] {
  const rows = db
    .prepare('SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?')
    .all(afterId, limit) as SqlRow[];
  return rows.map((row) => ({ id: num(row, 'id'), event: toEvent(row) }));
}

/** Position of one event in the log, 0-based; null when the id is not there. */
export function eventIndex(db: DatabaseSync, id: number): number | null {
  if (!eventById(db, id)) return null;
  const row = db.prepare('SELECT COUNT(*) AS value FROM events WHERE id < ?').get(id) as SqlRow;
  return num(row, 'value');
}
