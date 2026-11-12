/**
 * The screen of a pager: **4 rows of 20 columns**, printable ASCII only
 * (A.6, BIP-N-08). The capacity of the real thing, not a guideline: what
 * does not fit is cut, and what is missing stays blank.
 *
 * The rendering is pure — no terminal, no ANSI — so a test can assert the
 * grid character by character.
 */
import { LINE_COLS, LINE_ROWS, normalizeSpacing, splitScreen, toAscii } from '@bipeur/core';

/** Columns of the LCD: 20, like an alphanumeric pager of 1995. */
export const LCD_COLS = LINE_COLS;

/** Rows of the LCD: 4. */
export const LCD_ROWS = LINE_ROWS;

/** A row of the screen: exactly 20 characters, spaces included. */
export type LcdRow = string;

/**
 * Lay the lines of a page on the screen.
 *
 * - a line longer than 20 characters is cut at the 20th;
 * - a line longer than one row continues on the next row;
 * - what does not fit in 4 rows is dropped (the pager has no scrollback);
 * - a missing line is a blank row, never a shorter row.
 */
export function lcdRows(lines: readonly string[]): LcdRow[] {
  const rows: LcdRow[] = [];
  for (const line of lines) {
    for (const row of splitScreen(normalizeSpacing(toAscii(line)))) {
      if (rows.length >= LCD_ROWS) return padRows(rows);
      rows.push(row.padEnd(LCD_COLS, ' '));
    }
  }
  return padRows(rows);
}

/** Always four rows of twenty columns: the missing ones are blank. */
function padRows(rows: LcdRow[]): LcdRow[] {
  const padded = rows.slice(0, LCD_ROWS).map((row) => row.padEnd(LCD_COLS, ' '));
  while (padded.length < LCD_ROWS) padded.push(''.padEnd(LCD_COLS, ' '));
  return padded;
}

/** The frame of the LCD, box included — what the terminal shows. */
export function renderLcd(lines: readonly string[]): string[] {
  const border = `┌${'─'.repeat(LCD_COLS)}┐`;
  const bottom = `└${'─'.repeat(LCD_COLS)}┘`;
  const body = lcdRows(lines).map((row) => `│${row}│`);
  return [border, ...body, bottom];
}

/**
 * The three-digit code of a page line (`310 fw PUSH …` → 310), or null when
 * the line does not carry one. The code is never truncated, so it is read
 * before anything else.
 */
export function pageCodeOf(line: string): number | null {
  const match = /^(\d{3})\s/.exec(line.trim());
  if (!match) return null;
  const code = Number(match[1]);
  return code >= 100 && code <= 999 ? code : null;
}
