/**
 * Shadow mode (BIP-F-42).
 *
 * Intercepting a human costs attention, and nobody can say what it would have
 * saved. Shadow mode answers that without risking anything: every page is
 * composed, routed and shown exactly as it would be, and the agent is handed a
 * SIMULATED approval instead of being blocked. Seven days of that in production
 * and you know the score — not a promise, a measurement.
 *
 * Three rules keep the measurement honest:
 *
 * - a simulated verdict is never indistinguishable from a real one. The wire
 *   carries `simulated: true`, the audit carries `page.shadowed`, and no row
 *   ever enters the `decisions` table: the metrics of A.3 (median decision
 *   time, unblocked time, filter rate) stay what a human did;
 * - a page a human actually decides wins over the simulation, whenever it
 *   arrives. Shadow mode resolves the wait, it does not mute the pager;
 * - the counters are READ BACK FROM THE LOG, never accumulated in memory. A
 *   restart must not lose the score, and a counter that dies with the process
 *   is not a measurement either.
 */
import type { AuditEvent } from '@bipeur/core';
import type { CentralContext } from './context.js';
import type { PageRow } from './store/types.js';

/** What shadow mode would have faced, had it been enforcing. */
export type WouldBe = 'admitted' | 'held' | 'denied';

export interface ShadowScore {
  enabled: boolean;
  simulated: number;
  would_have_held: number;
  would_have_been_denied: number;
  /** A human decided some of these pages for real despite the simulation. */
  really_decided: number;
}

/** The runtime switch. Seeded from the configuration, flipped at runtime. */
export class ShadowMode {
  private on: boolean;

  constructor(initial: boolean) {
    this.on = initial;
  }

  get enabled(): boolean {
    return this.on;
  }

  set(enabled: boolean): boolean {
    this.on = enabled;
    return this.on;
  }
}

/**
 * What the rules and the budget would have done with this page. Computed
 * BEFORE the simulation, so the score describes the world where Beeper
 * interrupts, not the one where it does not.
 */
export function wouldHave(ctx: CentralContext, page: PageRow, now: number): WouldBe {
  if (page.payload_sha256.length === 0) return 'denied';
  const admission = ctx.gate.admission(page, now);
  if (!admission.admit) return 'held';
  return 'admitted';
}

/**
 * Resolves a page without a human. The page keeps its own state; only the
 * shadow stamp is written, so a later real decision still lands on it.
 */
export function shadowResolve(ctx: CentralContext, page: PageRow, now: number, would: WouldBe): PageRow {
  ctx.store.updatePage(page.id, { shadow_resolved_at: now });
  ctx.audit.append({
    type: 'page.shadowed',
    page_id: page.id,
    source_id: page.source_id,
    fingerprint: page.payload_sha256,
    data: { simulated: true, would, code: page.code, risk: page.risk },
  });
  return { ...page, shadow_resolved_at: now };
}

/**
 * The score, read back from the journal. `limit` bounds the pass: a page that
 * aged out of retention is no longer counted, which is the same honesty as the
 * audit view — the log says what it still holds.
 */
export function shadowScore(ctx: CentralContext, limit = 500): ShadowScore {
  const events = ctx.store.listEvents({ limit, type: 'page.shadowed' });
  let held = 0;
  let denied = 0;
  let decided = 0;
  for (const event of events) {
    if (wouldBe(event) === 'held') held += 1;
    if (wouldBe(event) === 'denied') denied += 1;
    if (ctx.store.decisionByPage(String(event.page_id ?? ''))) decided += 1;
  }
  return {
    enabled: ctx.shadow.enabled,
    simulated: events.length,
    would_have_held: held,
    would_have_been_denied: denied,
    really_decided: decided,
  };
}

function wouldBe(event: AuditEvent): string | undefined {
  const value = event.data?.would;
  return typeof value === 'string' ? value : undefined;
}
