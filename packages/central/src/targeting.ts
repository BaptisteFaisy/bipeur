/**
 * Who a page rings (BIP-F-37). A page addressed to a rota belongs to the
 * devices listed in `page_targets` and to nobody else; a page without a target
 * keeps the historical delivery: the visitor scope of its station.
 *
 * One place, so the WebSocket, the push and the resynchronisation list never
 * disagree about who is on duty.
 */
import type { CentralContext } from './context.js';
import type { PageRow } from './store/types.js';
import type { StreamFilter } from './stream.js';

/** The devices a page is addressed to; empty when it follows its scope. */
export function targetsOf(ctx: CentralContext, page: PageRow): string[] {
  return ctx.store.pageTargets(page.id);
}

/** The stream filter of a page: its devices, or its visitor scope. */
export function streamFilterFor(ctx: CentralContext, page: PageRow): StreamFilter {
  const targets = targetsOf(ctx, page);
  if (targets.length > 0) return { deviceIds: targets };
  return { visitorId: page.visitor_id };
}

/** The push recipients of a page; undefined means "the whole scope". */
export function pushTargets(ctx: CentralContext, page: PageRow): string[] | undefined {
  const targets = targetsOf(ctx, page);
  return targets.length > 0 ? targets : undefined;
}
