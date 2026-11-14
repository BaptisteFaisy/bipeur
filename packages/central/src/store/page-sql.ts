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
    `INSERT INTO pages (id, source_id, source_alias, kind, code, risk, line, detail, payload,
       payload_sha256, options, state, created_at, delivered_at, read_at, expires_at, dedupe_key,
       callback_url, reminders_sent, visitor_id, rota_id, escalation_level, escalated_at,
       group_key, group_leader_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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

export function updatePage(db: DatabaseSync, id: string, patch: PagePatch): void {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.state !== undefined) {
    sets.push('state = ?');
    params.push(patch.state);
  }
  if (patch.delivered_at !== undefined) {
    sets.push('delivered_at = ?');
    params.push(patch.delivered_at);
  }
  if (patch.read_at !== undefined) {
    sets.push('read_at = ?');
    params.push(patch.read_at);
  }
  if (patch.payload_sha256 !== undefined) {
    sets.push('payload_sha256 = ?');
    params.push(patch.payload_sha256);
  }
  if (patch.line !== undefined) {
    sets.push('line = ?');
    params.push(patch.line);
  }
  if (patch.detail !== undefined) {
    sets.push('detail = ?');
    params.push(JSON.stringify(patch.detail));
  }
  if (patch.reminders_sent !== undefined) {
    sets.push('reminders_sent = ?');
    params.push(patch.reminders_sent);
  }
  if (patch.escalation_level !== undefined) {
    sets.push('escalation_level = ?');
    params.push(patch.escalation_level);
  }
  if (patch.escalated_at !== undefined) {
    sets.push('escalated_at = ?');
    params.push(patch.escalated_at);
  }
  if (patch.group_key !== undefined) {
    sets.push('group_key = ?');
    params.push(patch.group_key);
  }
  if (patch.group_leader_id !== undefined) {
    sets.push('group_leader_id = ?');
    params.push(patch.group_leader_id);
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}

/**
 * The live leader of a group (BIP-F-47): the OLDEST pending page of that group
 * on that station, and never a member itself. A member is not a leader — it
 * rings through the page that carries the list.
 */
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
