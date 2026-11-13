/**
 * The SQL of the rota tables (BIP-F-37), kept out of `sqlite.ts` like
 * `delegations.ts`: one free function per operation, no shared mutable state.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { OncallShiftRow, RotaRow } from './types.js';
import { toOncallShiftRow, toRotaRow, type SqlRow } from './rows.js';

export function insertRota(db: DatabaseSync, rota: RotaRow): void {
  db.prepare(
    'INSERT INTO rotas (id, label, escalate_after_ms, rotation_ms, created_at) VALUES (?,?,?,?,?)',
  ).run(rota.id, rota.label, rota.escalate_after_ms, rota.rotation_ms, rota.created_at);
}

export function rotaById(db: DatabaseSync, id: string): RotaRow | null {
  const row = db.prepare('SELECT * FROM rotas WHERE id = ?').get(id) as SqlRow | undefined;
  return row ? toRotaRow(row) : null;
}

export function rotaByLabel(db: DatabaseSync, label: string): RotaRow | null {
  const row = db.prepare('SELECT * FROM rotas WHERE label = ?').get(label) as SqlRow | undefined;
  return row ? toRotaRow(row) : null;
}

export function listRotas(db: DatabaseSync): RotaRow[] {
  return (db.prepare('SELECT * FROM rotas ORDER BY label ASC').all() as SqlRow[]).map(toRotaRow);
}

export function deleteRota(db: DatabaseSync, id: string): boolean {
  const result = db.prepare('DELETE FROM rotas WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export function insertShift(db: DatabaseSync, shift: OncallShiftRow): void {
  db.prepare(
    'INSERT INTO oncall_shifts (id, rota_id, alias, target, priority, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    shift.id,
    shift.rota_id,
    shift.alias,
    shift.target,
    shift.priority,
    shift.starts_at,
    shift.ends_at,
    shift.created_at,
  );
}

export function shiftById(db: DatabaseSync, id: string): OncallShiftRow | null {
  const row = db.prepare('SELECT * FROM oncall_shifts WHERE id = ?').get(id) as SqlRow | undefined;
  return row ? toOncallShiftRow(row) : null;
}

export function listShifts(db: DatabaseSync, rotaId: string): OncallShiftRow[] {
  return (
    db
      .prepare('SELECT * FROM oncall_shifts WHERE rota_id = ? ORDER BY priority ASC, created_at ASC')
      .all(rotaId) as SqlRow[]
  ).map(toOncallShiftRow);
}

export function deleteShift(db: DatabaseSync, id: string): boolean {
  const result = db.prepare('DELETE FROM oncall_shifts WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export function addPageTarget(db: DatabaseSync, pageId: string, deviceId: string): void {
  db.prepare('INSERT OR IGNORE INTO page_targets (page_id, device_id) VALUES (?,?)').run(pageId, deviceId);
}

export function clearPageTargets(db: DatabaseSync, pageId: string): void {
  db.prepare('DELETE FROM page_targets WHERE page_id = ?').run(pageId);
}

export function pageTargets(db: DatabaseSync, pageId: string): string[] {
  const rows = db.prepare('SELECT device_id FROM page_targets WHERE page_id = ?').all(pageId) as SqlRow[];
  return rows.map((row) => String(row['device_id'] ?? ''));
}