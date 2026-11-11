/**
 * The only way a page state changes (BIP-F-05). `transition()` from the shared
 * contract decides, so an illegal move is refused and journalled instead of
 * silently applied — the state machine is the contract, not a convention.
 */
import { transition, type PageState } from '@bipeur/core';
import type { CentralContext } from './context.js';
import type { PagePatch, PageRow } from './store/types.js';

export const PENDING_STATES: readonly PageState[] = ['queued', 'delivered', 'read'] as const;

export function isPending(state: PageState): boolean {
  return PENDING_STATES.includes(state);
}

export interface StateOutcome {
  ok: boolean;
  page: PageRow;
  reason?: string;
}

/**
 * Applies one transition inside a transaction. An illegal move writes a
 * `decision.rejected` event (the closed list of core has no dedicated type)
 * and leaves the page untouched.
 */
export function applyPageState(
  ctx: CentralContext,
  page: PageRow,
  to: PageState,
  at: number,
  patch: PagePatch = {},
): StateOutcome {
  try {
    transition(page.state, to);
  } catch {
    const reason = `illegal_transition:${page.state}->${to}`;
    ctx.audit.append({
      type: 'decision.rejected',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: { reason: 'illegal_transition', from: page.state, to, at },
    });
    return { ok: false, page, reason };
  }
  ctx.store.updatePage(page.id, { ...patch, state: to });
  return { ok: true, page: { ...page, ...patch, state: to } };
}

/** A held page that receives a decision or a read must be delivered first. */
export function ensureDelivered(ctx: CentralContext, page: PageRow, at: number): PageRow {
  if (page.state !== 'queued') return page;
  const outcome = applyPageState(ctx, page, 'delivered', at, { delivered_at: at });
  return outcome.ok ? outcome.page : page;
}
