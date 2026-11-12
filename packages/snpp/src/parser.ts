/**
 * The line parser (RFC 1861 §4.9, BIP-P-11).
 *
 * The parser **never throws**: every input line, however malformed, binary or
 * long, produces either a command or a typed error carrying an RFC code. That
 * is the whole point of property BIP-P-11 — a 1995 client may send anything.
 */
import { stripNonPrintable } from '@bipeur/core';
import {
  COMMAND_PREFIX_LENGTH,
  commandFor,
  REPLIES,
  unitCommandFor,
  type CommandId,
  type UnitCommandId,
} from './protocol.js';

/** A line longer than this is refused instead of being buffered (BIP-P-11). */
export const LINE_LIMIT = 1024;

export interface ParsedCommand {
  /** Four-letter command id, e.g. `MESS`, `RESE`. */
  verb: CommandId;
  /** The rest of the line, inner spacing preserved: the page line lives here. */
  rest: string;
  /** `rest` split on whitespace; empty tokens removed. */
  args: string[];
  /** The line as received, without its terminator. */
  raw: string;
}

export interface ParseError {
  /** RFC code describing the refusal: always 501 in practice. */
  code: number;
  text: string;
  raw: string;
}

export type ParseResult = ({ ok: true } & ParsedCommand) | { ok: false; error: ParseError };

/** Echo at most this many characters of a rejected line back to the client. */
const ECHO_LIMIT = 16;

function failure(raw: string, text: string): ParseResult {
  return { ok: false, error: { code: REPLIES.SYNTAX.code, text, raw: sanitize(raw) } };
}

/** Printable-ASCII, short form of an arbitrary input, safe to echo. */
function sanitize(raw: string): string {
  return stripNonPrintable(raw).trim().slice(0, ECHO_LIMIT);
}

/**
 * Split a buffer into complete lines and the unterminated remainder.
 * CRLF, LF and a lone CR all terminate a line: `nc` sends one of them.
 */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const char = buffer[i];
    if (char !== '\n' && char !== '\r') continue;
    // A trailing CR may be the first half of a CRLF split across two chunks.
    if (char === '\r' && i === buffer.length - 1) break;
    lines.push(buffer.slice(start, i));
    if (char === '\r' && buffer[i + 1] === '\n') i += 1;
    start = i + 1;
  }
  return { lines, rest: buffer.slice(start) };
}

/** Strip the terminator and the surrounding blanks from a received line. */
function cleanLine(raw: string): string {
  return raw.replace(/^[\s\r\n]+/, '').replace(/[\s\r\n]+$/, '');
}

/**
 * Parse one line. Never throws: an unusable line comes back as a 501 error.
 */
export function parse(raw: string): ParseResult {
  if (typeof raw !== 'string') return failure('', 'empty command line');
  const line = cleanLine(raw);
  if (line.length === 0) return failure(raw, 'empty command line');
  if (line.length > LINE_LIMIT) return failure(raw, `line longer than ${LINE_LIMIT} bytes`);

  const space = line.search(/\s/);
  const token = (space === -1 ? line : line.slice(0, space)).toLowerCase();
  if (token.length < COMMAND_PREFIX_LENGTH) return failure(raw, `unknown command '${sanitize(token)}'`);

  // The RFC matches on the four-letter prefix; the rest of the token, when the
  // client spells the command out (`MESSage`), must still be a prefix of it.
  const spec = commandFor(token.slice(0, COMMAND_PREFIX_LENGTH).toUpperCase());
  if (!spec || !spec.canonical.toLowerCase().startsWith(token)) {
    return failure(raw, `unknown command '${sanitize(token)}'`);
  }

  const rest = space === -1 ? '' : line.slice(space).trim();
  return {
    ok: true,
    verb: spec.id,
    rest,
    args: rest.length === 0 ? [] : rest.split(/\s+/),
    raw,
  };
}

/** Convenience for callers that only want the outcome code of a rejected line. */
export function parseErrorCode(result: ParseResult): number | null {
  return result.ok ? null : result.error.code;
}

/** One command of the unit channel: `UNIT <capcode>` or `MCR <code>`. */
export interface UnitCommand {
  verb: UnitCommandId;
  /** The rest of the line, inner spacing preserved. */
  rest: string;
  /** `rest` split on whitespace; empty tokens removed. */
  args: string[];
  /** The line as received, without its terminator. */
  raw: string;
}

/**
 * Parse a line of the *unit* channel. `null` when the line is not one: the
 * terminal vocabulary applies then, and the session stays a terminal.
 *
 * The two verbs never collide with the terminal ones: `MCREsponse` keeps its
 * four-letter prefix, and `MCR` is too short to be a terminal command.
 */
export function parseUnit(raw: string): UnitCommand | null {
  if (typeof raw !== 'string') return null;
  const line = cleanLine(raw);
  if (line.length === 0) return null;
  const space = line.search(/\s/);
  const token = (space === -1 ? line : line.slice(0, space)).toUpperCase();
  const verb = unitCommandFor(token);
  if (!verb) return null;
  const rest = space === -1 ? '' : line.slice(space).trim();
  return {
    verb,
    rest,
    args: rest.length === 0 ? [] : rest.split(/\s+/),
    raw,
  };
}
