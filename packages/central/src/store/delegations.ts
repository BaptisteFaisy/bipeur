/**
 * The SQL of `sourceActivity` and the delegation table, as free functions over
 * a `node:sqlite` handle. Kept out of `sqlite.ts` so the store stays small;
 * `SqliteStore` delegates to these one-liners.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { DelegationRow, SourceActivity } from './types.js';
import { num, toDelegationRow, type SqlRow } from './rows.js';

export function sourceActivity(db: DatabaseSync, sourceId: string, now: number): SourceActivity {
  const count = (sql: string, ...params: (string | number)[]): number => {
    const row = db.prepare(sql).get(...params) as SqlRow | undefined;
    return row ? num(row, 'value') : 0;
  };
  return {
    created: count('SELECT COUNT(*) AS value FROM pages WHERE source_id = ?', sourceId),
    delivered: count(
      'SELECT COUNT(*) AS value FROM pages WHERE source_id = ? AND delivered_at IS NOT NULL',
      sourceId,
    ),
    approved: count(
      "SELECT COUNT(*) AS value FROM decisions d JOIN pages p ON p.id = d.page_id WHERE p.source_id = ? AND d.verdict = 'approve'",
      sourceId,
    ),
    denied: count(
      "SELECT COUNT(*) AS value FROM decisions d JOIN pages p ON p.id = d.page_id WHERE p.source_id = ? AND d.verdict = 'deny'",
      sourceId,
    ),
    cancelled: count(
      "SELECT COUNT(*) AS value FROM pages WHERE source_id = ? AND state = 'cancelled'",
      sourceId,
    ),
    createdLastHour: count(
      'SELECT COUNT(*) AS value FROM pages WHERE source_id = ? AND created_at >= ?',
      sourceId,
      now - 3_600_000,
    ),
  };
}

export function insertDelegation(db: DatabaseSync, delegation: DelegationRow): void {
  db.prepare(
    'INSERT INTO delegations (id, source_id, pattern, kind, remaining, created_at, expires_at, revoked_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    delegation.id,
    delegation.source_id,
    delegation.pattern,
    delegation.kind,
    delegation.remaining,
    delegation.created_at,
    delegation.expires_at,
    delegation.revoked_at,
  );
}

export function delegationById(db: DatabaseSync, id: string): DelegationRow | null {
  const row = db.prepare('SELECT * FROM delegations WHERE id = ?').get(id) as SqlRow | undefined;
  return row ? toDelegationRow(row) : null;
}

export function listDelegations(db: DatabaseSync, sourceId: string | null): DelegationRow[] {
  const rows = sourceId
    ? (db.prepare('SELECT * FROM delegations WHERE source_id = ? ORDER BY created_at DESC').all(sourceId) as SqlRow[])
    : (db.prepare('SELECT * FROM delegations ORDER BY created_at DESC').all() as SqlRow[]);
  return rows.map(toDelegationRow);
}

export function consumeDelegation(db: DatabaseSync, id: string, now: number): boolean {
  const delegation = delegationById(db, id);
  if (!delegation || delegation.revoked_at !== null) return false;
  if (delegation.remaining <= 0 || delegation.expires_at <= now) return false;
  db.prepare('UPDATE delegations SET remaining = remaining - 1 WHERE id = ? AND remaining > 0').run(id);
  return num(db.prepare('SELECT changes() AS value').get() as SqlRow, 'value') === 1;
}

export function revokeDelegation(db: DatabaseSync, id: string, at: number): boolean {
  const before = delegationById(db, id);
  if (!before || before.revoked_at !== null) return false;
  db.prepare('UPDATE delegations SET revoked_at = ? WHERE id = ?').run(at, id);
  return true;
}