/**
 * The page line (A.6): `CODE STATION VERB subject #hhhh`, 80 characters max,
 * printable ASCII, composed by the Central from the payload alone (BIP-F-02).
 *
 * Properties covered here: BIP-P-01 and BIP-P-02.
 */
import {
  LINE_MAX,
  normalizeAlias,
  splitScreen,
  toLineText,
  type DetailScreen,
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
 */
export function truncateSubject(subject: string, max: number): string {
  if (max <= 0) return '';
  if (subject.length <= max) return subject;
  const firstWord = subject.split(' ', 1)[0] ?? '';
  if (firstWord.length >= max) return subject.slice(0, max);

  let headLength = Math.ceil((max - 1) / 2);
  if (headLength < firstWord.length) headLength = firstWord.length;
  const tailLength = max - 1 - headLength;
  if (tailLength < 1) return subject.slice(0, max);

  let head = subject.slice(0, headLength);
  const lastSpace = head.lastIndexOf(' ');
  if (lastSpace >= firstWord.length) head = head.slice(0, lastSpace);
  const tail = subject.slice(subject.length - tailLength);
  return `${head}~${tail}`;
}

export function composeHead(code: number, station: string, verb: Verb): string {
  return `${code} ${normalizeAlias(station)} ${verb}`;
}

/**
 * Build the single line shown on the pager. Guarantees:
 * - length <= 80, printable ASCII only;
 * - the last five characters are `#` + the first four of the fingerprint;
 * - code, station and verb are never truncated.
 */
export function composeLine(input: ComposeLineInput): string {
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
  const available = Math.max(0, LINE_MAX - head.length - tag.length - 2);
  const body = truncateSubject(subject, available);
  const line = body.length > 0 ? `${head} ${body} ${tag}` : `${head} ${tag}`;
  return line.slice(0, LINE_MAX);
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
 * Detail screens 2..4 (A.6). Screen 4 is the only place where the agent's own
 * words appear, prefixed with `AGENT SAYS:` — the honesty rule.
 */
export function buildDetailScreens(detail: {
  full?: string;
  context?: string;
  agentSays?: string;
}): string[] {
  const screens: DetailScreen[] = [];
  if (detail.full) screens.push({ label: null, text: detail.full });
  if (detail.context) screens.push({ label: null, text: detail.context });
  if (detail.agentSays) screens.push({ label: 'AGENT SAYS:', text: detail.agentSays });
  return screens.slice(0, 3).map(({ label, text }) => {
    const cleaned = toLineText(label ? `${label} ${text}` : text);
    return cleaned.slice(0, LINE_MAX);
  });
}
