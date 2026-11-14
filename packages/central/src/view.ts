/** The wire shape of a page and the status a waiting source receives (A.9). */
import { decisionStatusSchema } from '@bipeur/core';
import type { z } from 'zod';
import type { DecisionRow, PageRow } from './store/types.js';

export type DecisionStatus = z.infer<typeof decisionStatusSchema>;

export type PageView = {
  page_id: string;
  state: PageRow['state'];
  line: string;
  code: number;
  risk: PageRow['risk'];
  fingerprint: string;
  expires_at: number;
  detail: string[];
  options: PageRow['options'];
  kind: PageRow['kind'];
  station: string;
  created_at: number;
  delivered_at: number | null;
  read_at: number | null;
  callback_url: string | null;
  /** BIP-F-47: the leader this page hangs on; null when it leads its block. */
  group_leader_id: string | null;

  /** True when the page was resolved by shadow mode, not by a human (BIP-F-42). */
  simulated: boolean;

  /**
   * BIP-F-43: the page demands the deliberate gesture (one second of
   * press-and-hold) whatever its risk, because its reader has been approving
   * too fast lately. A fact on the page, so the client cannot decide for
   * itself to stop obeying.
   */
  canary: boolean;
};

export function pageView(page: PageRow): PageView {
  return {
    page_id: page.id,
    state: page.state,
    line: page.line,
    code: page.code,
    risk: page.risk,
    fingerprint: page.payload_sha256,
    expires_at: page.expires_at,
    detail: page.detail,
    options: page.options,
    kind: page.kind,
    station: page.source_alias,
    created_at: page.created_at,
    delivered_at: page.delivered_at,
    read_at: page.read_at,
    callback_url: page.callback_url,
    group_leader_id: page.group_leader_id,

    simulated: simulatedOf(page, null),

    canary: page.canary,
  };
}

/** `pending` while the page is not final; an expired page is a refusal. */
/**
 * A page shadow mode resolved (BIP-F-42) answers `approved`, and says so:
 * `simulatedOf` is what the wire carries next to the status. A real decision
 * always wins over the simulation, whenever it arrives — shadow mode resolves
 * the wait, it never mutes the pager.
 */
export function simulatedOf(page: PageRow, decision: DecisionRow | null): boolean {
  return decision === null && page.shadow_resolved_at !== null;
}

export function statusOf(
  page: PageRow,
  decision: DecisionRow | null,
  now: number,
): DecisionStatus {
  if (simulatedOf(page, decision)) return 'approved';
  if (page.state === 'decided') {
    if (!decision) return 'pending';
    if (decision.verdict === 'approve') return 'approved';
    if (decision.verdict === 'deny') return 'denied';
    return 'choice';
  }
  if (page.state === 'expired') return 'expired';
  if (page.state === 'cancelled') return 'cancelled';
  if (now >= page.expires_at) return 'expired';
  return 'pending';
}
