/**
 * The storage contract of the Central (A.9 model). One interface, one
 * `node:sqlite` implementation, so a restart never loses a pending page
 * (BIP-N-02, BIP-P-12). Every state write goes through `transaction`.
 */
import type {
  AttentionSample,
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
  /** The rota that must answer this page (BIP-F-37); null for a normal page. */
  rota_id: string | null;
  /** How many times the page already moved to the next on-call. */
  escalation_level: number;
  /** When the page last moved to the next on-call. */
  escalated_at: number | null;
  /** BIP-F-47: the group this page belongs to, declared by the station. */
  group_key: string | null;
  /** BIP-F-47: the leader this page hangs on; null when it IS the leader. */
  group_leader_id: string | null;

  /**
   * When shadow mode resolved this page (BIP-F-42), or null. A page carrying
   * it was never decided by a human: the agent got a simulated verdict, and
   * the audit says so on the wire instead of pretending otherwise.
   */
  shadow_resolved_at: number | null;
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

/** A bounded pre-approval: this station may run matching commands, N times. */
export interface DelegationRow {
  id: string;
  source_id: string;
  pattern: string;
  kind: string;
  remaining: number;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

/** The proof of execution of one page (BIP-F-41). */
export interface ClosureRow {
  page_id: string;
  /** The family-8 page the pager actually shows. */
  closure_page_id: string;
  source_id: string;
  /** The agent's own words: labelled `AGENT SAYS:` on the closing page. */
  summary: string;
  /** The verifiable fact: a commit sha, a PR number, a file list. */
  evidence: string | null;
  /** The fingerprint of the page that was approved: the loop closes on it. */
  origin_fingerprint: string;
  created_at: number;
}

/** An on-call rota (BIP-F-37): who answers, in which order, and how fast it escalates. */
export interface RotaRow {
  id: string;
  label: string;
  escalate_after_ms: number;
  rotation_ms: number | null;
  created_at: number;
}

/** One shift of a rota: the human (alias) and the pager that rings (target). */
export interface OncallShiftRow {
  id: string;
  rota_id: string;
  alias: string;
  target: string;
  priority: number;
  starts_at: number | null;
  ends_at: number | null;
  created_at: number;
}

/** Bounded window over the audit log: filters plus offset pagination. */
export interface EventFilter {
  limit: number;
  type?: AuditEventType | null;
  sourceId?: string | null;
  /** Only the events of one page — the replay reads its own creation event. */
  pageId?: string | null;
  offset?: number;
}

/** One audit event with its append position (BIP-F-45: the position is a fact). */
export interface EventRecord {
  id: number;
  event: AuditEvent;
}

/** How big the log is, and the id of its last event — 0/0 when it is empty. */
export interface EventCount {
  count: number;
  lastId: number;
}

export interface PagePatch {
  state?: PageState;
  delivered_at?: number;
  read_at?: number;
  /**
   * BIP-F-47: re-signing a leader. The fingerprint covers the whole block, so
   * it changes when a member joins — and the line and screens change with it,
   * because the human must sign what they see.
   */
  payload_sha256?: string;
  line?: string;
  detail?: string[];
  reminders_sent?: number;
  escalation_level?: number;
  escalated_at?: number | null;
  group_key?: string | null;
  group_leader_id?: string | null;

  shadow_resolved_at?: number | null;
}

/** `pending` is the union of the three non final states. */
export type PageStateFilter = 'pending' | PageState;

export interface PageFilter {
  state?: PageStateFilter;
  /**
   * BIP-F-47: hide the members of a block. A member never rings — it is the
   * same question, listed on its leader's screens — so showing it in the queue
   * would count one interruption twice and defeat the grouping.
   */
  excludeGroupMembers?: boolean;
  sourceId?: string;
  visitorId?: string | null;
  /** Only the pages addressed to this device (BIP-F-37: a rota page). */
  deviceId?: string;
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
  /**
   * The live leader of a group (BIP-F-47): the first pending page of that group
   * on that station, never a member itself. Null when the page opens a group.
   */
  pendingGroupLeader(sourceId: string, groupKey: string, now: number): PageRow | null;
  /** The members hanging on a leader, oldest first. */
  groupMembers(leaderId: string): PageRow[];
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
  /** Transparency reads (BIP-F-45): the log as an ordered, id-carrying sequence. */
  eventCount(): EventCount;
  eventById(id: number): EventRecord | null;
  eventRange(afterId: number, limit: number): EventRecord[];
  eventIndex(id: number): number | null;

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

  insertDelegation(delegation: DelegationRow): void;
  delegationById(id: string): DelegationRow | null;
  listDelegations(sourceId: string | null): DelegationRow[];
  /** Decrement a live delegation; returns whether it was consumed. */
  consumeDelegation(id: string, now: number): boolean;
  revokeDelegation(id: string, at: number): boolean;

  insertClosure(closure: ClosureRow): boolean;
  closureByPage(pageId: string): ClosureRow | null;
  listClosures(sourceId: string | null, limit: number): ClosureRow[];

  insertRota(rota: RotaRow): void;
  rotaById(id: string): RotaRow | null;
  rotaByLabel(label: string): RotaRow | null;
  listRotas(): RotaRow[];
  deleteRota(id: string): boolean;
  insertShift(shift: OncallShiftRow): void;
  shiftById(id: string): OncallShiftRow | null;
  listShifts(rotaId: string): OncallShiftRow[];
  deleteShift(id: string): boolean;
  /** The devices a page is currently addressed to (empty = visitor scope). */
  addPageTarget(pageId: string, deviceId: string): void;
  clearPageTargets(pageId: string): void;
  pageTargets(pageId: string): string[];

  recentDeliveries(since: number): DeliveryMark[];
  /**
   * The attention bill's raw material (BIP-F-44): one row per page, joined
   * with its decision, oldest first. `sourceId` narrows to one station,
   * `since` to a window; null means "everything".
   */
  attentionSamples(sourceId: string | null, since: number | null): AttentionSample[];
  /** The stations that have pages, so the bill can be broken down per station. */
  stationsWithPages(): Array<{ id: string; alias: string }>;
  metrics(): Metrics;
  close(): void;
}
