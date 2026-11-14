/**
 * BIP-F-40 — the diff travels on the page, never in the audit log.
 *
 * The human approves a *change*, not a command: the diff the proposal carries
 * is composed by the Central onto the detail screens, after the facts and
 * before the agent's prose. It is a fact, so the fingerprint covers it — and
 * precisely because it is the payload, it must not enter the append-only log
 * (BIP-N-03): only the fingerprint travels there.
 */
import { fingerprint } from '@bipeur/core/node';
import { describe, expect, it } from 'vitest';
import { sanitizeData } from '../src/audit.js';
import { composeRequest, fingerprintOf } from '../src/compose.js';
import { readRulesFile } from '../src/rules.js';
import { REPO_RULES } from './helpers.js';

const RULES = readRulesFile(REPO_RULES);

const DIFF = [
  'diff --git a/lib/date.ts b/lib/date.ts',
  'index 1234567..89abcde 100644',
  '--- a/lib/date.ts',
  '+++ b/lib/date.ts',
  '@@ -1,2 +1,2 @@',
  '-import dayjs from "dayjs";',
  '+import { DateTime } from "luxon";',
].join('\n');

function compose(diff?: string) {
  return composeRequest(
    {
      kind: 'tool',
      tool_name: 'shell',
      command: 'pnpm build',
      ...(diff ? { diff } : {}),
      agent_says: 'rien de dangereux, promis',
    },
    'fw',
    RULES,
    fingerprint({ x: 1 }),
  );
}

describe('BIP-F-40 — the diff reaches the screens', () => {
  it('prints the stat line and the changed lines under the DIFF label', () => {
    const composed = compose(DIFF);
    const screens = composed.detail.filter((screen) => screen.startsWith('DIFF:'));
    expect(screens.length).toBeGreaterThan(0);
    expect(screens[0]).toContain('+1 -1 in 1 file');
    expect(screens.join(' ')).toContain('import { DateTime } from "luxon";');
  });

  it('sits after the facts and before the agent prose', () => {
    const composed = compose(DIFF);
    const diffAt = composed.detail.findIndex((screen) => screen.startsWith('DIFF:'));
    const proseAt = composed.detail.findIndex((screen) => screen.startsWith('AGENT SAYS:'));
    expect(diffAt).toBeGreaterThanOrEqual(0);
    expect(proseAt).toBeGreaterThan(diffAt);
  });

  it('changes the fingerprint, so a decision cannot be replayed on another diff', () => {
    const one = fingerprintOf({ kind: 'tool', tool_name: 'shell', command: 'x', diff: DIFF });
    const two = fingerprintOf({
      kind: 'tool',
      tool_name: 'shell',
      command: 'x',
      diff: `${DIFF}\n+one more line`,
    });
    expect(one).not.toBe(two);
  });

  it('leaves the page untouched when no diff is carried', () => {
    const composed = compose();
    expect(composed.detail.some((screen) => screen.startsWith('DIFF:'))).toBe(false);
    expect(composed.detail.at(-1)).toContain('AGENT SAYS:');
  });

  it('never lets the diff escape into the audit log', () => {
    // The log carries the fingerprint of the payload, never the payload: the
    // diff is the payload, so the sanitizer drops it as a free-text key.
    const clean = sanitizeData({ fingerprint: 'a'.repeat(64), diff: DIFF, added: 1 });
    expect(clean).toEqual({ fingerprint: 'a'.repeat(64), added: 1 });
    expect(JSON.stringify(clean)).not.toContain('luxon');
  });

  it('never lets the diff into the page line either', () => {
    const composed = compose(DIFF);
    expect(composed.line).not.toContain('luxon');
    expect(composed.line.length).toBeLessThanOrEqual(80);
  });
});
