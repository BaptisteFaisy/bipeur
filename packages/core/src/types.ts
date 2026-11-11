/**
 * Domain vocabulary of Beeper (BIP-*).
 * Pure types + constants: no I/O, no Node API, safe in the browser bundle.
 */

export type Risk = 'green' | 'amber' | 'red';

/** Ordered from the least to the most urgent. See BIP-F-04 / BIP-P-09. */
export const RISKS: readonly Risk[] = ['green', 'amber', 'red'] as const;

export function riskRank(risk: Risk): number {
  return RISKS.indexOf(risk);
}

export function maxRisk(a: Risk, b: Risk): Risk {
  return riskRank(a) >= riskRank(b) ? a : b;
}

export function maxRiskOf(risks: readonly Risk[]): Risk {
  return risks.reduce<Risk>((acc, r) => maxRisk(acc, r), 'green');
}

/** Closed list: the VERB field of a page line (A.6). */
export type Verb =
  | 'RUN'
  | 'WRITE'
  | 'DELETE'
  | 'PUSH'
  | 'MERGE'
  | 'DEPLOY'
  | 'CALL'
  | 'SEND'
  | 'PICK'
  | 'SPEND'
  | 'NEED'
  | 'STUCK';

export const VERBS: readonly Verb[] = [
  'RUN',
  'WRITE',
  'DELETE',
  'PUSH',
  'MERGE',
  'DEPLOY',
  'CALL',
  'SEND',
  'PICK',
  'SPEND',
  'NEED',
  'STUCK',
] as const;

export type PageKind = 'tool' | 'question';

/** BIP-F-05 — `queued → delivered → read → decided`, or `expired` / `cancelled`. */
export type PageState =
  | 'queued'
  | 'delivered'
  | 'read'
  | 'decided'
  | 'expired'
  | 'cancelled';

export type Verdict = 'approve' | 'deny' | 'choice';

export type SourceKind =
  | 'kiro-hook'
  | 'mcp'
  | 'crew'
  | 'snpp'
  | 'cli'
  | 'simulator';

/** A pre-seeded multiple-choice reply, exactly like SNPP `MCREsponse`. */
export interface PageOption {
  /** Single letter A-D (SNPP uses 4 digits; the pager shows letters). */
  code: string;
  /** 20 characters or less. */
  label: string;
}

/** Payload of a `tool` page: facts, never the agent's own narrative. */
export interface ToolPayload {
  tool_name: string;
  command?: string;
  path?: string;
  cwd?: string;
  branch?: string;
  stats?: string;
  /** Free text from the agent. Only ever shown on detail screen 4 (A.6). */
  agent_says?: string;
  callback_url?: string;
}

export interface QuestionPayload {
  question: string;
  options?: PageOption[];
  detail?: string;
  agent_says?: string;
  callback_url?: string;
}

export type PagePayload = ToolPayload | QuestionPayload;

export interface PageRecord {
  id: string;
  source_id: string;
  source_alias: string;
  kind: PageKind;
  code: number;
  risk: Risk;
  line: string;
  /** Detail screens 2..4, at most three, 80 characters each. */
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
}

export interface DecisionRecord {
  page_id: string;
  device_id: string;
  verdict: Verdict;
  choice_code: string | null;
  nonce: string;
  signature: string;
  decided_at: number;
  latency_ms: number;
}

export type AuditEventType =
  | 'page.created'
  | 'page.delivered'
  | 'page.read'
  | 'page.decided'
  | 'page.expired'
  | 'page.cancelled'
  | 'page.held'
  | 'decision.rejected'
  | 'beep.requested'
  | 'notice.logged'
  | 'device.paired'
  | 'device.revoked'
  | 'source.registered'
  | 'budget.flushed'
  | 'quiet.suppressed'
  | 'central.started';

export interface AuditEvent {
  ts: number;
  type: AuditEventType;
  page_id?: string | null;
  source_id?: string | null;
  device_id?: string | null;
  /** Only the fingerprint travels in the audit log, never the payload (BIP-N-03). */
  fingerprint?: string | null;
  data?: Record<string, unknown>;
}

export interface SourceRecord {
  id: string;
  alias: string;
  kind: SourceKind;
  token_hash: string;
  last_seen_at: number;
}

export interface DeviceRecord {
  id: string;
  name: string;
  public_key_jwk: JsonWebKey;
  push_subscription: unknown | null;
  paired_at: number;
  revoked_at: number | null;
}

export interface NoticeRecord {
  id: string;
  source_id: string;
  ts: number;
  line: string;
}

/** Metrics of A.3, all derived from the audit log. */
export interface Metrics {
  pages_created: number;
  pages_delivered: number;
  events_seen: number;
  filter_rate: number;
  decision_median_ms: number | null;
  delivery_p95_ms: number | null;
  unblocked_ms: number;
  orphan_approvals: number;
}
