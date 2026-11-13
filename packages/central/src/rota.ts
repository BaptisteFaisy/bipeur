/**
 * The on-call rota (BIP-F-37): who answers, in which order, and when the page
 * moves to the next one. Pure logic — no I/O, no clock — so the rules of the
 * rota are testable on their own.
 *
 * A rota is an ordered list of shifts. A shift names a human (`alias`) and the
 * pager that rings for them (`target`, a device id). Three ways to decide who
 * holds the pager at a given instant, in that order:
 *
 *   1. a shift with an explicit window that contains the instant;
 *   2. a rotation: the rota hands the pager over every `rotation_ms`;
 *   3. otherwise the first shift of the list — the whole rota is on call.
 */
import type { OncallShiftRow, RotaRow } from './store/types.js';

/** Thirty seconds at least, a week at most: the escalation window. */
export const ESCALATE_MIN_MS = 30_000;
export const ESCALATE_MAX_MS = 7 * 24 * 3_600_000;

/** The escalation order of a rota: priority first, insertion order second. */
export function sortShifts(shifts: OncallShiftRow[]): OncallShiftRow[] {
  return [...shifts].sort((a, b) => a.priority - b.priority || a.created_at - b.created_at);
}

/** Does the shift hold at `now`? A null bound means "open on that side". */
export function holdsAt(shift: OncallShiftRow, now: number): boolean {
  if (shift.starts_at !== null && now < shift.starts_at) return false;
  if (shift.ends_at !== null && now >= shift.ends_at) return false;
  return true;
}

/** The shift that holds the pager at `now`, or null when the rota is empty. */
export function onCall(rota: RotaRow, shifts: OncallShiftRow[], now: number): OncallShiftRow | null {
  const ordered = sortShifts(shifts);
  if (ordered.length === 0) return null;
  const windowed = ordered.filter((shift) => shift.starts_at !== null || shift.ends_at !== null);
  const holding = windowed.find((shift) => holdsAt(shift, now));
  if (holding) return holding;
  if (rota.rotation_ms !== null && rota.rotation_ms > 0) return rotate(ordered, rota, now);
  return ordered[0] ?? null;
}

/** The rotation: the pager changes hands every `rotation_ms`, in list order. */
function rotate(ordered: OncallShiftRow[], rota: RotaRow, now: number): OncallShiftRow | null {
  const elapsed = Math.max(0, now - rota.created_at);
  const index = Math.floor(elapsed / (rota.rotation_ms as number)) % ordered.length;
  return ordered[index] ?? null;
}

/**
 * The next one to try, in escalation order. No wrap: every person gets one
 * turn, then the page simply expires — a refusal, like any unanswered page.
 */
export function nextShift(shifts: OncallShiftRow[], current: OncallShiftRow | null): OncallShiftRow | null {
  const ordered = sortShifts(shifts);
  if (ordered.length === 0) return null;
  if (!current) return ordered[0] ?? null;
  const index = ordered.findIndex((shift) => shift.id === current.id);
  if (index < 0) return ordered[0] ?? null;
  return ordered[index + 1] ?? null;
}

/** The shift that rings for a given device, if the rota knows it. */
export function shiftOfTarget(shifts: OncallShiftRow[], target: string): OncallShiftRow | null {
  return sortShifts(shifts).find((shift) => shift.target === target) ?? null;
}

export interface ShiftView {
  shift_id: string;
  alias: string;
  target: string;
  priority: number;
  starts_at: number | null;
  ends_at: number | null;
}

export interface RotaView {
  rota_id: string;
  label: string;
  escalate_after_ms: number;
  rotation_ms: number | null;
  created_at: number;
  /** Who holds the pager now, and which pager that is. */
  on_call: string | null;
  on_call_device: string | null;
  shifts: ShiftView[];
}

export function rotaView(rota: RotaRow, shifts: OncallShiftRow[], now: number): RotaView {
  const current = onCall(rota, shifts, now);
  return {
    rota_id: rota.id,
    label: rota.label,
    escalate_after_ms: rota.escalate_after_ms,
    rotation_ms: rota.rotation_ms,
    created_at: rota.created_at,
    on_call: current?.alias ?? null,
    on_call_device: current?.target ?? null,
    shifts: sortShifts(shifts).map((shift) => ({
      shift_id: shift.id,
      alias: shift.alias,
      target: shift.target,
      priority: shift.priority,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
    })),
  };
}
