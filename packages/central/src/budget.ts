/**
 * Admission control of a page: the attention budget (BIP-F-09) and the quiet
 * hours (BIP-F-10). A green or amber page is held while the sliding hour is
 * full and delivered in a burst when a slot frees; a red page, or family 9,
 * always goes through. Held pages stay `queued` in SQLite, so a restart keeps
 * them (BIP-P-12).
 */
import {
  AttentionBudget,
  DEFAULT_BUDGET_POLICY,
  DEFAULT_QUIET_HOURS,
  quietAdmission,
  type Admission,
  type BudgetPolicy,
  type QuietHours,
} from '@bipeur/core';
import { newId } from '@bipeur/core/node';
import type { CentralContext } from './context.js';
import { applyPageState } from './states.js';
import type { PageRow } from './store/types.js';
import { pageView } from './view.js';

export class DeliveryGate {
  private readonly budget: AttentionBudget;
  private quiet: QuietHours;

  constructor(
    private readonly ctx: CentralContext,
    policy: BudgetPolicy = DEFAULT_BUDGET_POLICY,
    quiet: QuietHours = DEFAULT_QUIET_HOURS,
  ) {
    this.budget = new AttentionBudget(policy, ctx.clock);
    this.quiet = quiet;
    // The window survives a restart: it is rebuilt from the pages table.
    for (const mark of ctx.store.recentDeliveries(ctx.clock() - policy.windowMs)) {
      this.budget.record(mark.risk, mark.code, mark.at);
    }
  }

  get perHour(): number {
    return this.budget.perHour;
  }

  setQuietHours(quiet: QuietHours): void {
    this.quiet = quiet;
  }

  inUse(now: number): number {
    return this.budget.inUse(now);
  }

  admission(page: PageRow, now: number): Admission {
    const quiet = quietAdmission(this.quiet, page.risk, page.code, new Date(now));
    if (!quiet.admit) return quiet;
    return this.budget.tryAdmit(page.risk, page.code, now);
  }

  /** Delivers now if admitted, holds or suppresses otherwise. */
  attempt(page: PageRow, now: number): PageRow {
    const verdict = this.admission(page, now);
    if (verdict.admit) return this.deliver(page, now);
    if (verdict.reason === 'quiet') return this.suppress(page, now);
    this.ctx.audit.append({
      type: 'page.held',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: { reason: 'budget', in_use: this.budget.inUse(now), budget: this.perHour },
    });
    return page;
  }

  /** Flushes held pages while the budget allows; returns how many went out. */
  release(now: number): number {
    let delivered = 0;
    const flushed: string[] = [];
    for (const page of this.ctx.store.listPages({ state: 'queued', limit: 100 })) {
      if (page.expires_at <= now) continue;
      const verdict = this.admission(page, now);
      if (verdict.admit) {
        this.deliver(page, now);
        flushed.push(page.id);
        delivered += 1;
        continue;
      }
      if (verdict.reason === 'quiet') {
        this.suppress(page, now);
        continue;
      }
      break;
    }
    if (flushed.length > 0) {
      // BIP-F-09: the held pages arrive as one burst, and the log says so.
      this.ctx.audit.append({
        type: 'budget.flushed',
        data: { released: flushed.length, page_ids: flushed },
      });
    }
    return delivered;
  }

  private deliver(page: PageRow, now: number): PageRow {
    this.budget.record(page.risk, page.code, now);
    const outcome = applyPageState(this.ctx, page, 'delivered', now, { delivered_at: now });
    if (!outcome.ok) return page;
    const delivered = outcome.page;
    this.ctx.audit.append({
      type: 'page.delivered',
      page_id: delivered.id,
      source_id: delivered.source_id,
      fingerprint: delivered.payload_sha256,
      data: { risk: delivered.risk, code: delivered.code, latency_ms: now - delivered.created_at },
    });
    // BIP-N-06: the intent to beep is proven here, never by a sound.
    this.ctx.audit.append({
      type: 'beep.requested',
      page_id: delivered.id,
      source_id: delivered.source_id,
      fingerprint: delivered.payload_sha256,
      data: { reminder: 0, risk: delivered.risk },
    });
    this.ctx.hub.broadcast({ type: 'page.delivered', page: pageView(delivered) }, { visitorId: delivered.visitor_id });
    this.ctx.push.notify(delivered, { reminder: false });
    return delivered;
  }

  /** Quiet hours: a non urgent page becomes a digest line and a refusal. */
  private suppress(page: PageRow, now: number): PageRow {
    this.ctx.audit.append({
      type: 'quiet.suppressed',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: { risk: page.risk, code: page.code },
    });
    const noticeId = newId('nt');
    this.ctx.store.insertNotice({
      id: noticeId,
      source_id: page.source_id,
      source_alias: page.source_alias,
      ts: now,
      line: page.line,
      visitor_id: page.visitor_id,
    });
    this.ctx.audit.append({
      type: 'notice.logged',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: { notice_id: noticeId, reason: 'quiet_hours' },
    });
    const outcome = applyPageState(this.ctx, page, 'expired', now);
    if (!outcome.ok) return page;
    this.ctx.audit.append({
      type: 'page.expired',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: { reason: 'quiet_hours', default: 'deny' },
    });
    this.ctx.hub.broadcast({ type: 'page.expired', page_id: page.id }, { visitorId: page.visitor_id });
    return outcome.page;
  }
}
