/** Row <-> record mapping. SQLite gives us untyped values; we coerce once, here. */
import type {
  AuditEvent,
  AuditEventType,
  PageKind,
  PageOption,
  PagePayload,
  PageState,
  Risk,
  SourceKind,
  Verdict,
} from '@bipeur/core';
import type {
  DecisionRow,
  DeviceRow,
  NoticeRow,
  PageRow,
  PairingRow,
  SourceRow,
  VisitorRow,
} from './types.js';

export type SqlRow = Record<string, unknown>;

export function text(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

export function textOrNull(row: SqlRow, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

export function num(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

export function numOrNull(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return num(row, key);
}

export function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export function toSourceRow(row: SqlRow): SourceRow {
  return {
    id: text(row, 'id'),
    alias: text(row, 'alias'),
    kind: text(row, 'kind') as SourceKind,
    token_hash: text(row, 'token_hash'),
    last_seen_at: num(row, 'last_seen_at'),
    visitor_id: textOrNull(row, 'visitor_id'),
    revoked_at: numOrNull(row, 'revoked_at'),
  };
}

export function toDeviceRow(row: SqlRow): DeviceRow {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    token_hash: text(row, 'token_hash'),
    public_key_jwk: parseJson<JsonWebKey>(text(row, 'public_key_jwk'), {}),
    push_subscription: parseJson<unknown>(textOrNull(row, 'push_subscription'), null),
    paired_at: num(row, 'paired_at'),
    revoked_at: numOrNull(row, 'revoked_at'),
    visitor_id: textOrNull(row, 'visitor_id'),
  };
}

export function toPageRow(row: SqlRow): PageRow {
  return {
    id: text(row, 'id'),
    source_id: text(row, 'source_id'),
    source_alias: text(row, 'source_alias'),
    kind: text(row, 'kind') as PageKind,
    code: num(row, 'code'),
    risk: text(row, 'risk') as Risk,
    line: text(row, 'line'),
    detail: parseJson<string[]>(text(row, 'detail'), []),
    payload: parseJson<PagePayload>(text(row, 'payload'), {} as PagePayload),
    payload_sha256: text(row, 'payload_sha256'),
    options: parseJson<PageOption[]>(text(row, 'options'), []),
    state: text(row, 'state') as PageState,
    created_at: num(row, 'created_at'),
    delivered_at: numOrNull(row, 'delivered_at'),
    read_at: numOrNull(row, 'read_at'),
    expires_at: num(row, 'expires_at'),
    dedupe_key: text(row, 'dedupe_key'),
    callback_url: textOrNull(row, 'callback_url'),
    reminders_sent: num(row, 'reminders_sent'),
    visitor_id: textOrNull(row, 'visitor_id'),
  };
}

export function toDecisionRow(row: SqlRow): DecisionRow {
  return {
    page_id: text(row, 'page_id'),
    device_id: text(row, 'device_id'),
    verdict: text(row, 'verdict') as Verdict,
    choice_code: textOrNull(row, 'choice_code'),
    nonce: text(row, 'nonce'),
    signature: text(row, 'signature'),
    decided_at: num(row, 'decided_at'),
    latency_ms: num(row, 'latency_ms'),
  };
}

export function toEvent(row: SqlRow): AuditEvent {
  return {
    ts: num(row, 'ts'),
    type: text(row, 'type') as AuditEventType,
    page_id: textOrNull(row, 'page_id'),
    source_id: textOrNull(row, 'source_id'),
    device_id: textOrNull(row, 'device_id'),
    fingerprint: textOrNull(row, 'fingerprint'),
    data: parseJson<Record<string, unknown> | undefined>(textOrNull(row, 'data'), undefined),
  };
}

export function toNoticeRow(row: SqlRow): NoticeRow {
  return {
    id: text(row, 'id'),
    source_id: text(row, 'source_id'),
    source_alias: text(row, 'source_alias'),
    ts: num(row, 'ts'),
    line: text(row, 'line'),
    visitor_id: textOrNull(row, 'visitor_id'),
  };
}

export function toPairingRow(row: SqlRow): PairingRow {
  return {
    id: text(row, 'id'),
    code: text(row, 'code'),
    created_at: num(row, 'created_at'),
    expires_at: num(row, 'expires_at'),
    consumed_at: numOrNull(row, 'consumed_at'),
    visitor_id: textOrNull(row, 'visitor_id'),
  };
}

export function toVisitorRow(row: SqlRow): VisitorRow {
  return { id: text(row, 'id'), created_at: num(row, 'created_at') };
}
