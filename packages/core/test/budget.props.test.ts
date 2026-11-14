/**
 * Properties BIP-P-07 (sliding-hour budget) and BIP-P-08 (red never held).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AttentionBudget,
  DEFAULT_BUDGET_POLICY,
  bypassesAttention,
  isInQuietRange,
  isQuietHours,
  quietAdmission,
} from '../src/budget.js';
import { HOUR, MINUTE } from '../src/time.js';
import type { Risk } from '../src/types.js';

const risks = fc.constantFrom<Risk>('green', 'amber', 'red');
const codes = fc.constantFrom(110, 310, 410, 510, 610, 710, 911);

describe('BIP-P-07 — at most `budget` green/amber pages per sliding hour', () => {
  it('holds for any arrival pattern', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ offset: fc.integer({ min: 0, max: 3 * HOUR }), risk: risks, code: codes }),
          { minLength: 1, maxLength: 60 },
        ),
        fc.integer({ min: 1, max: 12 }),
        (arrivals, perHour) => {
          const sorted = [...arrivals].sort((a, b) => a.offset - b.offset);
          const budget = new AttentionBudget({ perHour, windowMs: HOUR }, () => 0);
          const admitted: { at: number; risk: Risk; code: number }[] = [];
          for (const arrival of sorted) {
            const decision = budget.tryAdmit(arrival.risk, arrival.code, arrival.offset);
            if (!decision.admit) continue;
            budget.record(arrival.risk, arrival.code, arrival.offset);
            admitted.push({ at: arrival.offset, risk: arrival.risk, code: arrival.code });
          }
          const counted = admitted.filter((a) => !bypassesAttention(a.risk, a.code));
          for (const page of counted) {
            const inWindow = counted.filter(
              (other) => other.at <= page.at && other.at > page.at - HOUR,
            );
            expect(inWindow.length).toBeLessThanOrEqual(perHour);
          }
        },
      ),
      { numRuns: 300, seed: 20261124 },
    );
  });

  it('delivers six and holds the seventh (A.7 BIP-F-09, recette A.17)', () => {
    const budget = new AttentionBudget(DEFAULT_BUDGET_POLICY, () => 0);
    const results: boolean[] = [];
    for (let i = 0; i < 7; i += 1) {
      const at = i * 1000;
      const decision = budget.tryAdmit('amber', 310, at);
      results.push(decision.admit);
      if (decision.admit) budget.record('amber', 310, at);
    }
    expect(results.slice(0, 6)).toEqual([true, true, true, true, true, true]);
    expect(results[6]).toBe(false);
    expect(budget.remaining(6000)).toBe(0);
    expect(budget.tryAdmit('amber', 310, HOUR + 1000).admit).toBe(true);
  });
});

describe('BIP-P-08 — a red page or family 9 is never held', () => {
  it('passes whatever the budget and the quiet hours say', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.integer({ min: 0, max: 30 * MINUTE }), { minLength: 0, maxLength: 40 }),
        (perHour, times) => {
          const budget = new AttentionBudget({ perHour, windowMs: HOUR }, () => 0);
          for (let i = 0; i < perHour; i += 1) {
            budget.record('amber', 310, i);
          }
          for (const at of times) budget.record('green', 510, at);
          const probe = 31 * MINUTE;
          expect(budget.tryAdmit('amber', 310, probe).admit).toBe(false);
          expect(budget.tryAdmit('green', 510, probe).admit).toBe(false);
          expect(budget.tryAdmit('red', 110, probe).admit).toBe(true);
          expect(budget.tryAdmit('amber', 911, probe).admit).toBe(true);
        },
      ),
      { numRuns: 60, seed: 20261125 },
    );
  });

  it('quiet hours only hold green and amber', () => {
    const quiet = { enabled: true, start: '23:00', end: '07:00' };
    const atNight = new Date('2026-11-11T23:30:00');
    const atNoon = new Date('2026-11-11T12:00:00');
    expect(isQuietHours(quiet, atNight)).toBe(true);
    expect(isQuietHours(quiet, atNoon)).toBe(false);
    expect(quietAdmission(quiet, 'amber', 310, atNight)).toEqual({ admit: false, reason: 'quiet' });
    expect(quietAdmission(quiet, 'red', 110, atNight).admit).toBe(true);
    expect(quietAdmission(quiet, 'green', 510, atNoon).admit).toBe(true);
    expect(isInQuietRange(60, '23:00', '07:00')).toBe(true);
    expect(isInQuietRange(1380, '23:00', '07:00')).toBe(true);
    expect(isInQuietRange(720, '23:00', '07:00')).toBe(false);
  });
});

describe('BIP-F-41 — a proof of execution never costs attention', () => {
  it('lets a family-8 page through a saturated budget', () => {
    const budget = new AttentionBudget(DEFAULT_BUDGET_POLICY, () => 0);
    // Saturate: six green pages in the hour.
    for (let i = 0; i < 6; i += 1) budget.record('green', 510, i * MINUTE);
    expect(budget.tryAdmit('green', 510, 6 * MINUTE).admit).toBe(false);
    // The receipt of a closed page is not a question: it goes through.
    expect(bypassesAttention('green', 810)).toBe(true);
    expect(budget.tryAdmit('green', 810, 6 * MINUTE).admit).toBe(true);
  });

  it('does not let an ordinary page borrow the exemption', () => {
    expect(bypassesAttention('green', 510)).toBe(false);
    expect(bypassesAttention('green', 110)).toBe(false);
    // Every code of family 8 is exempt, whatever the risk: it is the family
    // that asks nothing, not the risk. The Central refuses a source that
    // declares it (`reserved_code_family`).
    expect(bypassesAttention('amber', 820)).toBe(true);
    expect(bypassesAttention('green', 899)).toBe(true);
    // A red page is exempt for its own reason.
    expect(bypassesAttention('red', 510)).toBe(true);
    expect(bypassesAttention('green', 911)).toBe(true);
  });

  it('charges nothing when a receipt is recorded', () => {
    const budget = new AttentionBudget(DEFAULT_BUDGET_POLICY, () => 0);
    budget.record('green', 810, 0);
    // Six ordinary pages still fit after a receipt was recorded: the receipt
    // did not eat a slot.
    for (let i = 1; i <= 6; i += 1) {
      expect(budget.tryAdmit('green', 510, i * MINUTE).admit).toBe(true);
      budget.record('green', 510, i * MINUTE);
    }
  });
});
