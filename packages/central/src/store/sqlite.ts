/**
 * `node:sqlite` implementation of the Store. Synchronous by design: one Node
 * process, one file, so a write is a transaction and nothing is interleaved
 * (BIP-P-04 relies on it). No SQL here ever carries a page payload.
 */
import type { AttentionSample, AuditEvent, AuditEventType, Metrics } from '@bipeur/core';
import { openDatabase } from './schema.js';
import { SqliteExtras } from './sqlite-extras.js';
import { computeMetrics } from './metrics.js';
import * as attentionSql from './attention-sql.js';
import * as canarySql from './canary-sql.js';
import * as delegationSql from './delegations.js';
import * as pageSql from './page-sql.js';
import * as rotaSql from './rotas.js';
import {
  num,
  text,
  toDecisionRow,
  toDeviceRow,
  toEvent,
  toJson,
  toNoticeRow,
  toPairingRow,
  toSourceRow,
  type SqlRow,
} from './rows.js';
import type {
  DelegationRow,
  DeviceRow,
  DecisionRow,
  DeliveryMark,
  EventFilter,
  NoticeRow,
  OncallShiftRow,
  PageFilter,
  PagePatch,
  PageRow,
  PairingRow,
  RotaRow,
  SourceActivity,
  SourceRow,
  Store,
  VisitorRow,
} from './types.js';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

type SqlParam = string | number | null;

export class SqliteStore extends SqliteExtras implements Store {
  readonly path: string;

  constructor(path: string) {
    super(openDatabase(path));
    this.path = path;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* the transaction is already gone */
      }
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  // --- sources ------------------------------------------------------------

  insertSource(source: SourceRow): void {
    this.db
      .prepare(
        'INSERT INTO sources (id, alias, kind, token_hash, last_seen_at, visitor_id, revoked_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        source.id,
        source.alias,
        source.kind,
        source.token_hash,
        source.last_seen_at,
        source.visitor_id,
        source.revoked_at,
      );
  }

  sourceById(id: string): SourceRow | null {
    return this.one('SELECT * FROM sources WHERE id = ?', id, toSourceRow);
  }

  sourceByTokenHash(tokenHash: string): SourceRow | null {
    return this.one('SELECT * FROM sources WHERE token_hash = ?', tokenHash, toSourceRow);
  }

  touchSource(id: string, at: number): void {
    this.db.prepare('UPDATE sources SET last_seen_at = ? WHERE id = ?').run(at, id);
  }

  listSources(): SourceRow[] {
    const rows = this.db.prepare('SELECT * FROM sources ORDER BY last_seen_at DESC').all() as SqlRow[];
    return rows.map(toSourceRow);
  }

  revokeSource(id: string, at: number): boolean {
    const result = this.db
      .prepare('UPDATE sources SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(at, id);
    return Number(result.changes) > 0;
  }

  pageCountBySource(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT source_id, COUNT(*) AS value FROM pages GROUP BY source_id')
      .all() as SqlRow[];
    const counts: Record<string, number> = {};
    for (const row of rows) counts[text(row, 'source_id')] = num(row, 'value');
    return counts;
  }

  sourceActivity(sourceId: string, now: number): SourceActivity {
    return delegationSql.sourceActivity(this.db, sourceId, now);
  }

  // --- devices ------------------------------------------------------------

  insertDevice(device: DeviceRow): void {
    this.db
      .prepare(
        `INSERT INTO devices (id, name, token_hash, public_key_jwk, push_subscription, paired_at, revoked_at, visitor_id)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        device.id,
        device.name,
        device.token_hash,
        JSON.stringify(device.public_key_jwk),
        toJson(device.push_subscription),
        device.paired_at,
        device.revoked_at,
        device.visitor_id,
      );
  }

  deviceById(id: string): DeviceRow | null {
    return this.one('SELECT * FROM devices WHERE id = ?', id, toDeviceRow);
  }

  deviceByTokenHash(tokenHash: string): DeviceRow | null {
    return this.one('SELECT * FROM devices WHERE token_hash = ?', tokenHash, toDeviceRow);
  }

  listDevices(): DeviceRow[] {
    return this.db.prepare('SELECT * FROM devices ORDER BY paired_at DESC').all().map((row) => toDeviceRow(row as SqlRow));
  }

  revokeDevice(id: string, at: number): boolean {
    const result = this.db
      .prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(at, id);
    return Number(result.changes) > 0;
  }

  // --- pages --------------------------------------------------------------

  insertPage(page: PageRow): void {
    pageSql.insertPage(this.db, page);
  }

  pageById(id: string): PageRow | null {
    return pageSql.pageById(this.db, id);
  }

  pendingPageByDedupe(sourceId: string, dedupeKey: string, now: number): PageRow | null {
    return pageSql.pendingPageByDedupe(this.db, sourceId, dedupeKey, now);
  }

  pendingGroupLeader(sourceId: string, groupKey: string, now: number): PageRow | null {
    return pageSql.pendingGroupLeader(this.db, sourceId, groupKey, now);
  }

  groupMembers(leaderId: string): PageRow[] {
    return pageSql.groupMembers(this.db, leaderId);
  }

  listPages(filter: PageFilter): PageRow[] {
    return pageSql.listPages(this.db, filter);
  }

  updatePage(id: string, patch: PagePatch): void {
    pageSql.updatePage(this.db, id, patch);
  }

  // --- decisions ----------------------------------------------------------

  insertDecision(decision: DecisionRow): boolean {
    try {
      this.db
        .prepare(
          `INSERT INTO decisions (page_id, device_id, verdict, choice_code, nonce, signature, decided_at, latency_ms)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          decision.page_id,
          decision.device_id,
          decision.verdict,
          decision.choice_code,
          decision.nonce,
          decision.signature,
          decision.decided_at,
          decision.latency_ms,
        );
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  decisionByPage(pageId: string): DecisionRow | null {
    return this.one('SELECT * FROM decisions WHERE page_id = ?', pageId, toDecisionRow);
  }

  hasNonce(nonce: string): boolean {
    return this.db.prepare('SELECT 1 FROM nonces WHERE nonce = ?').get(nonce) !== undefined;
  }

  recordNonce(nonce: string, deviceId: string, at: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO nonces (nonce, device_id, seen_at) VALUES (?,?,?)')
      .run(nonce, deviceId, at);
  }

  // --- audit log (append-only) -------------------------------------------

  appendEvent(event: AuditEvent): number {
    const result = this.db
      .prepare(
        'INSERT INTO events (ts, type, page_id, source_id, device_id, fingerprint, data) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        event.ts,
        event.type,
        event.page_id ?? null,
        event.source_id ?? null,
        event.device_id ?? null,
        event.fingerprint ?? null,
        toJson(event.data),
      );
    return Number(result.lastInsertRowid);
  }

  listEvents(options: EventFilter): AuditEvent[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.type) {
      clauses.push('type = ?');
      params.push(options.type);
    }
    if (options.sourceId) {
      clauses.push('source_id = ?');
      params.push(options.sourceId);
    }
    if (options.pageId) {
      clauses.push('page_id = ?');
      params.push(options.pageId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = Math.max(0, options.offset ?? 0);
    const rows = this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, options.limit, offset) as SqlRow[];
    return rows.map(toEvent);
  }

  countEvents(type: AuditEventType): number {
    const row = this.db.prepare('SELECT COUNT(*) AS value FROM events WHERE type = ?').get(type) as SqlRow;
    return Number(row['value'] ?? 0);
  }

  purgeEventsBefore(cutoff: number): number {
    const result = this.db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
    return Number(result.changes);
  }

  // --- notices (journal de bord) -----------------------------------------

  insertNotice(notice: NoticeRow): void {
    this.db
      .prepare('INSERT INTO notices (id, source_id, source_alias, ts, line, visitor_id) VALUES (?,?,?,?,?,?)')
      .run(notice.id, notice.source_id, notice.source_alias, notice.ts, notice.line, notice.visitor_id);
  }

  listNotices(limit: number): NoticeRow[] {
    return this.db
      .prepare('SELECT * FROM notices ORDER BY ts DESC LIMIT ?')
      .all(limit)
      .map((row) => toNoticeRow(row as SqlRow));
  }

  // --- pairings -----------------------------------------------------------

  insertPairing(pairing: PairingRow): void {
    this.db
      .prepare('INSERT INTO pairings (id, code, created_at, expires_at, consumed_at, visitor_id) VALUES (?,?,?,?,?,?)')
      .run(pairing.id, pairing.code, pairing.created_at, pairing.expires_at, pairing.consumed_at, pairing.visitor_id);
  }

  pairingById(id: string): PairingRow | null {
    return this.one('SELECT * FROM pairings WHERE id = ?', id, toPairingRow);
  }

  /** Most recent pairing still usable for this code: unconsumed, unexpired. */
  pairingByCode(code: string, now: number): PairingRow | null {
    return this.one(
      'SELECT * FROM pairings WHERE code = ? AND consumed_at IS NULL AND expires_at > ? ' +
        'ORDER BY created_at DESC LIMIT 1',
      [code, now],
      toPairingRow,
    );
  }

  consumePairing(id: string, at: number): boolean {
    const result = this.db
      .prepare('UPDATE pairings SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
      .run(at, id);
    return Number(result.changes) > 0;
  }

  // --- demo visitors ------------------------------------------------------

  insertVisitor(visitor: VisitorRow): void {
    this.db.prepare('INSERT INTO visitors (id, created_at) VALUES (?,?)').run(visitor.id, visitor.created_at);
  }

  /** Wipes every demo space older than the cutoff (BIP-F-31, 24 h). */
  purgeVisitorsBefore(cutoff: number): number {
    const expired = this.db
      .prepare('SELECT id FROM visitors WHERE created_at < ?')
      .all(cutoff) as SqlRow[];
    if (expired.length === 0) return 0;
    for (const row of expired) this.purgeVisitor(String(row['id']));
    return expired.length;
  }

  private purgeVisitor(visitorId: string): void {
    this.transaction(() => {
      this.db
        .prepare('DELETE FROM decisions WHERE page_id IN (SELECT id FROM pages WHERE visitor_id = ?)')
        .run(visitorId);
      this.db.prepare('DELETE FROM pages WHERE visitor_id = ?').run(visitorId);
      this.db.prepare('DELETE FROM notices WHERE visitor_id = ?').run(visitorId);
      this.db.prepare('DELETE FROM devices WHERE visitor_id = ?').run(visitorId);
      this.db.prepare('DELETE FROM pairings WHERE visitor_id = ?').run(visitorId);
      this.db
        .prepare('DELETE FROM events WHERE source_id IN (SELECT id FROM sources WHERE visitor_id = ?)')
        .run(visitorId);
      this.db.prepare('DELETE FROM sources WHERE visitor_id = ?').run(visitorId);
      this.db.prepare('DELETE FROM visitors WHERE id = ?').run(visitorId);
    });
  }

  // --- delegations --------------------------------------------------------

  insertDelegation(delegation: DelegationRow): void {
    delegationSql.insertDelegation(this.db, delegation);
  }

  delegationById(id: string): DelegationRow | null {
    return delegationSql.delegationById(this.db, id);
  }

  listDelegations(sourceId: string | null): DelegationRow[] {
    return delegationSql.listDelegations(this.db, sourceId);
  }

  consumeDelegation(id: string, now: number): boolean {
    return delegationSql.consumeDelegation(this.db, id, now);
  }

  revokeDelegation(id: string, at: number): boolean {
    return delegationSql.revokeDelegation(this.db, id, at);
  }

  // --- rotas (BIP-F-37) ----------------------------------------------------

  insertRota(rota: RotaRow): void {
    rotaSql.insertRota(this.db, rota);
  }

  rotaById(id: string): RotaRow | null {
    return rotaSql.rotaById(this.db, id);
  }

  rotaByLabel(label: string): RotaRow | null {
    return rotaSql.rotaByLabel(this.db, label);
  }

  listRotas(): RotaRow[] {
    return rotaSql.listRotas(this.db);
  }

  deleteRota(id: string): boolean {
    const before = rotaSql.rotaById(this.db, id);
    if (!before) return false;
    rotaSql.deleteRota(this.db, id);
    return true;
  }

  insertShift(shift: OncallShiftRow): void {
    rotaSql.insertShift(this.db, shift);
  }

  shiftById(id: string): OncallShiftRow | null {
    return rotaSql.shiftById(this.db, id);
  }

  listShifts(rotaId: string): OncallShiftRow[] {
    return rotaSql.listShifts(this.db, rotaId);
  }

  deleteShift(id: string): boolean {
    return rotaSql.deleteShift(this.db, id);
  }

  addPageTarget(pageId: string, deviceId: string): void {
    rotaSql.addPageTarget(this.db, pageId, deviceId);
  }

  clearPageTargets(pageId: string): void {
    rotaSql.clearPageTargets(this.db, pageId);
  }

  pageTargets(pageId: string): string[] {
    return rotaSql.pageTargets(this.db, pageId);
  }

  // --- dashboard ----------------------------------------------------------

  decisionLatencies(deviceId: string): number[] {
    return canarySql.decisionLatencies(this.db, deviceId);
  }

  recentDeliveries(since: number): DeliveryMark[] {
    const rows = this.db
      .prepare(
        'SELECT delivered_at AS at, risk, code, visitor_id FROM pages WHERE delivered_at IS NOT NULL AND delivered_at > ?',
      )
      .all(since) as SqlRow[];
    return rows.map((row) => ({
      at: Number(row['at'] ?? 0),
      risk: String(row['risk'] ?? 'green') as DeliveryMark['risk'],
      code: Number(row['code'] ?? 0),
      visitor_id: row['visitor_id'] === null || row['visitor_id'] === undefined ? null : String(row['visitor_id']),
    }));
  }

  attentionSamples(sourceId: string | null, since: number | null): AttentionSample[] {
    return attentionSql.attentionSamples(this.db, sourceId, since);
  }

  stationsWithPages(): Array<{ id: string; alias: string }> {
    return attentionSql.stationsWithPages(this.db);
  }

  metrics(): Metrics {
    return computeMetrics(this.db);
  }

  // --- helpers ------------------------------------------------------------

  private one<T>(sql: string, params: SqlParam | SqlParam[], map: (row: SqlRow) => T): T | null {
    const bound = Array.isArray(params) ? params : [params];
    const row = this.db.prepare(sql).get(...bound) as SqlRow | undefined;
    return row ? map(row) : null;
  }
}
