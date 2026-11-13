/** Metrics of A.3, all derived from the log and the tables — never invented. */
import type { DatabaseSync } from 'node:sqlite';
import { median, percentile, type Metrics } from '@bipeur/core';
import { num, type SqlRow } from './rows.js';

function scalar(db: DatabaseSync, sql: string, ...params: (string | number)[]): number {
  const row = db.prepare(sql).get(...params) as SqlRow | undefined;
  return row ? num(row, 'value') : 0;
}

function column(db: DatabaseSync, sql: string): number[] {
  return (db.prepare(sql).all() as SqlRow[]).map((row) => num(row, 'value'));
}

export function computeMetrics(db: DatabaseSync): Metrics {
  const pagesCreated = scalar(db, 'SELECT COUNT(*) AS value FROM pages');
  const pagesDelivered = scalar(
    db,
    'SELECT COUNT(*) AS value FROM pages WHERE delivered_at IS NOT NULL',
  );
  const notices = scalar(db, 'SELECT COUNT(*) AS value FROM notices');
  const held = scalar(db, "SELECT COUNT(*) AS value FROM events WHERE type = 'page.held'");
  const eventsSeen = pagesCreated + notices + held;
  const latencies = column(db, 'SELECT latency_ms AS value FROM decisions');
  const deliveries = column(
    db,
    'SELECT (delivered_at - created_at) AS value FROM pages WHERE delivered_at IS NOT NULL',
  );
  const unblocked = scalar(db, 'SELECT COALESCE(SUM(latency_ms), 0) AS value FROM decisions');
  const orphans = scalar(
    db,
    `SELECT COUNT(*) AS value FROM events
     WHERE type = 'decision.rejected' AND data LIKE '%"reason":"fingerprint_mismatch"%'`,
  );

  return {
    pages_created: pagesCreated,
    pages_delivered: pagesDelivered,
    events_seen: eventsSeen,
    filter_rate: eventsSeen === 0 ? 0 : (eventsSeen - pagesCreated) / eventsSeen,
    decision_median_ms: median(latencies),
    delivery_p95_ms: percentile(deliveries, 95),
    unblocked_ms: unblocked,
    orphan_approvals: orphans,
  };
}
