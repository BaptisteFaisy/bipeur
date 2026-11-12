import { describe, expect, it } from 'vitest';
import { keyAction, letterOfCode } from '../src/keys.js';

describe('BIP-F-33 — the keys of the emulator answer the MCResponse codes', () => {
  it('maps a, b, c and d to 0001, 0002, 0003 and 0004', () => {
    expect(keyAction('a')).toEqual({ kind: 'choice', letter: 'A', code: '0001' });
    expect(keyAction('b')).toEqual({ kind: 'choice', letter: 'B', code: '0002' });
    expect(keyAction('c')).toEqual({ kind: 'choice', letter: 'C', code: '0003' });
    expect(keyAction('d')).toEqual({ kind: 'choice', letter: 'D', code: '0004' });
  });

  it('maps 1, 2, 3 and 4 to the same answers', () => {
    expect(keyAction('1')).toEqual({ kind: 'choice', letter: 'A', code: '0001' });
    expect(keyAction('2')).toEqual({ kind: 'choice', letter: 'B', code: '0002' });
    expect(keyAction('3')).toEqual({ kind: 'choice', letter: 'C', code: '0003' });
    expect(keyAction('4')).toEqual({ kind: 'choice', letter: 'D', code: '0004' });
  });

  it('accepts the capitals, and hangs up on q', () => {
    expect(keyAction('A')).toEqual({ kind: 'choice', letter: 'A', code: '0001' });
    expect(keyAction('D')).toEqual({ kind: 'choice', letter: 'D', code: '0004' });
    expect(keyAction('q')).toEqual({ kind: 'quit' });
    expect(keyAction('Q')).toEqual({ kind: 'quit' });
  });

  it('ignores the keys that are not answers', () => {
    expect(keyAction('z')).toEqual({ kind: 'none' });
    expect(keyAction('5')).toEqual({ kind: 'none' });
    expect(keyAction('')).toEqual({ kind: 'none' });
  });

  it('knows the letter of a code', () => {
    expect(letterOfCode('0001')).toBe('A');
    expect(letterOfCode('0004')).toBe('D');
    expect(letterOfCode('0009')).toBeNull();
  });
});
