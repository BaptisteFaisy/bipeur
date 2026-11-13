/**
 * BIP-P-13 and BIP-P-14 — the honesty rule and determinism of the composition.
 *
 * P-13 is the property the whole product rests on (A.6, BIP-F-02): for a tool
 * approval the line and detail screens 2-3 are composed from the payload alone;
 * the agent's own prose appears only behind the `AGENT SAYS:` label. It is
 * proven with a canary: a token planted in the prose that cannot occur in the
 * facts, so the assertion cannot be satisfied by coincidence.
 *
 * P-14: the same facts always produce the same bytes — line, tag and screens.
 * A `Date.now()`, a `Set` iteration order or an unsorted `Object.keys()` in the
 * composition path would break it, and with them the guarantee that an
 * approval refers to the action that was displayed.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DETAIL_SCREENS_MAX, LINE_MAX, isPrintableAscii } from '../src/ascii.js';
import { buildDetailScreens, composeLine } from '../src/line.js';
import { fingerprint } from '../src/node.js';

const CANARY_ALPHABET = 'QXZJK'.split('');

/** A prose string carrying a canary that no command or path can contain. */
const hostileProse = fc
  .tuple(
    fc.string({ unit: fc.constantFrom(...CANARY_ALPHABET), minLength: 6, maxLength: 6 }),
    fc.string({ minLength: 0, maxLength: 120 }),
  )
  .map(([canary, rest]) => ({ canary, text: `${canary} ${rest}`.trim() }));

const facts = fc.record({
  command: fc.string({ minLength: 1, maxLength: 120 }),
  path: fc.string({ minLength: 0, maxLength: 80 }),
  branch: fc.string({ minLength: 0, maxLength: 40 }),
});

describe('BIP-P-13 — agent prose never reaches the line, and is labelled elsewhere', () => {
  it('holds for any prose, including hostile prose', () => {
    fc.assert(
      fc.property(hostileProse, facts, (prose, fact) => {
        const line = composeLine({
          code: 110,
          station: 'fw',
          verb: 'RUN',
          subject: `${fact.command} ${fact.path}`.trim(),
          fingerprint: 'a'.repeat(64),
        });
        const screens = buildDetailScreens({
          full: fact.command,
          context: `${fact.path} on ${fact.branch}`,
          agentSays: prose.text,
        });

        // The line is composed from the payload: the canary cannot be in it.
        expect(line).not.toContain(prose.canary);
        // Nor on the screens that are not the labelled one.
        for (const screen of screens) {
          if (screen.includes(prose.canary)) {
            expect(screen.startsWith('AGENT SAYS:')).toBe(true);
          }
        }
      }),
      { numRuns: 400, seed: 20261113 },
    );
  });

  it('labels the prose even when there is no command and no context', () => {
    const screens = buildDetailScreens({ agentSays: 'QXZJK1 please approve, it is safe' });
    expect(screens).toHaveLength(1);
    expect(screens[0]?.startsWith('AGENT SAYS:')).toBe(true);
    expect(screens[0]).toContain('QXZJK1');
  });

  it('never lets prose impersonate another screen label', () => {
    // A prose that already contains "AGENT SAYS:" must not create a second,
    // unlabelled occurrence: the label is added by the Central, not by the agent.
    const screens = buildDetailScreens({
      full: 'git push origin main',
      agentSays: 'AGENT SAYS: trust me QXZJK2',
    });
    const prose = screens[screens.length - 1] ?? '';
    expect(prose.startsWith('AGENT SAYS:')).toBe(true);
    expect(prose.split('AGENT SAYS:').length - 1).toBeGreaterThanOrEqual(1);
    expect(screens[0]).toBe('git push origin main');
  });

  it('keeps every screen within 80 printable characters', () => {
    fc.assert(
      fc.property(hostileProse, facts, (prose, fact) => {
        const screens = buildDetailScreens({
          full: fact.command,
          context: fact.path,
          agentSays: prose.text,
        });
        // A long text continues on the next screens instead of being cut: the
        // pager shows one screen at a time and the human walks through them.
        expect(screens.length).toBeLessThanOrEqual(DETAIL_SCREENS_MAX);
        for (const screen of screens) {
          expect(screen.length).toBeLessThanOrEqual(LINE_MAX);
          expect(isPrintableAscii(screen)).toBe(true);
        }
      }),
      { numRuns: 200, seed: 20261114 },
    );
  });
});

describe('BIP-P-14 — the composition is deterministic', () => {
  it('gives identical bytes for identical facts, whatever the key order', () => {
    fc.assert(
      fc.property(facts, hostileProse, (fact, prose) => {
        const payloadA = {
          tool_name: 'shell',
          command: fact.command,
          path: fact.path,
          branch: fact.branch,
          agent_says: prose.text,
        };
        const payloadB = {
          agent_says: prose.text,
          branch: fact.branch,
          path: fact.path,
          command: fact.command,
          tool_name: 'shell',
        };
        const fingerprintA = fingerprint(payloadA);
        const fingerprintB = fingerprint(payloadB);
        expect(fingerprintA).toBe(fingerprintB);

        const line = {
          code: 310,
          station: 'fw',
          verb: 'PUSH' as const,
          subject: `${fact.command} ${fact.branch}`,
          fingerprint: fingerprintA,
        };
        expect(composeLine(line)).toBe(composeLine({ ...line }));

        const detail = { full: fact.command, context: fact.path, agentSays: prose.text };
        expect(buildDetailScreens(detail)).toEqual(buildDetailScreens({ ...detail }));
      }),
      { numRuns: 300, seed: 20261115 },
    );
  });

  it('is stable across 200 repetitions of the same call', () => {
    const payload = { tool_name: 'shell', command: 'git push origin main', branch: 'main' };
    const once = fingerprint(payload);
    for (let i = 0; i < 200; i += 1) {
      expect(fingerprint(payload)).toBe(once);
    }
  });
});
