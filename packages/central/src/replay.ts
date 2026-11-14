/**
 * Post-mortem replay (BIP-F-46).
 *
 * A journal keeps facts; it does not keep the gesture. After a dispute, "what
 * did the human see at 14:32?" must have one exact answer. The answer is not a
 * recomposition: rules evolve, translations evolve, and the payload may be
 * gone after retention. The page row already stores the line and detail screens
 * at creation, so the replay reads those bytes exactly as they were displayed.
 *
 * The replay deliberately excludes the payload and the agent's raw command —
 * it returns what the pager showed, not what the server knows. It does include
 * the state timestamps and the signed verdict, because those are the gesture's
 * facts. Every consultation is itself an audit event (`page.replayed`), with
 * ids only and no line/detail leakage (BIP-N-03).
 */
import type { DecisionRow, PageRow } from './store/types.js';
import type { CentralContext } from './context.js';
import { statusOf } from './view.js';

export interface ReplayRecord {
  page_id: string;
  /** The exact 80-character-or-less line stored at creation. */
  line: string;
  /** The exact detail screens stored at creation, in pager order. */
  screens: string[];
  code: number;
  risk: PageRow['risk'];
  state: PageRow['state'];
  fingerprint: string;
  created_at: number;
  delivered_at: number | null;
  read_at: number | null;
  decided_at: number | null;
  verdict: DecisionRow['verdict'] | null;
  choice: string | null;
  latency_ms: number | null;
  status: ReturnType<typeof statusOf>;
  /** True when the creation audit says the line had to be cut. */
  truncated: boolean;
}

/**
 * Builds a replay from persisted bytes. There is intentionally no call to
 * `composeRequest`, `fingerprintOf`, the rules provider, or the clock's line
 * formatter here: replaying is retrieval, not composition.
 */
export function replayOf(ctx: CentralContext, page: PageRow, decision: DecisionRow | null): ReplayRecord {
  const created = ctx.store
    .listEvents({ limit: 500, pageId: page.id, type: 'page.created' })
    .find((event) => event.page_id === page.id);
  const data = created?.data;
  return {
    page_id: page.id,
    line: page.line,
    screens: [...page.detail],
    code: page.code,
    risk: page.risk,
    state: page.state,
    fingerprint: page.payload_sha256,
    created_at: page.created_at,
    delivered_at: page.delivered_at,
    read_at: page.read_at,
    decided_at: decision?.decided_at ?? null,
    verdict: decision?.verdict ?? null,
    choice: decision?.choice_code ?? null,
    latency_ms: decision?.latency_ms ?? null,
    status: statusOf(page, decision, ctx.clock()),
    truncated: data?.truncated === true,
  };
}

/** The human-readable replay: every physical line stays a physical line. */
export function replayText(replay: ReplayRecord): string {
  const lines = [
    `BEEPER REPLAY ${replay.page_id}`,
    `STATE ${replay.state} STATUS ${replay.status} RISK ${replay.risk}`,
    `CREATED ${replay.created_at} DELIVERED ${replay.delivered_at ?? '-'} READ ${replay.read_at ?? '-'}`,
    `DECIDED ${replay.decided_at ?? '-'} VERDICT ${replay.verdict ?? '-'} LATENCY ${replay.latency_ms ?? '-'}ms`,
    `TRUNCATED ${replay.truncated ? 'yes' : 'no'} FINGERPRINT ${replay.fingerprint}`,
    '',
    `[0/line] ${replay.line}`,
  ];
  replay.screens.forEach((screen, index) => lines.push(`[${index + 1}/detail] ${screen}`));
  return `${lines.join('\n')}\n`;
}

/** Audit the consultation without leaking the replayed text into the journal. */
export function auditReplay(ctx: CentralContext, page: PageRow): void {
  ctx.audit.append({
    type: 'page.replayed',
    page_id: page.id,
    source_id: page.source_id,
    fingerprint: page.payload_sha256,
    data: { screens: page.detail.length, state: page.state },
  });
}
