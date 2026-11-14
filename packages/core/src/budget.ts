/**
 * Attention budget (BIP-F-09) and quiet hours (BIP-F-10).
 *
 * Properties BIP-P-07 (a sliding hour never carries more green+amber pages
 * than the budget) and BIP-P-08 (a red page, or family 9, is never held).
 */
import { codeFamily, isUrgentCode } from './codes.js';
import { HOUR, MINUTE } from './time.js';
import type { Risk } from './types.js';

export const DEFAULT_BUDGET_PER_HOUR = 6;

export interface BudgetPolicy {
  perHour: number;
  windowMs: number;
}

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  perHour: DEFAULT_BUDGET_PER_HOUR,
  windowMs: HOUR,
};

export type HoldReason = 'budget' | 'quiet';

export interface Admission {
  admit: boolean;
  reason?: HoldReason;
}

/** Red pages and family 9 always get through (BIP-F-09, BIP-P-08). */
export function bypassesAttention(risk: Risk, code: number): boolean {
  // A red page bypasses the budget because it cannot wait; a family-9 page
  // because it is an incident. A family-8 page bypasses it for a third reason:
  // it asks nothing. It is the proof of what already happened, and charging
  // the human's budget for it would make the closing of the loop the thing
  // that gets held (BIP-F-41).
  return risk === 'red' || isUrgentCode(code) || codeFamily(code) === 8;
}

/**
 * Sliding-window counter of delivered pages. Only green and amber pages count
 * against the budget; red and family 9 are recorded but never refused.
 */
export class AttentionBudget {
  private readonly counted: number[] = [];
  private readonly all: number[] = [];
  private readonly policy: BudgetPolicy;
  private readonly now: () => number;

  constructor(policy: BudgetPolicy = DEFAULT_BUDGET_POLICY, now: () => number = Date.now) {
    this.policy = policy;
    this.now = now;
  }

  get perHour(): number {
    return this.policy.perHour;
  }

  private prune(now: number): void {
    const floor = now - this.policy.windowMs;
    while (this.counted.length > 0 && (this.counted[0] ?? 0) <= floor) this.counted.shift();
    while (this.all.length > 0 && (this.all[0] ?? 0) <= floor) this.all.shift();
  }

  inUse(now: number = this.now()): number {
    this.prune(now);
    return this.counted.length;
  }

  remaining(now: number = this.now()): number {
    return Math.max(0, this.policy.perHour - this.inUse(now));
  }

  /** Decide whether a page may be delivered right now. Does not record it. */
  tryAdmit(risk: Risk, code: number, at: number = this.now()): Admission {
    if (bypassesAttention(risk, code)) return { admit: true };
    this.prune(at);
    if (this.counted.length >= this.policy.perHour) {
      return { admit: false, reason: 'budget' };
    }
    return { admit: true };
  }

  /** Record a delivery that actually happened. */
  record(risk: Risk, code: number, at: number = this.now()): void {
    this.prune(at);
    this.all.push(at);
    if (!bypassesAttention(risk, code)) this.counted.push(at);
  }

  /** Every delivery of the last window, for tests and the dashboard. */
  window(now: number = this.now()): readonly number[] {
    this.prune(now);
    return [...this.counted];
  }
}

/** Quiet hours, expressed in the local timezone of the operator. */
export interface QuietHours {
  enabled: boolean;
  /** `"23:00"` */
  start: string;
  /** `"07:00"` */
  end: string;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  start: '23:00',
  end: '07:00',
};

const HHMM = /^(\d{1,2}):(\d{2})$/;

function toMinutes(hhmm: string): number | null {
  const match = HHMM.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** True when `minutesOfDay` falls inside the quiet range (may cross midnight). */
export function isInQuietRange(
  minutesOfDay: number,
  start: string,
  end: string,
): boolean {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null) return false;
  if (from === to) return false;
  if (from < to) return minutesOfDay >= from && minutesOfDay < to;
  return minutesOfDay >= from || minutesOfDay < to;
}

export function isQuietHours(quiet: QuietHours, at: Date): boolean {
  if (!quiet.enabled) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return isInQuietRange(minutes, quiet.start, quiet.end);
}

/** During quiet hours only red and family 9 are delivered (BIP-F-10). */
export function quietAdmission(
  quiet: QuietHours,
  risk: Risk,
  code: number,
  at: Date,
): Admission {
  if (!isQuietHours(quiet, at)) return { admit: true };
  if (bypassesAttention(risk, code)) return { admit: true };
  return { admit: false, reason: 'quiet' };
}

/** Reminder schedule of BIP-F-08, in milliseconds after delivery. */
export const REMINDER_OFFSETS_MS: readonly number[] = [2 * MINUTE, 5 * MINUTE, 15 * MINUTE];
