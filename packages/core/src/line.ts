/**
 * The page line (A.6): `CODE STATION VERB subject #hhhh`, 80 characters max,
 * printable ASCII, composed by the Central from the payload alone (BIP-F-02).
 *
 * Properties covered here: BIP-P-01 and BIP-P-02.
 */
import {
  DETAIL_SCREENS_MAX,
  LINE_MAX,
  normalizeAlias,
  splitScreen,
  toLineText,
} from './ascii.js';
import { defaultVerbForCode, isValidCode, verbMatchesCode } from './codes.js';
import {
  DIFF_LABEL,
  diffCharsPerScreen,
  diffScreens,
} from './diff.js';
import type { Verb } from './types.js';

/** `#` + the first four hex characters of the fingerprint. */
export const TAG_LENGTH = 5;

/** The only label allowed to carry the agent's own words (A.6, honesty rule). */
export const AGENT_SAYS_LABEL = 'AGENT SAYS:';

/** How many screens the diff may occupy at most, prose aside (BIP-F-40). */
const DIFF_SCREENS_MAX = 6;

export interface ComposeLineInput {
  code: number;
  station: string;
  verb?: Verb | string;
  subject: string;
  fingerprint: string;
}

export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 4);
}

export function fingerprintTag(fingerprint: string): string {
  return `#${shortFingerprint(fingerprint)}`;
}

/**
 * Truncate in the middle with `~`, never cutting the first word when it fits.
 * Always returns at most `max` characters.
 *
 * The marker is never optional: a subject that does not fit is cut *and said
 * to be cut*. A silent cut looks like a complete line — the human decides on a
 * line they believe is whole (BIP-F-03, read by a person and not by a test).
 */
export function truncateSubject(subject: string, max: number): string {
  if (max <= 0) return '';
  if (subject.length <= max) return subject;
  const firstWord = subject.split(' ', 1)[0] ?? '';
  // A single word longer than the budget: cut it, but mark the cut.
  if (firstWord.length >= max) return `${subject.slice(0, max - 1)}~`;

  let headLength = Math.ceil((max - 1) / 2);
  if (headLength < firstWord.length) headLength = firstWord.length;
  const tailLength = max - 1 - headLength;
  if (tailLength < 1) return `${subject.slice(0, max - 1)}~`;

  let head = subject.slice(0, headLength);
  const lastSpace = head.lastIndexOf(' ');
  if (lastSpace >= firstWord.length) head = head.slice(0, lastSpace);
  const tail = subject.slice(subject.length - tailLength);
  return `${head}~${tail}`;
}

export function composeHead(code: number, station: string, verb: Verb): string {
  return `${code} ${normalizeAlias(station)} ${verb}`;
}

/** How many characters of the subject fit in the line, head and tag excluded. */
export function subjectBudget(code: number, station: string, verb: Verb): number {
  const head = composeHead(isValidCode(code) ? code : 100, station, verb);
  return Math.max(0, LINE_MAX - head.length - TAG_LENGTH - 2);
}

export interface ComposedLine {
  line: string;
  /** True when the subject did not fit and was cut. */
  truncated: boolean;
}

/**
 * Build the single line shown on the pager. Guarantees:
 * - length <= 80, printable ASCII only;
 * - the last five characters are `#` + the first four of the fingerprint;
 * - code, station and verb are never truncated.
 *
 * `composeLineDetailed` also says whether the subject was cut, so the caller
 * can carry the full text on the detail screens instead of losing it.
 */
export function composeLineDetailed(input: ComposeLineInput): ComposedLine {
  const code = isValidCode(input.code) ? input.code : 100;
  const verb = resolveVerb(input.verb, code);
  const head = composeHead(code, input.station, verb);
  const tag = fingerprintTag(input.fingerprint);
  const subject = toLineText(input.subject);
  // Two separators, not one: `head` + ' ' + body + ' ' + tag. Counting a single
  // space let a one-word subject overflow to 81 characters, and the final
  // slice then cut the fingerprint tag away — losing the very link between the
  // displayed line and the signed payload (found by BIP-P-15, seed 20261116,
  // counter-example: empty station, a 5000-character single-word subject).
  const available = subjectBudget(code, input.station, verb);
  const truncated = subject.length > available;
  const body = truncateSubject(subject, available);
  const line = body.length > 0 ? `${head} ${body} ${tag}` : `${head} ${tag}`;
  return { line: line.slice(0, LINE_MAX), truncated };
}

export function composeLine(input: ComposeLineInput): string {
  return composeLineDetailed(input).line;
}

function resolveVerb(verb: Verb | string | undefined, code: number): Verb {
  if (verb && verbMatchesCode(verb as Verb, code)) return verb as Verb;
  return defaultVerbForCode(code);
}

/** The four rows of 20 columns the pager screen shows. */
export function lineRows(line: string): string[] {
  return splitScreen(line);
}

/**
 * Detail screens 2..N (A.6). The last one is the only place where the agent's
 * own words appear, prefixed with `AGENT SAYS:` — the honesty rule.
 *
 * A text longer than one screen CONTINUES on the next screens instead of being
 * cut: the pager shows one screen at a time and the human walks through them.
 * Nothing the human was asked to decide may disappear (BIP-F-16).
 *
 * The diff a proposal carries (BIP-F-40) sits between the facts and the prose:
 * `fait → diff → AGENT SAYS:`. It is capped to its own screens so the agent's
 * words are never starved, and a diff that cannot fit is cut *with* a marker.
 */
export function buildDetailScreens(detail: {
  full?: string;
  context?: string;
  diff?: string;
  agentSays?: string;
}): string[] {
  const screens: string[] = [];
  for (const part of [
    { label: null as string | null, text: detail.full },
    { label: null as string | null, text: detail.context },
  ]) {
    if (!part.text) continue;
    for (const chunk of chunkText(part.text, part.label)) {
      if (screens.length >= DETAIL_SCREENS_MAX) break;
      screens.push(chunk);
    }
  }
  const room = Math.min(
    DIFF_SCREENS_MAX,
    DETAIL_SCREENS_MAX - screens.length - (detail.agentSays ? 1 : 0),
  );
  if (detail.diff) pushDiffScreens(screens, detail.diff, room);
  if (detail.agentSays) {
    for (const chunk of chunkText(detail.agentSays, AGENT_SAYS_LABEL)) {
      if (screens.length >= DETAIL_SCREENS_MAX) break;
      screens.push(`${AGENT_SAYS_LABEL} ${chunk}`);
    }
  }
  return screens;
}

/**
 * The diff screens, labelled `DIFF:`, with the cut said out loud when lines did
 * not fit: the human sees how many lines are missing, never a silent end.
 */
function pushDiffScreens(screens: string[], diff: string, room: number): void {
  if (room <= 0) return;
  const packed = diffScreens(diff, room, diffCharsPerScreen(LINE_MAX));
  for (const screen of packed.screens) {
    screens.push(`${DIFF_LABEL} ${screen}`);
  }
  if (packed.omitted <= 0) return;
  const note = ` +${packed.omitted} more line${packed.omitted === 1 ? '' : 's'}`;
  const cap = LINE_MAX - DIFF_LABEL.length - 1 - note.length;
  const last = screens[screens.length - 1]!;
  const kept = last.length > cap ? truncateSubject(last.slice(DIFF_LABEL.length + 1), cap) : last.slice(DIFF_LABEL.length + 1);
  screens[screens.length - 1] = `${DIFF_LABEL} ${kept}~${note}`;
}

/** The diff as one text: the stat line first, then the changed lines. */
/** Split a text into screens of at most 80 characters, at a word boundary. */
function chunkText(text: string, label: string | null): string[] {
  const clean = toLineText(text);
  const max = LINE_MAX - (label === null ? 0 : label.length + 1);
  if (max <= 0) return [clean.slice(0, LINE_MAX)];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    const cut = boundary(rest, max);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** The last space before the limit; the limit itself when there is none. */
function boundary(text: string, max: number): number {
  const space = text.lastIndexOf(' ', max);
  return space > 0 ? space : max;
}
