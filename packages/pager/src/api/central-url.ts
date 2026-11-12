/**
 * Where the pager talks to (A.9).
 *
 * The pager is a static build: it can be served by the Central itself (one
 * process, one URL — the default, `''` means same origin) **or** from a static
 * host such as GitHub Pages, in which case the Central lives elsewhere and the
 * browser makes cross-origin calls.
 *
 * Resolution order, most specific first:
 *   1. `?central=https://…` in the page URL — what a demo link or a judge uses;
 *   2. `localStorage['bipeur.central']` — remembered from a previous visit, so
 *      the setting survives a reload of the bare URL;
 *   3. `__CENTRAL_URL__`, baked in at build time by `vite.config.ts`;
 *   4. `''` — same origin, the Central serves the pager.
 *
 * The value is written back to storage so a link with `?central=` keeps working
 * after a reload. A trailing slash is always stripped: every caller concatenates
 * a path that starts with one.
 */
export const CENTRAL_STORAGE_KEY = 'bipeur.central';

declare const __CENTRAL_URL__: string | undefined;

interface LocationLike {
  search?: string;
}

interface StorageLike {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface ResolveOptions {
  location?: LocationLike | null;
  storage?: StorageLike | null;
  buildTime?: string | null;
}

function normalise(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** Only http(s): a `javascript:` or `data:` Central would be an injection. */
function isUsable(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url);
}

export function resolveCentralUrl(options: ResolveOptions = {}): string {
  const location =
    options.location ?? (globalThis as { location?: LocationLike }).location ?? null;
  const storage = options.storage ?? browserStore();

  const fromQuery = new URLSearchParams(location?.search ?? '').get('central');
  if (fromQuery && isUsable(fromQuery)) {
    const value = normalise(fromQuery);
    storage?.set(CENTRAL_STORAGE_KEY, value);
    return value;
  }

  const stored = storage?.get(CENTRAL_STORAGE_KEY) ?? null;
  if (stored && isUsable(stored)) return normalise(stored);

  const baked =
    options.buildTime ??
    (typeof __CENTRAL_URL__ === 'string' ? __CENTRAL_URL__ : null);
  if (baked && isUsable(baked)) return normalise(baked);

  return '';
}

function browserStore(): StorageLike | null {
  try {
    const local = (globalThis as { localStorage?: Storage }).localStorage;
    if (!local) return null;
    return {
      get: (key) => local.getItem(key),
      set: (key, value) => local.setItem(key, value),
    };
  } catch {
    return null;
  }
}

/** Human-readable origin, for the status bar and the settings screen. */
export function describeCentral(baseUrl: string): string {
  if (!baseUrl) return 'this server';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
