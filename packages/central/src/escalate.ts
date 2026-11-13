/**
 * Escalation (BIP-F-37): a page addressed to a rota that nobody answers moves
 * to the next on-call when the window expires. The audit log says who held
 * the pager, who took it over, and how long the first one had.
 *
 * The page itself never changes state: it stays `delivered` until somebody
 * decides or it expires (a refusal, like any unanswered page). Only its
 * address changes — which is exactly what `page_targets` holds.
 */
import type { CentralContext } from './context.js';
import { nextShift, shiftOfTarget } from './rota.js';
import type { PageRow } from './store/types.js';
import { pageView } from './view.js';

export class EscalationSweeper {
  constructor(private readonly ctx: CentralContext) {}

  /** Moves every due page to the next on-call; returns how many moved. */
  sweep(now: number): number {
    let escalated = 0;
    for (const page of this.ctx.store.listPages({ state: 'pending', limit: 200 })) {
      if (page.rota_id === null) continue;
      if (this.escalate(page, now)) escalated += 1;
    }
    return escalated;
  }

  /** One page: due? next on-call? then it moves. */
  private escalate(page: PageRow, now: number): boolean {
    const rotaId = page.rota_id;
    if (rotaId === null) return false;
    const rota = this.ctx.store.rotaById(rotaId);
    if (!rota) return false;
    // A page still held by the attention budget reached nobody yet: there is
    // nobody to escalate away from.
    if (page.state === 'queued') return false;
    if (!this.isDue(page, rota.escalate_after_ms, now)) return false;

    const shifts = this.ctx.store.listShifts(rota.id);
    const current = shiftOfTarget(shifts, this.ctx.store.pageTargets(page.id)[0] ?? '');
    const next = nextShift(shifts, current);
    if (!next) return false;

    this.move(page, next.target, current?.target ?? null, now);
    return true;
  }

  /** The window runs from the moment the current on-call got the page. */
  private isDue(page: PageRow, escalateAfterMs: number, now: number): boolean {
    const since = page.escalated_at ?? page.delivered_at ?? page.created_at;
    return now - since >= escalateAfterMs;
  }

  private move(page: PageRow, target: string, from: string | null, now: number): void {
    const level = page.escalation_level + 1;
    this.ctx.store.transaction(() => {
      this.ctx.store.clearPageTargets(page.id);
      this.ctx.store.addPageTarget(page.id, target);
      this.ctx.store.updatePage(page.id, { escalation_level: level, escalated_at: now });
    });
    const fresh = this.ctx.store.pageById(page.id) ?? page;
    this.ctx.audit.append({
      type: 'page.escalated',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: { level, from, to: target, after_ms: now - (page.delivered_at ?? page.created_at) },
    });
    // BIP-N-06: the intent to beep is proven in the log, never by a sound.
    this.ctx.audit.append({
      type: 'beep.requested',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: { reminder: 0, risk: fresh.risk, escalation: level },
    });
    // The new on-call rings; the previous one is told the page moved on.
    this.ctx.hub.broadcast({ type: 'page.delivered', page: pageView(fresh) }, { deviceIds: [target] });
    if (from && from !== target) {
      this.ctx.hub.broadcast({ type: 'page.escalated', page_id: page.id }, { deviceIds: [from] });
    }
    this.ctx.push.notify(fresh, { reminder: false, deviceIds: [target] });
  }
}
