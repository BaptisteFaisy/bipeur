/**
 * The diff a proposal carries (BIP-F-40).
 *
 * Until now the human approved a *command*; the diff says what actually moves.
 * It is a fact, not prose: it enters the fingerprint (see `factsOf` in the
 * Central), so a decision signed on one diff can never be replayed on another.
 *
 * This module is the reading side only: count the change, keep the lines that
 * show it, and say how much room the screens leave. Composing the screens — and
 * marking a cut — belongs to `line.js`, which owns `truncateSubject`.
 *
 * Pure module: no Node API, safe in the browser bundle.
 */
import { normalizeSpacing, toAscii } from './ascii.js';

/** The label every diff screen carries, so a human knows what they are reading. */
export const DIFF_LABEL = 'DIFF:';

export interface DiffStats {
  added: number;
  removed: number;
  files: number;
}

/** Lines that locate a file rather than show a change — dropped from the screens. */
const NOISE = /^(diff --git |index |new file mode |deleted file mode |similarity index |rename from |rename to |copy from |copy to )/;

function rawLines(diff: string): string[] {
  return diff.split('\n').map((line) => line.replace(/\r$/, ''));
}

/** What a diff says out loud: how much is added, removed, in how many files. */
export function diffStats(diff: string): DiffStats {
  let added = 0;
  let removed = 0;
  let files = 0;
  for (const line of rawLines(diff)) {
    if (line.startsWith('diff --git ')) files += 1;
    else if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed, files };
}

/** The changed lines only, as printable ASCII, in their original order. */
export function diffLines(diff: string): string[] {
  const lines: string[] = [];
  for (const line of rawLines(diff)) {
    if (NOISE.test(line)) continue;
    const clean = toAscii(line).trim();
    if (clean.length > 0) lines.push(clean);
  }
  return lines;
}

/** `+120 -14 in 3 files` — the stat line a human reads first. */
export function diffStatLine(stats: DiffStats): string {
  const parts = [`+${stats.added}`, `-${stats.removed}`];
  if (stats.files > 0) parts.push(`in ${stats.files} file${stats.files === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Characters one screen holds once the `DIFF ` label is printed on it. */
export function diffCharsPerScreen(lineMax: number): number {
  return Math.max(1, lineMax - DIFF_LABEL.length - 1);
}

export interface DiffScreens {
  /** Screen contents, without the label: the stat line first, then the lines. */
  screens: string[];
  /** Changed lines that did not fit — the caller must say so on the screen. */
  omitted: number;
}

/**
 * Pack the changed lines into at most `room` screens of `perScreen` characters,
 * whole lines only: a line split across two rows of a 4 × 20 LCD is unreadable.
 *
 * Whatever does not fit is counted, never dropped in silence — the caller marks
 * the cut on the last screen (BIP-F-03, BIP-F-16).
 */
export function diffScreens(diff: string, room: number, perScreen: number): DiffScreens {
  const lines = diffLines(diff);
  if (lines.length === 0 || room <= 0) return { screens: [], omitted: 0 };
  const screens = [diffStatLine(diffStats(diff)).slice(0, perScreen)];
  let next = 0;
  while (next < lines.length && screens.length < room) {
    const line = lines[next]!;
    const last = screens[screens.length - 1]!;
    if (last.length + 1 + line.length <= perScreen) {
      screens[screens.length - 1] = `${last} ${line}`;
      next += 1;
      continue;
    }
    if (line.length <= perScreen) {
      screens.push(line);
      next += 1;
      continue;
    }
    screens.push(line.slice(0, perScreen - 1) + '~');
    next += 1;
  }
  return { screens, omitted: lines.length - next };
}

/** Normalises a diff the way the screens do (shared by tests and docs). */
export function normalizeDiff(diff: string): string {
  return normalizeSpacing(toAscii(diff));
}
