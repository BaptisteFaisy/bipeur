/**
 * Deep-link into a screen: `?screen=demo` opens the demonstration, a landing
 * page or a judge's link can point straight at any of the five screens.
 *
 * Same shape as `api/central-url.ts`: one pure function that takes the query
 * string (testable without a DOM), one browser branch that reads `location`
 * when nothing is injected. Anything absent or unrecognised falls back to
 * `pager` — a deep-link is a shortcut, never a way to invent a screen.
 */
import type { Screen } from './types.js';

const SCREENS: readonly Screen[] = ['pager', 'memory', 'settings', 'pairing', 'demo'];

interface LocationLike {
  search?: string;
}

export function isScreen(value: unknown): value is Screen {
  return typeof value === 'string' && (SCREENS as readonly string[]).includes(value);
}

export function resolveInitialScreen(search?: string | null): Screen {
  const raw = search ?? browserSearch();
  const value = new URLSearchParams(raw).get('screen');
  return isScreen(value) ? value : 'pager';
}

function browserSearch(): string {
  const location = (globalThis as { location?: LocationLike }).location;
  return location?.search ?? '';
}
