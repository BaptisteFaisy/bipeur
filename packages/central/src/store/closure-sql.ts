/**
 * The SQL of the closures table (BIP-F-41), as free functions over the
 * `node:sqlite` handle — the same shape as `page-sql.ts` and `event-sql.ts`,
 * so the store class stays a thin dispatcher.
 *
 * `insertClosure` returns false instead of throwing on a duplicate: one page
 * has one closure, and a retried request must land on the row that already
 * exists, not on an error path.
 */
import type { DatabaseSync } from 'node:sqlite';
import { text, textOrNull, type SqlRow } from './rows.js';
import type { ClosureRow } from './types.js';

export function insertClosure(db: DatabaseSync, closure: ClosureRow): boolean {
  const result = db
    .prepare(
      `INSERT INTO closures (page_id, closure_page_id, source_id, summary, evidence, origin_fingerprint, created_at)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(page_id) DO NOTHING`,
    )
    .run(
      closure.page_id,
      closure.closure_page_id,
      closure.source_id,
      closure.summary,
      closure.evidence,
      closure.origin_fingerprint,
      closure.created_at,
    );
  return Number(result.changes) === 1;
}

export function closureByPage(db: DatabaseSync, pageId: string): ClosureRow | null {
  const row = db.prepare('SELECT * FROM closures WHERE page_id = ?').get(pageId) as SqlRow | undefined;
  return row ? toClosureRow(row) : null;
}

export function listClosures(db: DatabaseSync, sourceId: string | null, limit: number): ClosureRow[] {
  const rows = (
    sourceId
      ? db.prepare('SELECT * FROM closures WHERE source_id = ? ORDER BY created_at DESC LIMIT ?').all(sourceId, limit)
      : db.prepare('SELECT * FROM closures ORDER BY created_at DESC LIMIT ?').all(limit)
  ) as SqlRow[];
  return rows.map(toClosureRow);
}

function toClosureRow(row: SqlRow): ClosureRow {
  return {
    page_id: text(row, 'page_id'),
    closure_page_id: text(row, 'closure_page_id'),
    source_id: text(row, 'source_id'),
    summary: text(row, 'summary'),
    evidence: textOrNull(row, 'evidence'),
    origin_fingerprint: text(row, 'origin_fingerprint'),
    created_at: Number(row['created_at'] ?? 0),
  };
}
