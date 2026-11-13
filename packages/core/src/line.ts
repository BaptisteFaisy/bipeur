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
import type { Verb } from './types.js';

/** `#` + the first four hex characters of the fingerprint. */
export const TAG_LENGTH = 5;

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
 */
export function buildDetailScreens(detail: {
  full?: string;
  context?: string;
  agentSays?: string;
}): string[] {
  const parts: { label: string | null; text: string }[] = [];
  if (detail.full) parts.push({ label: null, text: detail.full });
  if (detail.context) parts.push({ label: null, text: detail.context });
  if (detail.agentSays) parts.push({ label: 'AGENT SAYS:', text: detail.agentSays });

  const screens: string[] = [];
  for (const part of parts) {
    for (const chunk of chunkText(part.text, part.label)) {
      if (screens.length >= DETAIL_SCREENS_MAX) break;
      screens.push(part.label === null ? chunk : `${part.label} ${chunk}`);
    }
  }
  return screens;
}

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
