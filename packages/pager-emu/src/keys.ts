/**
 * The keys of a pager. Four answers and the way out — nothing else.
 *
 * `a`/`1` answers A (`MCR 0001`), `b`/`2` B, `c`/`3` C, `d`/`4` D, and `q`
 * hangs up (`QUIT`). The mapping is pure, so the test never opens a terminal.
 */

/** The letters the pager shows, in the order of the MCResponse codes. */
export const CHOICE_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** The MCResponse codes of the contract: `0001` is A, `0004` is D. */
export const MCR_CODES = ['0001', '0002', '0003', '0004'] as const;

export type ChoiceLetter = (typeof CHOICE_LETTERS)[number];
export type McrCode = (typeof MCR_CODES)[number];

/** What a key press asks for. */
export type KeyAction =
  | { kind: 'choice'; letter: ChoiceLetter; code: McrCode }
  | { kind: 'quit' }
  | { kind: 'none' };

const LETTER_BY_KEY: Readonly<Record<string, ChoiceLetter>> = {
  a: 'A',
  b: 'B',
  c: 'C',
  d: 'D',
  '1': 'A',
  '2': 'B',
  '3': 'C',
  '4': 'D',
};

/**
 * The answer a key asks for, or `none` when the key is not one of ours.
 * Uppercase letters are accepted: a pager has no shift key, but a terminal has.
 */
export function keyAction(key: string): KeyAction {
  if (key === 'q' || key === 'Q') return { kind: 'quit' };
  const letter = LETTER_BY_KEY[key.toLowerCase()];
  if (letter === undefined) return { kind: 'none' };
  const index = CHOICE_LETTERS.indexOf(letter);
  return { kind: 'choice', letter, code: MCR_CODES[index] ?? '0001' };
}

/** The letter a MCResponse code stands for (`0003` → C), or null. */
export function letterOfCode(code: string): ChoiceLetter | null {
  const index = MCR_CODES.indexOf(code as McrCode);
  return index === -1 ? null : CHOICE_LETTERS[index];
}
