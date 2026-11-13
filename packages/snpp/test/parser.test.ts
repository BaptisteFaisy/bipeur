/**
 * The line parser (RFC 1861 §4.9): commands are matched on their four-letter
 * prefix, case-insensitively, exactly as the RFC spells them.
 */
import { describe, expect, it } from 'vitest';
import { LINE_LIMIT, parse, splitLines } from '../src/parser.js';

describe('parse — four-letter prefix, case-insensitive', () => {
  it.each([
    ['2WAY', '2WAY'],
    ['PAGE lea', 'PAGE'],
    ['PAGEr lea', 'PAGE'],
    ['MESS 310 fw PUSH main #07c2', 'MESS'],
    ['MESSage hello', 'MESS'],
    ['RTYP MULTICHOICE', 'RTYP'],
    ['RTYPe YESNO', 'RTYP'],
    ['MCRE 0001 Approve', 'MCRE'],
    ['MCREsponse 0001 Approve', 'MCRE'],
    ['ACKR 1', 'ACKR'],
    ['ACKRead 1', 'ACKR'],
    ['EXPT 4', 'EXPT'],
    ['EXPTag 4', 'EXPT'],
    ['SEND', 'SEND'],
    ['MSTA 4821 7730', 'MSTA'],
    ['MSTAtus 4821 7730', 'MSTA'],
    ['KTAG 4821 7730', 'KTAG'],
    ['RESE', 'RESET'],
    ['RESEt', 'RESET'],
    ['QUIT', 'QUIT'],
    ['HELP', 'HELP'],
    ['LOGI admin secret', 'LOGIN'],
    ['LOGIn admin secret', 'LOGIN'],
  ])('%s → %s', (line, verb) => {
    const result = parse(line);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.verb).toBe(verb);
  });

  it('keeps the page line intact, inner spacing included', () => {
    const result = parse('MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rest).toBe('310 fw PUSH main>origin 3 commits +120-14 #07c2');
    expect(result.args[0]).toBe('310');
    expect(result.raw).toContain('main>origin');
  });

  it('accepts the spellings the RFC writes and rejects a bad prefix', () => {
    expect(parse('mess hello').ok).toBe(true);
    const bad = parse('MESSX hello');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe(501);
  });

  it.each(['', '   ', 'ZZZZ hello', 'ME', '\u0000\u0001'])(
    'refuses %j with a typed 501 error, never an exception',
    (line) => {
      const result = parse(line);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(501);
        expect(result.error.text.length).toBeGreaterThan(0);
      }
    },
  );

  it('refuses a line longer than the limit', () => {
    const result = parse(`MESS ${'x'.repeat(LINE_LIMIT)}`);
    expect(result.ok).toBe(false);
  });

  it('echoes a printable, short form of the offending line only', () => {
    const result = parse(`${'\u0001'.repeat(40)}ABCDEFGHIJKLMNOPQRSTUVWXYZ`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.raw.length).toBeLessThanOrEqual(16);
  });
});

describe('splitLines — CRLF, LF and a lone CR all end a command', () => {
  it('splits CRLF and keeps the unterminated remainder', () => {
    expect(splitLines('2WAY\r\nMESS hi\r\nSEN')).toEqual({
      lines: ['2WAY', 'MESS hi'],
      rest: 'SEN',
    });
  });

  it('splits on a lone LF, as nc sends it', () => {
    expect(splitLines('2WAY\nSEND\n')).toEqual({ lines: ['2WAY', 'SEND'], rest: '' });
  });

  it('waits for the LF of a CRLF split across two chunks', () => {
    expect(splitLines('2WAY\r')).toEqual({ lines: [], rest: '2WAY\r' });
    expect(splitLines('2WAY\r\n')).toEqual({ lines: ['2WAY'], rest: '' });
  });

  it('handles a lone CR', () => {
    expect(splitLines('2WAY\rSEND\r')).toEqual({ lines: ['2WAY'], rest: 'SEND\r' });
  });
});
