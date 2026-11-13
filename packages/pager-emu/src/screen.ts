/**
 * The screen of the emulator: the LCD of a pager of 1995, in a terminal.
 *
 * Pure rendering — no ANSI, no terminal — so a test can assert the grid
 * character by character.
 */
import { renderLcd } from './lcd.js';
import type { PagerView } from './session.js';

/** Width of the frame, in characters. */
export const SCREEN_WIDTH = 44;

export interface ScreenOptions {
  /** What the Central answered, when the emulator is paired. */
  central?: string | null;
}

/** The whole frame, as the terminal shows it. */
export function renderScreen(view: PagerView, options: ScreenOptions = {}): string {
  const lines: string[] = [];
  lines.push(`bip-pager — SNPP unit channel — pager ${view.capcode}`);
  lines.push('');
  lines.push(...renderLcd(view.lines));
  lines.push('');
  lines.push(...renderChoices(view));
  lines.push('');
  lines.push(...renderFooter(view, options));
  return lines.join('\n');
}

/** The seeded replies, with the key that answers them. */
function renderChoices(view: PagerView): string[] {
  if (view.choices.length === 0) {
    return ['  no seeded reply — a approves, b denies'];
  }
  return view.choices.map((choice) => `  ${choice.letter}) ${choice.label}`);
}

/** The state of the pager: what happened, and on which page. */
function renderFooter(view: PagerView, options: ScreenOptions): string[] {
  const lines: string[] = [];
  lines.push(`  state    ${view.state}`);
  if (view.code !== null) lines.push(`  code     ${view.code}`);
  if (view.pageId !== null) lines.push(`  page     ${view.pageId}`);
  if (view.tag !== null) lines.push(`  delivery ${view.tag} ${view.secret ?? ''}`.trimEnd());
  lines.push(`  status   ${view.status}`);
  if (options.central) lines.push(`  central  ${options.central}`);
  lines.push('  keys     a b c d answer — q hangs up');
  return lines;
}
