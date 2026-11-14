/**
 * The SQL of the pages table, as free functions over a `node:sqlite` handle.
 * Kept out of `sqlite.ts` so the store class stays readable, and so the
 * targeting rule (BIP-F-37) lives in one place: a page addressed to a device
 * belongs to that device only; a page with no target belongs to its visitor
 * scope, as before.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { PageFilter, PagePatch, PageRow } from './types.js';
import { toPageRow, type SqlRow } from './rows.js';

const PENDING_STATES = "('queued','delivered','read')";

/** The visitor scope of a filter, or null when the filter does not restrict it. */
function visitorClause(filter: PageFilter): { sql: string; params: (string | number)[] } | null {
  if (filter.visitorId === null) return { sql: 'visitor_id IS NULL', params: [] };
  if (filter.visitorId) return { sql: 'visitor_id = ?', params: [filter.visitorId] };
  return null;
}

export function pageWhere(filter: PageFilter): { clause: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.excludeGroupMembers) clauses.push('group_leader_id IS NULL');
  if (filter.state === 'pending') clauses.push(`state IN ${PENDING_STATES}`);
  else if (filter.state) {
    clauses.push('state = ?');
    params.push(filter.state);
  }
  if (filter.sourceId) {
    clauses.push('source_id = ?');
    params.push(filter.sourceId);
  }
  const visitor = visitorClause(filter);
  if (filter.deviceId) {
    // Addressed to this device, or not addressed at all and in its scope.
    const targeted = 'id IN (SELECT page_id FROM page_targets WHERE device_id = ?)';
    const untargeted = visitor
      ? `(${visitor.sql} AND id NOT IN (SELECT page_id FROM page_targets))`
      : 'id NOT IN (SELECT page_id FROM page_targets)';
    clauses.push(`(${targeted} OR ${untargeted})`);
    params.push(filter.deviceId);
    if (visitor) params.push(...visitor.params);
  } else if (visitor) {
    clauses.push(visitor.sql);
    params.push(...visitor.params);
  }
  return { clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function insertPage(db: DatabaseSync, page: PageRow): void {
  db.prepare(
    `INSERT INTO pages (id, source_id, source_alias, kind, code, risk, line, detail, payload, payload_sha256, options, state, created_at, delivered_at, read_at, expires_at, dedupe_key, callback_url, reminders_sent, visitor_id, rota_id, escalation_level, escalated_at, group_key, group_leader_id, shadow_resolved_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    page.id,
    page.source_id,
    page.source_alias,
    page.kind,
    page.code,
    page.risk,
    page.line,
    JSON.stringify(page.detail),
    JSON.stringify(page.payload),
    page.payload_sha256,
    JSON.stringify(page.options),
    page.state,
    page.created_at,
    page.delivered_at,
    page.read_at,
    page.expires_at,
    page.dedupe_key,
    page.callback_url,
    page.reminders_sent,
    page.visitor_id,
    page.rota_id,
    page.escalation_level,
    page.escalated_at,
    page.group_key,
    page.group_leader_id,
    page.shadow_resolved_at,
  );
}


export function pageById(db: DatabaseSync, id: string): PageRow | null {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as SqlRow | undefined;
  return row ? toPageRow(row) : null;
}

export function pendingPageByDedupe(
  db: DatabaseSync,
  sourceId: string,
  dedupeKey: string,
  now: number,
): PageRow | null {
  const row = db
    .prepare(
      `SELECT * FROM pages WHERE source_id = ? AND dedupe_key = ?
         AND state IN ${PENDING_STATES} AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(sourceId, dedupeKey, now) as SqlRow | undefined;
  return row ? toPageRow(row) : null;
}

export function listPages(db: DatabaseSync, filter: PageFilter): PageRow[] {
  const { clause, params } = pageWhere(filter);
  const limit = filter.limit ?? 50;
  const rows = db
    .prepare(`SELECT * FROM pages ${clause} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as SqlRow[];
  return rows.map(toPageRow);
}

/**
 * The columns a page patch may move, in one table: the column name and how to
 * read it off the patch. Eleven `if (patch.x !== undefined)` blocks were the
 * same function eleven times — the rule is no duplication, so the honest answer
 * is a table.
 */
interface PatchColumn {
  column: string;
  read: (patch: PagePatch) => string | number | null | undefined;
}

const PATCH_COLUMNS: readonly PatchColumn[] = [
  { column: 'state', read: (p) => p.state },
  { column: 'delivered_at', read: (p) => p.delivered_at },
  { column: 'read_at', read: (p) => p.read_at },
  { column: 'payload_sha256', read: (p) => p.payload_sha256 },
  { column: 'line', read: (p) => p.line },
  { column: 'detail', read: (p) => (p.detail === undefined ? undefined : JSON.stringify(p.detail)) },
  { column: 'reminders_sent', read: (p) => p.reminders_sent },
  { column: 'escalation_level', read: (p) => p.escalation_level },
  { column: 'escalated_at', read: (p) => p.escalated_at },
  { column: 'group_key', read: (p) => p.group_key },
  { column: 'group_leader_id', read: (p) => p.group_leader_id },
  { column: 'shadow_resolved_at', read: (p) => p.shadow_resolved_at },
];

export function updatePage(db: DatabaseSync, id: string, patch: PagePatch): void {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  for (const { column, read } of PATCH_COLUMNS) {
    const value = read(patch);
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}


export function pendingGroupLeader(
  db: DatabaseSync,
  sourceId: string,
  groupKey: string,
  now: number,
): PageRow | null {
  const row = db
    .prepare(
      `SELECT * FROM pages WHERE source_id = ? AND group_key = ?
         AND group_leader_id IS NULL AND state IN ${PENDING_STATES} AND expires_at > ?
       ORDER BY created_at ASC LIMIT 1`,
    )
    .get(sourceId, groupKey, now) as SqlRow | undefined;
  return row ? toPageRow(row) : null;
}

/** The members hanging on a leader, oldest first: the order the list is read. */
export function groupMembers(db: DatabaseSync, leaderId: string): PageRow[] {
  const rows = db
    .prepare(`SELECT * FROM pages WHERE group_leader_id = ? ORDER BY created_at ASC`)
    .all(leaderId) as SqlRow[];
  return rows.map(toPageRow);
}
