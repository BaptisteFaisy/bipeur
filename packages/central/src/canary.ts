/**
 * The canary page (BIP-F-43).
 *
 * A device whose median decision time falls under the reflex threshold gets
 * its next pages marked as canaries. Three rules, each one a test:
 *
 * - the canary is decided by the DEVICE's habit, never by the page's risk: a
 *   careful human is not punished with a hold on a green page, and a reflexive
 *   one is not allowed to tap through a green page either;
 * - the canary is a FACT on the page, not a hint in the UI: it is stored, it
 *   travels on the wire, and the pager refuses the tap because the page says
 *   so — a client cannot decide for itself to stop obeying;
 * - the gesture lifts the habit by itself. A deliberate approval costs at least
 *   the hold, so its latency raises the median: the counter follows the
 *   intention, and there is no reset button to be told to forget.
 */
import { CANARY_NOTE, reflexState, type ReflexState } from '@bipeur/core';
import type { CentralContext } from './context.js';
import type { DeviceRow, PageRow } from './store/types.js';
import { targetsOf } from './targeting.js';

export interface CanaryVerdict {
  state: ReflexState;
  /** True when the page must demand the deliberate gesture. */
  canary: boolean;
}

/**
 * The habit of one device, read from its own recent decisions.
 *
 * The window is deliberately short (ten decisions): a habit that formed three
 * months ago is not a habit tonight, and a guard that never forgets is a
 * sanction rather than a measure.
 */
export function deviceReflex(ctx: CentralContext, deviceId: string): ReflexState {
  return reflexState(ctx.store.decisionLatencies(deviceId));
}

/**
 * Whether a page must be a canary, judged on the audience it actually rings.
 *
 * Evaluated at DELIVERY, not at creation: the audience is fixed by the rota and
 * the targeting (BIP-F-37), and a habit belongs to whoever is about to read the
 * page. A page with no explicit target follows its visitor scope, so every live
 * device of that scope is judged.
 *
 * ONE reflexive pager is enough to make the page a canary. The guard exists to
 * stop a reflex approval from ever being signed; erring the other way would let
 * a habit through on the second pager of a station. The cost of the safe
 * direction is a one-second hold on a careful human who shares a station with a
 * reflexive one — documented, not hidden.
 */
export function canaryForPage(ctx: CentralContext, page: PageRow): CanaryVerdict {
  const audience = audienceOf(ctx, page);
  const states = audience.map((device) => reflexState(ctx.store.decisionLatencies(device.id)));
  const worst = states.reduce<pickState>(merge, idleState());
  return { state: worst, canary: states.some((state) => state.reflex) };
}

type pickState = CanaryVerdict['state'];

/** The live devices the page rings: its targets, or its visitor scope. */
function audienceOf(ctx: CentralContext, page: PageRow): DeviceRow[] {
  const targets = targetsOf(ctx, page);
  if (targets.length > 0) {
    return targets
      .map((id) => ctx.store.deviceById(id))
      .filter((device): device is DeviceRow => device !== null && device.revoked_at === null);
  }
  return ctx.store.listDevices().filter((device) => device.revoked_at === null && inScope(ctx, device, page));
}

/**
 * A device belongs to the scope of a page when the same visitor owns both.
 * Demo visitors are isolated spaces (BIP-F-31): the habit of one visitor's
 * pager must never turn another visitor's page into a canary.
 */
function inScope(_ctx: CentralContext, device: DeviceRow, page: PageRow): boolean {
  return device.visitor_id === page.visitor_id;
}

/** The habit to REPORT: the slowest median, so the note never overstates. */
function merge(best: pickState, next: pickState): pickState {
  if (next.median_ms === null) return best;
  if (best.median_ms === null || next.median_ms > best.median_ms) return next;
  return best;
}

/**
 * Marks a page as a canary and journals it. The note joins the detail screens:
 * a human is told WHY the tap stopped working, in the same language as the rest
 * of the page — a gate that surprises without explaining is a gate people
 * route around.
 */
export function markCanary(ctx: CentralContext, page: PageRow, at: number, state: ReflexState): PageRow {
  const note = `${CANARY_NOTE} (${Math.round(state.median_ms ?? 0)} ms median, under ${state.threshold_ms})`;
  const detail = [...page.detail, note].slice(0, 12);
  ctx.store.updatePage(page.id, { canary: true });
  ctx.audit.append({
    type: 'page.canary',
    page_id: page.id,
    source_id: page.source_id,
    fingerprint: page.payload_sha256,
    data: { median_ms: state.median_ms, threshold_ms: state.threshold_ms, samples: state.samples },
  });
  return { ...page, canary: true, detail, delivered_at: page.delivered_at ?? at };
}

function idleState(): ReflexState {
  return {
    reflex: false,
    median_ms: null,
    samples: 0,
    threshold_ms: 1_500,
    reason: 'not_enough_history',
  };
}
