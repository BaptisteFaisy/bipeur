/**
 * BIP-P-11 — the SNPP parser answers an RFC code for any input line and never
 * throws. Counter-examples are replayed with the seed recorded below.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser.js';
import { REPLIES, RFC_CODES, isRfcCode } from '../src/protocol.js';
import { TagRegistry, Transaction, applyCommand, type TxContext } from '../src/transaction.js';
import { formatSnppStamp } from '../src/protocol.js';

/** Seed recorded so a counter-example can be replayed (testing.md §2). */
const SEED = 1861;
const NUM_RUNS = 500;

function context(): TxContext {
  return {
    now: Date.UTC(2026, 10, 24, 22, 14, 55),
    online: true,
    tags: new TagRegistry(),
    newTag: () => '4821',
    newSecret: () => '7730',
    defaultTtlHours: 0.25,
    maxChoices: 4,
    maxMessageLength: 80,
    credentials: null,
    stamp: (epochMs: number) => formatSnppStamp(epochMs, 1),
  };
}

/** `parse()` guarded by a try/catch: null means it threw, which is a failure. */
function parseOrNull(line: string): ReturnType<typeof parse> | null {
  try {
    return parse(line);
  } catch {
    return null;
  }
}

/** Any byte string, plus the shapes a hostile client actually sends. */
const anyLine = fc.oneof(
  fc.string({ maxLength: 300 }),
  fc.string({ unit: 'binary', maxLength: 300 }),
  fc.uint8Array({ maxLength: 400 }).map((bytes) => Buffer.from(bytes).toString('latin1')),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('2WAY'),
  fc.constant('\u0000\u0001\u0002'),
  fc.string({ minLength: 900, maxLength: 1200 }),
  fc.constantFrom('MESS', 'MESSage', 'messa', 'MESSX', '2WAY', 'RESE', 'LOGI', 'ZZZZ'),
);

describe('BIP-P-11 — the parser answers an RFC code for any input and never throws', () => {
  it('parse() never throws and always yields a command or a 501', () => {
    fc.assert(
      fc.property(anyLine, (line) => {
        // The property: the call returns, it never raises.
        const outcome = parseOrNull(line);
        if (!outcome) return false;
        return outcome.ok ? true : outcome.error.code === REPLIES.SYNTAX.code;
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('the server answers a code from the RFC table for any parsed line', () => {
    fc.assert(
      fc.property(anyLine, (line) => {
        const parsed = parse(line);
        if (!parsed.ok) {
          return isRfcCode(parsed.error.code);
        }
        const outcome = applyCommand(new Transaction(), parsed, context());
        return outcome.replies.every((reply) => isRfcCode(Number(reply.slice(0, 3))));
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('a 2 kB line is refused with 501 rather than buffered', () => {
    const result = parse('MESS '.repeat(600));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(501);
  });

  it('the RFC code table is exactly the documented set', () => {
    expect([...RFC_CODES].sort((a, b) => a - b)).toEqual([
      214, 220, 221, 250, 421, 501, 502, 503, 550, 552, 780, 850, 861, 870, 888, 950,
    ]);
  });
});
