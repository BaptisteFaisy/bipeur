/**
 * Admission control of a page: the attention budget (BIP-F-09) and the quiet
 * hours (BIP-F-10). A green or amber page is held while the sliding hour is
 * full and delivered in a burst when a slot frees; a red page, or family 9,
 * always goes through. Held pages stay `queued` in SQLite, so a restart keeps
 * them (BIP-P-12).
 *
 * The budget is scoped (BIP-F-31): every demo visitor gets an isolated budget
 * so two judges running the demo never steal each other's beeps, while pages
 * with no visitor (the real operator and their agents) share one scope —
 * BIP-F-09 speaks of *the human*, and one operator must not multiply their
 * budget by opening stations.
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
import { pushTargets, streamFilterFor } from './targeting.js';
import { pageView } from './view.js';

/** Scope key of the real operator: pages whose `visitor_id` is null. */
export const OPERATOR_SCOPE = '';

function scopeOf(visitorId: string | null): string {
  return visitorId ?? OPERATOR_SCOPE;
}

/**
 * One `AttentionBudget` per scope, created on demand. Empty scopes are pruned
 * during the sweep so purged demo visitors (24 h, `purgeVisitorsBefore`) never
 * leak a budget on a long-running instance.
 */
class BudgetScopes {
  private readonly scopes = new Map<string, AttentionBudget>();

  constructor(
    private readonly policy: BudgetPolicy,
    private readonly clock: () => number,
  ) {}

  get perHour(): number {
    return this.policy.perHour;
  }

  forScope(scope: string): AttentionBudget {
    const existing = this.scopes.get(scope);
    if (existing) return existing;
    const created = new AttentionBudget(this.policy, this.clock);
    this.scopes.set(scope, created);
    return created;
  }

  /** Drops every scope with no counted delivery left in the sliding window. */
  prune(now: number): void {
    for (const [scope, budget] of this.scopes) {
      if (budget.window(now).length === 0) this.scopes.delete(scope);
    }
  }
}

export class DeliveryGate {
  private readonly scopes: BudgetScopes;
  private quiet: QuietHours;

  constructor(
    private readonly ctx: CentralContext,
    policy: BudgetPolicy = DEFAULT_BUDGET_POLICY,
    quiet: QuietHours = DEFAULT_QUIET_HOURS,
  ) {
    this.scopes = new BudgetScopes(policy, ctx.clock);
    this.quiet = quiet;
    // Windows survive a restart: every scope is rebuilt from the pages table.
    for (const mark of ctx.store.recentDeliveries(ctx.clock() - policy.windowMs)) {
      this.scopes.forScope(scopeOf(mark.visitor_id)).record(mark.risk, mark.code, mark.at);
    }
  }

  get perHour(): number {
    return this.scopes.perHour;
  }

  setQuietHours(quiet: QuietHours): void {
    this.quiet = quiet;
  }

  /**
   * `GET /v1/metrics` shows the operator scope only: demo visitors are
   * transient and isolated (BIP-F-31), while `in_use` next to
   * `budget_per_hour` describes the budget of the human running the station.
   */
  inUse(now: number): number {
    return this.scopes.forScope(OPERATOR_SCOPE).inUse(now);
  }

  inUseFor(visitorId: string | null, now: number): number {
    return this.scopes.forScope(scopeOf(visitorId)).inUse(now);
  }

  admission(page: PageRow, now: number): Admission {
    const quiet = quietAdmission(this.quiet, page.risk, page.code, new Date(now));
    if (!quiet.admit) return quiet;
    return this.scopes.forScope(scopeOf(page.visitor_id)).tryAdmit(page.risk, page.code, now);
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
      data: { reason: 'budget', in_use: this.inUseFor(page.visitor_id, now), budget: this.perHour },
    });
    return page;
  }

  /**
   * Flushes held pages while their own scope allows; returns how many went
   * out. A saturated scope never blocks the pages of another visitor.
   */
  release(now: number): number {
    this.scopes.prune(now);
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
      if (verdict.reason === 'quiet') this.suppress(page, now);
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
    this.scopes.forScope(scopeOf(page.visitor_id)).record(page.risk, page.code, now);
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
    this.ctx.hub.broadcast(
      { type: 'page.delivered', page: pageView(delivered) },
      streamFilterFor(this.ctx, delivered),
    );
    this.ctx.push.notify(delivered, { reminder: false, deviceIds: pushTargets(this.ctx, delivered) });
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
