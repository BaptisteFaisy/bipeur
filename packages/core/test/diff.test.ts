/**
 * BIP-F-40 — the page carries the diff, not only the command.
 *
 * The hole this closes: a human approving `git push` approves a *command*, not
 * a *change*. The diff is a fact, so it is composed by the Central and printed
 * on the detail screens — after the facts, before the agent's prose. A diff
 * that cannot fit is cut *with* a marker: a silent cut would let someone
 * believe they had seen the whole change (BIP-F-03, BIP-F-16).
 */
import { describe, expect, it } from 'vitest';
import { DETAIL_SCREENS_MAX, LINE_MAX, isPrintableAscii } from '../src/ascii.js';
import { DIFF_LABEL, diffCharsPerScreen, diffLines, diffStatLine, diffStats } from '../src/diff.js';
import { AGENT_SAYS_LABEL, buildDetailScreens } from '../src/line.js';

const SMALL = [
  'diff --git a/lib/date.ts b/lib/date.ts',
  'index 1234567..89abcde 100644',
  '--- a/lib/date.ts',
  '+++ b/lib/date.ts',
  '@@ -1,3 +1,3 @@',
  '-import dayjs from "dayjs";',
  '+import { DateTime } from "luxon";',
].join('\n');

describe('reading a diff', () => {
  it('counts what is added, removed, and in how many files', () => {
    expect(diffStats(SMALL)).toEqual({ added: 1, removed: 1, files: 1 });
  });

  it('keeps the changed lines and drops the file-location noise', () => {
    const lines = diffLines(SMALL);
    expect(lines).toContain('-import dayjs from "dayjs";');
    expect(lines.some((line) => line.startsWith('diff --git'))).toBe(false);
    expect(lines.some((line) => line.startsWith('index '))).toBe(false);
  });

  it('says the stat line the human reads first', () => {
    expect(diffStatLine({ added: 120, removed: 14, files: 3 })).toBe('+120 -14 in 3 files');
    expect(diffStatLine({ added: 0, removed: 0, files: 0 })).toBe('+0 -0');
  });
});

describe('the diff on the detail screens', () => {
  it('is printed under its own label, after the facts', () => {
    const screens = buildDetailScreens({
      full: 'pnpm build',
      context: 'on main',
      diff: SMALL,
      agentSays: 'je promets que ça marche',
    });
    const labelled = screens.filter((s) => s.startsWith('DIFF:'));
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled[0]).toContain('+1 -1 in 1 file');
    const diffAt = screens.findIndex((s) => s.startsWith('DIFF:'));
    const proseAt = screens.findIndex((s) => s.startsWith(AGENT_SAYS_LABEL));
    expect(diffAt).toBeLessThan(proseAt);
  });

  it('never exceeds one screen width, and stays printable ASCII', () => {
    const screens = buildDetailScreens({ full: 'x', diff: SMALL });
    for (const screen of screens) {
      expect(screen.length).toBeLessThanOrEqual(LINE_MAX);
      expect(isPrintableAscii(screen)).toBe(true);
    }
  });

  it('spans several screens when it is long, and marks the cut', () => {
    const big = `--- a/x\n+++ b/x\n${Array.from({ length: 400 }, (_, i) => `+line ${i} qui ajoute du texte long`).join('\n')}`;
    const screens = buildDetailScreens({ full: 'pnpm build', diff: big });
    const diffScreens = screens.filter((s) => s.startsWith('DIFF:'));
    expect(diffScreens.length).toBeGreaterThan(1);
    expect(diffScreens.length).toBeLessThanOrEqual(6);
    expect(diffScreens.at(-1)).toContain('~');
    expect(screens.length).toBeLessThanOrEqual(DETAIL_SCREENS_MAX);
  });

  it('leaves room for the agent prose instead of eating every screen', () => {
    const big = Array.from({ length: 900 }, (_, i) => `+ligne ${i} de diff qui s\u2019étale`).join('\n');
    const screens = buildDetailScreens({ diff: big, agentSays: 'prose de l\u2019agent' });
    expect(screens.some((s) => s.startsWith(AGENT_SAYS_LABEL))).toBe(true);
  });

  it('adds nothing when there is no diff', () => {
    const screens = buildDetailScreens({ full: 'pnpm build' });
    expect(screens.some((s) => s.startsWith('DIFF:'))).toBe(false);
  });
});

describe('the budget the Central and the composer agree on', () => {
  it('is one screen minus the label and its space', () => {
    expect(diffCharsPerScreen(LINE_MAX)).toBe(LINE_MAX - DIFF_LABEL.length - 1);
    expect(DIFF_LABEL).toBe('DIFF:');
  });
});
