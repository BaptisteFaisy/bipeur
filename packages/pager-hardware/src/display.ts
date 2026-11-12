/**
 * The screen of the hardware pager: one `DisplayDriver` and two realities.
 *
 * `MockDisplay` prints the rows to stdout so the whole machine is testable on
 * a laptop. `CharLcdDisplay` drives a real HD44780 through an injected
 * `LcdWriter` — by default a shell-out to the bundled Python helper, so the
 * package needs no native npm module. The layout itself is pure: 20×4 or
 * 16×2, printable ASCII only, truncated to the real capacity of the glass.
 */
import { normalizeSpacing, toAscii, type Risk } from '@bipeur/core';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Columns of a 20×4 LCD. */
export const LCD_COLS_20 = 20;
export const LCD_ROWS_20 = 4;
/** Columns of a 16×2 LCD. */
export const LCD_COLS_16 = 16;
export const LCD_ROWS_16 = 2;

/** A driver paints rows of characters. Rows are already laid out. */
export interface DisplayDriver {
  write(rows: string[]): void;
}

/** What is on the glass: the page, or nothing, plus the machine's status. */
export interface ScreenModel {
  page: PendingPageView | null;
  status: string;
}

/** The slice of a page the screen needs. */
export interface PendingPageView {
  pageId: string;
  line: string;
  code: number;
  risk: Risk;
  fingerprint: string;
  options: { code: string; label: string }[];
}

export interface LayoutOptions {
  cols: number;
  rows: number;
  /** The current state of the machine, e.g. `waiting` or `decided`. */
  phase: string;
}

/** The lamp: `[G]`/`[A]`/`[R]` — the HD44780 has no colour, only state. */
export function lampOf(risk: Risk): string {
  if (risk === 'green') return 'G';
  if (risk === 'amber') return 'A';
  return 'R';
}

/** Truncate or pad to exactly `cols` printable ASCII characters. */
export function fit(text: string, cols: number): string {
  return toAscii(normalizeSpacing(text)).slice(0, cols).padEnd(cols, ' ');
}

/** The four-letter tag of a fingerprint (`#a1b2`). */
function tagOf(fingerprint: string): string {
  return `#${fingerprint.slice(0, 4)}`;
}

/** Lay a page on a 20×4 grid. */
function layoutFour(page: PendingPageView, phase: string): string[] {
  const choices = page.options.length > 0
    ? page.options.map((option) => `${option.code} ${option.label}`).join('  ')
    : 'A approve  B deny';
  return [
    fit(page.line, LCD_COLS_20),
    fit(`[${lampOf(page.risk)}] ${page.risk.toUpperCase()}  ${phase}`, LCD_COLS_20),
    fit(choices, LCD_COLS_20),
    fit(`code ${page.code} ${tagOf(page.fingerprint)}`, LCD_COLS_20),
  ];
}

/** Lay a page on a 16×2 grid: line + lamp + choices, as compact as it gets. */
function layoutTwo(page: PendingPageView): string[] {
  const choices = page.options.length > 0
    ? page.options.map((option) => `${option.code}:${option.label}`).join(' ')
    : 'A:ok B:no';
  return [
    fit(page.line, LCD_COLS_16),
    fit(`[${lampOf(page.risk)}] ${choices}`, LCD_COLS_16),
  ];
}

/** Lay the screen: the page when there is one, the status line otherwise. */
export function layoutScreen(model: ScreenModel, options: LayoutOptions): string[] {
  const page = model.page;
  if (page === null) {
    const rows = options.rows === 2
      ? [fit(model.status, options.cols), fit('press A or B', options.cols)]
      : [
          fit('Beeper', options.cols),
          fit(model.status, options.cols),
          fit('', options.cols),
          fit('waiting for a page', options.cols),
        ];
    return rows.slice(0, options.rows);
  }
  return options.rows === 2
    ? layoutTwo(page)
    : layoutFour(page, options.phase);
}

/** A display that writes the rows to a stream — the tests use a buffer. */
export class MockDisplay implements DisplayDriver {
  constructor(private readonly emit: (text: string) => void = (text) => process.stdout.write(text)) {}

  write(rows: string[]): void {
    this.emit(`${rows.join('\n')}\n`);
  }
}

/** The low-level write to the glass — injected so the driver is testable. */
export interface LcdWriter {
  write(rows: string[]): void;
}

/** A driver for a real HD44780 through an injected low-level writer. */
export class CharLcdDisplay implements DisplayDriver {
  constructor(
    private readonly writer: LcdWriter,
    private readonly options: { cols: number; rows: number },
  ) {}

  write(rows: string[]): void {
    const padded = rows.slice(0, this.options.rows);
    while (padded.length < this.options.rows) padded.push('');
    this.writer.write(padded);
  }
}

const PY_HELPER = fileURLToPath(new URL('../../tools/hd44780.py', import.meta.url));

/** Runs the Python helper with the rows as arguments — injectable in tests. */
export type LcdSpawn = (rows: string[]) => Promise<void>;

function shellSpawn(rows: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile('python3', [PY_HELPER, ...rows], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * The real write: shell out to the bundled Python helper (the `smbus2` driver
 * of the I2C backpack) with the rows as arguments. No native npm module.
 */
export class ShellLcdWriter implements LcdWriter {
  constructor(private readonly spawn: LcdSpawn = shellSpawn) {}

  write(rows: string[]): void {
    void this.spawn(rows).catch(() => undefined);
  }
}