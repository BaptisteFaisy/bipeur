/**
 * The samples the attention bill is computed from (BIP-F-44).
 *
 * One row per page, joined with its decision when there is one: the page table
 * holds the timestamps of the wait (created, delivered, read) and the decision
 * table holds the time a human actually spent. Neither alone is the bill — a
 * page nobody read costs the interruption and nothing else.
 *
 * Read-only, and never a payload: the timestamps and the verdict are facts
 * about attention, not about the command (BIP-N-03).
 */
import type { DatabaseSync } from 'node:sqlite';
import type { AttentionSample } from '@bipeur/core';
import type { Verdict } from '@bipeur/core';
import { numOrNull, type SqlRow } from './rows.js';

const SAMPLE_SQL = `
  SELECT p.source_id    AS source_id,
         p.created_at  AS created_at,
         p.delivered_at AS delivered_at,
         p.read_at      AS read_at,
         d.decided_at   AS decided_at,
         d.latency_ms   AS latency_ms,
         d.verdict      AS verdict
    FROM pages p
    LEFT JOIN decisions d ON d.page_id = p.id
`;

/** Rows of the log as samples, newest last; `sourceId` narrows to one station. */
export function attentionSamples(
  db: DatabaseSync,
  sourceId: string | null,
  since: number | null,
): AttentionSample[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (sourceId !== null) {
    where.push('p.source_id = ?');
    params.push(sourceId);
  }
  if (since !== null) {
    where.push('p.created_at >= ?');
    params.push(since);
  }
  const sql = `${SAMPLE_SQL}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at ASC`;
  return (db.prepare(sql).all(...params) as SqlRow[]).map(toSample);
}

function toSample(row: SqlRow): AttentionSample {
  return {
    source_id: String(row['source_id'] ?? ''),
    created_at: numOrNull(row, 'created_at') ?? 0,
    delivered_at: numOrNull(row, 'delivered_at'),
    read_at: numOrNull(row, 'read_at'),
    decided_at: numOrNull(row, 'decided_at'),
    latency_ms: numOrNull(row, 'latency_ms'),
    verdict: (row['verdict'] as Verdict | null | undefined) ?? null,
  };
}

/** Which stations have pages, so the bill can be broken down per station. */
export function stationsWithPages(db: DatabaseSync): Array<{ id: string; alias: string }> {
  const rows = db
    .prepare('SELECT DISTINCT s.id AS id, s.alias AS alias FROM pages p JOIN sources s ON s.id = p.source_id ORDER BY s.alias')
    .all() as SqlRow[];
  return rows.map((row) => ({ id: String(row['id'] ?? ''), alias: String(row['alias'] ?? '') }));
}
