/**
 * Automatic pairing by deep-link: the Central's QR carries
 * `/?pair=<pairing_id>&code=<code>`, so opening the pager from it pairs the
 * device without typing anything.
 *
 * Same shape as `initial-screen.ts`: one pure function that takes the query
 * string (testable without a DOM), one browser branch that reads `location`
 * when nothing is injected. The code is single-use — once the attempt has
 * been made, success or failure, both parameters leave the address bar so a
 * reload can never replay a consumed code.
 */

export interface AutoPairRequest {
  pairingId: string;
  /** Normalised: trimmed, upper case, six letters or digits. */
  code: string;
}

interface LocationLike {
  search?: string;
  pathname?: string;
  hash?: string;
}

interface HistoryLike {
  replaceState?(data: unknown, title: string, url?: string | null): void;
}

const CODE_PATTERN = /^[A-Z0-9]{6}$/;

/** The deep-link request, or null when the URL does not carry a usable one. */
export function resolveAutoPair(search?: string | null): AutoPairRequest | null {
  const params = new URLSearchParams(search ?? browserSearch());
  const pairingId = params.get('pair');
  const code = params.get('code')?.trim().toUpperCase() ?? '';
  if (!pairingId || !CODE_PATTERN.test(code)) return null;
  return { pairingId, code };
}

/**
 * Drop `pair` and `code` from the address bar, keeping every other parameter
 * (`?screen=`, `?central=`…) exactly where it was. Silent no-op without a
 * `location` or a `history` (SSR, a stripped test environment): cleaning the
 * URL is hygiene, never a reason to crash the boot.
 */
export function clearAutoPairFromLocation(): void {
  const scope = globalThis as { location?: LocationLike; history?: HistoryLike };
  const location = scope.location;
  const history = scope.history;
  if (!location?.search || typeof history?.replaceState !== 'function') return;
  const params = new URLSearchParams(location.search);
  if (!params.has('pair') && !params.has('code')) return;
  params.delete('pair');
  params.delete('code');
  const query = params.toString();
  const url = `${location.pathname ?? '/'}${query ? `?${query}` : ''}${location.hash ?? ''}`;
  history.replaceState(null, '', url);
}

function browserSearch(): string {
  const location = (globalThis as { location?: LocationLike }).location;
  return location?.search ?? '';
}
