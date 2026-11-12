/**
 * The storage contract of the Central (A.9 model). One interface, one
 * `node:sqlite` implementation, so a restart never loses a pending page
 * (BIP-N-02, BIP-P-12). Every state write goes through `transaction`.
 */
import type {
  AuditEvent,
  AuditEventType,
  Metrics,
  PageKind,
  PageOption,
  PagePayload,
  PageState,
  Risk,
  SourceKind,
  Verdict,
} from '@bipeur/core';

export interface SourceRow {
  id: string;
  alias: string;
  kind: SourceKind;
  token_hash: string;
  last_seen_at: number;
  visitor_id: string | null;
  revoked_at: number | null;
}

/** Counts of one station, derived from the pages and the decisions. */
export interface SourceActivity {
  created: number;
  delivered: number;
  approved: number;
  denied: number;
  cancelled: number;
  createdLastHour: number;
}

export interface DeviceRow {
  id: string;
  name: string;
  token_hash: string;
  public_key_jwk: JsonWebKey;
  push_subscription: unknown | null;
  paired_at: number;
  revoked_at: number | null;
  visitor_id: string | null;
}

export interface PageRow {
  id: string;
  source_id: string;
  source_alias: string;
  kind: PageKind;
  code: number;
  risk: Risk;
  line: string;
  detail: string[];
  payload: PagePayload;
  payload_sha256: string;
  options: PageOption[];
  state: PageState;
  created_at: number;
  delivered_at: number | null;
  read_at: number | null;
  expires_at: number;
  dedupe_key: string;
  callback_url: string | null;
  reminders_sent: number;
  visitor_id: string | null;
}

export interface DecisionRow {
  page_id: string;
  device_id: string;
  verdict: Verdict;
  choice_code: string | null;
  nonce: string;
  signature: string;
  decided_at: number;
  latency_ms: number;
}

export interface NoticeRow {
  id: string;
  source_id: string;
  source_alias: string;
  ts: number;
  line: string;
  visitor_id: string | null;
}

export interface PairingRow {
  id: string;
  code: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  visitor_id: string | null;
}

export interface VisitorRow {
  id: string;
  created_at: number;
}

/** Bounded window over the audit log: filters plus offset pagination. */
export interface EventFilter {
  limit: number;
  type?: AuditEventType | null;
  sourceId?: string | null;
  offset?: number;
}

export interface PagePatch {
  state?: PageState;
  delivered_at?: number;
  read_at?: number;
  reminders_sent?: number;
}

/** `pending` is the union of the three non final states. */
export type PageStateFilter = 'pending' | PageState;

export interface PageFilter {
  state?: PageStateFilter;
  sourceId?: string;
  visitorId?: string | null;
  limit?: number;
}

export interface DeliveryMark {
  at: number;
  risk: Risk;
  code: number;
  /** Null for the real operator's pages; a `vis_…` id for demo spaces. */
  visitor_id: string | null;
}

export interface Store {
  readonly path: string;
  /** Runs `fn` inside a write transaction; rolls back on any throw. */
  transaction<T>(fn: () => T): T;

  insertSource(source: SourceRow): void;
  sourceById(id: string): SourceRow | null;
  sourceByTokenHash(tokenHash: string): SourceRow | null;
  touchSource(id: string, at: number): void;
  listSources(): SourceRow[];
  revokeSource(id: string, at: number): boolean;
  /** Page counts per station, for the dashboard (BIP-F-30). */
  pageCountBySource(): Record<string, number>;
  /** Activity of one station, for reputation and chattiness. */
  sourceActivity(sourceId: string, now: number): SourceActivity;

  insertDevice(device: DeviceRow): void;
  deviceById(id: string): DeviceRow | null;
  deviceByTokenHash(tokenHash: string): DeviceRow | null;
  listDevices(): DeviceRow[];
  revokeDevice(id: string, at: number): boolean;

  insertPage(page: PageRow): void;
  pageById(id: string): PageRow | null;
  pendingPageByDedupe(sourceId: string, dedupeKey: string, now: number): PageRow | null;
  listPages(filter: PageFilter): PageRow[];
  updatePage(id: string, patch: PagePatch): void;

  insertDecision(decision: DecisionRow): boolean;
  decisionByPage(pageId: string): DecisionRow | null;
  hasNonce(nonce: string): boolean;
  recordNonce(nonce: string, deviceId: string, at: number): void;

  appendEvent(event: AuditEvent): number;
  listEvents(options: EventFilter): AuditEvent[];
  countEvents(type: AuditEventType): number;
  purgeEventsBefore(cutoff: number): number;

  insertNotice(notice: NoticeRow): void;
  listNotices(limit: number): NoticeRow[];

  insertPairing(pairing: PairingRow): void;
  pairingById(id: string): PairingRow | null;
  /**
   * The live pairing for a six-character code, if any. A pager opened by hand
   * (a typed code, no QR link) knows the code but not the pairing id.
   */
  pairingByCode(code: string, now: number): PairingRow | null;
  consumePairing(id: string, at: number): boolean;

  insertVisitor(visitor: VisitorRow): void;
  purgeVisitorsBefore(cutoff: number): number;

  recentDeliveries(since: number): DeliveryMark[];
  metrics(): Metrics;
  close(): void;
}
