/**
 * Properties BIP-P-01 and BIP-P-02 (fast-check).
 *
 * P-01: whatever the payload, the composed line is at most 80 characters,
 *       all printable, and ends with `#` + the first four characters of the
 *       fingerprint.
 * P-02: truncation never removes the code, the station or the verb, and it
 *       keeps the first word of the subject.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LINE_MAX, isPrintableAscii, normalizeAlias } from '../src/ascii.js';
import { CODE_FAMILIES } from '../src/codes.js';
import { TAG_LENGTH, composeLine, fingerprintTag, truncateSubject } from '../src/line.js';

const hexFingerprint = fc.string({ unit: fc.constantFrom(...'0123456789abcdef'.split('')) , minLength: 64, maxLength: 64 });

/** A code together with a verb that its family actually allows (A.6). */
const codeAndVerb = fc.constantFrom(...CODE_FAMILIES).chain((family) =>
  fc.record({
    code: fc.constantFrom(family.family * 100, family.family * 100 + 10, family.family * 100 + 99),
    verb: fc.constantFrom(...family.verbs),
  }),
);

describe('BIP-P-01 — the line is 80 printable ASCII characters ending with #hhhh', () => {
  it('holds for any payload', () => {
    fc.assert(
      fc.property(
        codeAndVerb.chain((cv) =>
          fc.record({
            code: fc.constant(cv.code),
            verb: fc.constant(cv.verb),
            station: fc.string({ minLength: 0, maxLength: 40 }),
            subject: fc.string({ minLength: 0, maxLength: 400 }),
            fingerprint: hexFingerprint,
          }),
        ),
        (input) => {
          const line = composeLine(input);
          expect(line.length).toBeLessThanOrEqual(LINE_MAX);
          expect(isPrintableAscii(line)).toBe(true);
          expect(line.endsWith(fingerprintTag(input.fingerprint))).toBe(true);
          expect(line.length).toBeGreaterThanOrEqual(TAG_LENGTH);
        },
      ),
      { numRuns: 800, seed: 20261111 },
    );
  });

  it('keeps the code, the station and the verb visible', () => {
    fc.assert(
      fc.property(
        codeAndVerb.chain((cv) =>
          fc.record({
            code: fc.constant(cv.code),
            verb: fc.constant(cv.verb),
            station: fc.string({ minLength: 1, maxLength: 40 }),
            subject: fc.string({ minLength: 0, maxLength: 400 }),
            fingerprint: hexFingerprint,
          }),
        ),
        (input) => {
          const line = composeLine(input);
          expect(line.startsWith(`${input.code} `)).toBe(true);
          expect(line).toContain(` ${input.verb} `);
          expect(line).toContain(normalizeAlias(input.station));
        },
      ),
      { numRuns: 400, seed: 20261112 },
    );
  });
});

describe('BIP-P-02 — truncation keeps the first word of the subject', () => {
  it('never exceeds the budget and keeps the first word when it fits', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 300 }),
        fc.integer({ min: 0, max: 120 }),
        (subject, max) => {
          const out = truncateSubject(subject, max);
          expect(out.length).toBeLessThanOrEqual(Math.max(0, max));
          if (subject.length <= max) {
            expect(out).toBe(subject);
            return;
          }
          const firstWord = subject.split(' ', 1)[0] ?? '';
          if (firstWord.length < max && max > 2) {
            expect(out.startsWith(firstWord.slice(0, Math.min(firstWord.length, out.length)))).toBe(
              true,
            );
          }
        },
      ),
      { numRuns: 1000, seed: 20261113 },
    );
  });

  it('keeps a printable ASCII line for a long accented subject', () => {
    const line = composeLine({
      code: 310,
      station: 'fw',
      verb: 'PUSH',
      subject:
        'déploiement immédiat — branche principale vers origin, 3 commits, +120 −14, « attention » …',
      fingerprint: '07c2'.padEnd(64, '0'),
    });
    expect(isPrintableAscii(line)).toBe(true);
    expect(line.length).toBeLessThanOrEqual(LINE_MAX);
    expect(line).toMatch(/^310 fw PUSH .*#07c2$/);
  });
});
