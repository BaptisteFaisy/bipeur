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
  bypassesAttention,
  DEFAULT_BUDGET_POLICY,
  DEFAULT_QUIET_HOURS,
  quietAdmission,
  type Admission,
  type BudgetPolicy,
  projectionNote,
  projectBudget,
  type BudgetProjection,
  type QuietHours,
} from '@bipeur/core';
import { newId } from '@bipeur/core/node';
import { isMember } from './groups.js';

import { canaryForPage, markCanary } from './canary.js';
import type { CentralContext } from './context.js';
import { applyPageState } from './states.js';
import type { PageRow } from './store/types.js';
import { pushTargets, streamFilterFor } from './targeting.js';
import { pageView } from './view.js';

/** Scope key of the real operator: pages whose `visitor_id` is null. */
export const OPERATOR_SCOPE = '';

/**
 * Whether a projection earns a screen (BIP-F-47).
 *
 * A note that repeats the obvious is noise, and noise is what this feature
 * exists to fight. It is said when it changes the decision: the page is free
 * while the window is full (a receipt, a group member, a red page), or the
 * window is tight enough that one more page matters.
 */
/**
 * Inserts the projection note BEFORE the agent's own words.
 *
 * The honesty rule (A.6) puts the agent's prose on the LAST screen, behind
 * the `AGENT SAYS:` label. Appending the note at the end pushed that prose
 * out of last place — the last thing a human read would no longer be the
 * agent's words, and the screen order the product documents no longer held.
 * The note is a Central fact, so it belongs with the facts: before.
 */
function withProjection(detail: readonly string[], note: string): string[] {
  const proseAt = detail.findIndex((screen) => screen.startsWith('AGENT SAYS:'));
  if (proseAt < 0) return [...detail, note].slice(0, 12);
  const screens = [...detail];
  screens.splice(proseAt, 0, note);
  return screens.slice(0, 12);
}

function worthSaying(projection: BudgetProjection): boolean {
  if (projection.cost === 0) return true;
  return projection.in_use > 0 || projection.would_be_held;
}

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

  /**
   * What the NEXT page would cost this scope, whatever its content: the
   * projection a dashboard draws, not the projection of one page. A red page
   * and a group member are free (0), an ordinary page is one slot.
   */
  projectionForNext(now: number, visitorId: string | null = null): BudgetProjection {
    return projectBudget(this.inUseFor(visitorId, now), this.perHour, 1);
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

  /**
   * What this page will cost, out of what is left (BIP-F-47). The human must
   * see it BEFORE tapping: a page that costs 4 of the 6 remaining is a
   * different decision from a page that costs 1 of 6.
   */
  projection(page: PageRow, now: number): BudgetProjection {
    const inUse = this.inUseFor(page.visitor_id, now);
    // A green page is one slot; an amber one is one slot; a red page is free
    // because it bypasses the budget, and so is a group member, which never
    // rings at all.
    const cost = bypassesAttention(page.risk, page.code) || isMember(page) ? 0 : 1;
    return projectBudget(inUse, this.perHour, cost);
  }

  private deliver(page: PageRow, now: number): PageRow {
    // BIP-F-47: the human sees what this page costs BEFORE tapping, so the
    // projection is computed on the window as it stood, without this page in
    // it — counting it twice would say "1 of 6, 4 left" for the first page.
    //
    // The note goes into the STORED screens, so the replay of BIP-F-46 shows
    // exactly what was on the LCD, projection included. It is added only when
    // the window is already partly spent: "this page costs 1 of 6, 5 left" is
    // noise on the first page of the hour, and noise is the enemy this feature
    // exists to fight. The dashboard carries the next page's projection either
    // way.
    const projection = this.projection(page, now);
    const detail = worthSaying(projection)
      ? withProjection(page.detail, projectionNote(projection))
      : page.detail;
    this.scopes.forScope(scopeOf(page.visitor_id)).record(page.risk, page.code, now);
    const outcome = applyPageState(this.ctx, page, 'delivered', now, { delivered_at: now, detail });
    if (!outcome.ok) return page;
    // BIP-F-43: the reflex guard is judged here, on the audience the page
    // actually rings, and BEFORE the broadcast — a pager is told to demand the
    // gesture by the page it receives, never by its own guess.
    const delivered = this.markCanary(outcome.page, now);
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

  /** Applies the canary mark when the audience's habit demands it. */
  private markCanary(page: PageRow, now: number): PageRow {
    if (page.canary) return page;
    const verdict = canaryForPage(this.ctx, page);
    if (!verdict.canary) return page;
    return markCanary(this.ctx, page, now, verdict.state);
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
