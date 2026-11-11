/**
 * BIP-P-15 and BIP-P-16 — the format holds on degenerate input, and the
 * fingerprint is faithful.
 *
 * P-15 generalises BIP-P-01/02 to the cases nobody writes down: empty or
 * single-character-huge subjects, unknown or out-of-range codes, verbs outside
 * the closed list, fingerprints shorter than four characters, whitespace-only
 * subjects, subjects already ending in something that looks like `#abcd`.
 *
 * P-16 is what makes promise O4 checkable at all: if the fingerprint does not
 * discriminate two different facts, the signature protects nothing.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LINE_MAX, isPrintableAscii } from '../src/ascii.js';
import { composeLine, fingerprintTag, truncateSubject } from '../src/line.js';
import { canonicalize } from '../src/canonical.js';
import { fingerprint } from '../src/node.js';
import { VERBS } from '../src/types.js';

/** Codes that are NOT in any family: the composer must fall back, not crash. */
const invalidCodes = [0, -1, 42, 99, 1000, 99999, Number.NaN, Number.POSITIVE_INFINITY, 3.5];

const anyStation = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant('a'),
  fc.string({ minLength: 0, maxLength: 40 }),
  fc.constant('🦀🦀🦀'),
  fc.constant('poste très long'),
);

const anySubject = fc.oneof(
  fc.constant(''),
  fc.constant(' '),
  fc.constant('   \t\n  '),
  fc.constant('a'),
  fc.constant('x'.repeat(5000)),
  fc.string({ minLength: 0, maxLength: 400 }),
  fc.constant('#abcd'),
  fc.constant('deploy #abcd'),
  fc.constant('git push origin main #ffff'),
  fc.constant('\u0000\u0007\u001b[31m red'),
);

const anyFingerprint = fc.oneof(
  fc.constant(''),
  fc.constant('abc'),
  fc.constant('a'.repeat(64)),
  fc.string({ unit: fc.constantFrom(...'0123456789abcdef'.split('')), minLength: 0, maxLength: 64 }),
);

const anyVerb = fc.oneof(fc.constantFrom(...VERBS), fc.constant('NOPE'), fc.constant(''), fc.constant('run'));

describe('BIP-P-15 — the format holds on every degenerate input', () => {
  it('never exceeds 80 printable ASCII characters ending with the tag', () => {
    fc.assert(
      fc.property(anyStation, anySubject, anyFingerprint, anyVerb, fc.integer(), (station, subject, fp, verb, code) => {
        const line = composeLine({ code, station, verb, subject, fingerprint: fp });
        expect(line.length).toBeLessThanOrEqual(LINE_MAX);
        expect(isPrintableAscii(line)).toBe(true);
        // The last five characters are reserved for the tag (A.6).
        expect(line.endsWith(fingerprintTag(fp))).toBe(true);
        // No doubled, leading or trailing space: the screen is 4 × 20 columns.
        expect(line).not.toMatch(/ {2}/);
        expect(line).toBe(line.trim());
      }),
      { numRuns: 800, seed: 20261116 },
    );
  });

  it('falls back to a valid code and verb instead of printing garbage', () => {
    for (const code of invalidCodes) {
      const line = composeLine({ code, station: 'fw', verb: 'RUN', subject: 'ls', fingerprint: 'a'.repeat(64) });
      const printed = Number(line.split(' ')[0]);
      expect(Number.isInteger(printed)).toBe(true);
      expect(printed).toBeGreaterThanOrEqual(100);
      expect(printed).toBeLessThanOrEqual(999);
      expect(line.length).toBeLessThanOrEqual(LINE_MAX);
    }
  });

  it('never prints a verb outside the closed list', () => {
    fc.assert(
      fc.property(anyVerb, fc.constantFrom(110, 310, 510, 911), (verb, code) => {
        const line = composeLine({ code, station: 'fw', verb, subject: 'ls -la', fingerprint: 'b'.repeat(64) });
        const printed = line.split(' ')[2] ?? '';
        expect(VERBS).toContain(printed as (typeof VERBS)[number]);
      }),
      { numRuns: 200, seed: 20261117 },
    );
  });

  it('keeps the station to six characters and never empty', () => {
    fc.assert(
      fc.property(anyStation, (station) => {
        const line = composeLine({ code: 110, station, verb: 'RUN', subject: 'ls', fingerprint: 'c'.repeat(64) });
        const printed = line.split(' ')[1] ?? '';
        expect(printed.length).toBeGreaterThan(0);
        expect(printed.length).toBeLessThanOrEqual(6);
        expect(isPrintableAscii(printed)).toBe(true);
      }),
      { numRuns: 300, seed: 20261118 },
    );
  });

  it('truncation is idempotent and never invents characters', () => {
    fc.assert(
      fc.property(anySubject, fc.integer({ min: 0, max: 200 }), (subject, max) => {
        const once = truncateSubject(subject, max);
        expect(truncateSubject(once, max)).toBe(once);
        for (const ch of once) {
          if (ch !== '~') expect(subject).toContain(ch);
        }
      }),
      { numRuns: 500, seed: 20261119 },
    );
  });
});

describe('BIP-P-16 — the fingerprint is faithful and discriminating', () => {
  const base = {
    tool_name: 'shell',
    command: 'git push origin main',
    path: 'packages/core',
    branch: 'main',
    stats: '3 commits +120-14',
  };

  it('differs when a single fact changes by one character', () => {
    const reference = fingerprint(base);
    const variants = [
      { ...base, command: 'git push origin maiN' },
      { ...base, command: 'git push origin main ' },
      { ...base, path: 'packages/cores' },
      { ...base, branch: 'Main' },
      { ...base, stats: '3 commits +120-15' },
      { ...base, tool_name: 'shelL' },
      { ...base, extra: '' },
      { ...base, extra: undefined },
    ];
    for (const variant of variants.slice(0, 7)) {
      expect(fingerprint(variant)).not.toBe(reference);
    }
    // An explicit `undefined` is the same fact as an absent key.
    expect(fingerprint(variants[7])).toBe(reference);
  });

  it('is identical for semantically identical payloads', () => {
    const reordered = {
      stats: base.stats,
      branch: base.branch,
      path: base.path,
      command: base.command,
      tool_name: base.tool_name,
    };
    expect(fingerprint(reordered)).toBe(fingerprint(base));
    expect(canonicalize(reordered)).toBe(canonicalize(base));
  });

  it('is a 64-character lowercase hex string for any payload', () => {
    fc.assert(
      fc.property(fc.anything(), (payload) => {
        expect(fingerprint(payload)).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 400, seed: 20261120 },
    );
  });

  it('discriminates distinct payloads almost surely', () => {
    const seen = new Map<string, string>();
    let collisions = 0;
    for (let i = 0; i < 500; i += 1) {
      const payload = { command: `cmd-${i}`, index: i, flag: i % 2 === 0 };
      const digest = fingerprint(payload);
      const previous = seen.get(digest);
      if (previous !== undefined && previous !== JSON.stringify(payload)) collisions += 1;
      seen.set(digest, JSON.stringify(payload));
    }
    expect(collisions).toBe(0);
  });
});
