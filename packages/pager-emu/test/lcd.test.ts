import { describe, expect, it } from 'vitest';
import { lcdRows, pageCodeOf, renderLcd, LCD_COLS, LCD_ROWS } from '../src/lcd.js';

describe('BIP-F-33 — the LCD of the emulator is 4 rows of 20 columns', () => {
  it('lays the line of the page on the screen', () => {
    const rows = lcdRows(['310 fw PUSH main>origin 3 commits']);
    expect(rows).toHaveLength(LCD_ROWS);
    for (const row of rows) expect(row).toHaveLength(LCD_COLS);
    expect(rows[0]).toBe('310 fw PUSH main>ori');
    expect(rows[1]).toBe('gin 3 commits'.padEnd(LCD_COLS));
  });

  it('cuts what does not fit on the screen', () => {
    const rows = lcdRows(['0123456789012345678901234567890123456789']);
    expect(rows).toHaveLength(LCD_ROWS);
    expect(rows[0]).toBe('01234567890123456789');
    expect(rows[1]).toBe('01234567890123456789');
    expect(rows[2]).toBe(''.padEnd(LCD_COLS));
    expect(rows[3]).toBe(''.padEnd(LCD_COLS));
  });

  it('leaves a missing line blank, never short', () => {
    const rows = lcdRows(['310 fw PUSH']);
    expect(rows[0]).toBe('310 fw PUSH'.padEnd(LCD_COLS));
    expect(rows[1]).toBe(''.padEnd(LCD_COLS));
    expect(rows[2]).toBe(''.padEnd(LCD_COLS));
    expect(rows[3]).toBe(''.padEnd(LCD_COLS));
  });

  it('keeps the accents out and the spacing tidy', () => {
    const rows = lcdRows(['310 fw DEPLOY  café  ']);
    expect(rows[0]).toBe('310 fw DEPLOY cafe'.padEnd(LCD_COLS));
  });

  it('frames the screen in a box of twenty columns', () => {
    const frame = renderLcd(['310 fw PUSH']);
    expect(frame).toHaveLength(LCD_ROWS + 2);
    expect(frame[0]).toBe(`┌${'─'.repeat(LCD_COLS)}┐`);
    expect(frame[1]).toBe(`│${'310 fw PUSH'.padEnd(LCD_COLS)}│`);
    expect(frame[LCD_ROWS + 1]).toBe(`└${'─'.repeat(LCD_COLS)}┘`);
  });

  it('reads the code of the page, or nothing', () => {
    expect(pageCodeOf('310 fw PUSH main>origin 3 commits')).toBe(310);
    expect(pageCodeOf('911 a STUCK cannot reach the registry')).toBe(911);
    expect(pageCodeOf('no code here')).toBeNull();
    expect(pageCodeOf('12 fw PUSH too short')).toBeNull();
  });
});
