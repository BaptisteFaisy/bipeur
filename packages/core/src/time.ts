/** Small time helpers shared by the Central, the hook and the CLI. */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Default lifetime of a page (A.9 rules file: `ttl: 15m`). */
export const DEFAULT_TTL_MS = 15 * MINUTE;

/** Re-delivery schedule of BIP-F-08: 2, 5 and 15 minutes, then stop. */
export const REMINDER_DELAYS_MS: readonly number[] = [2 * MINUTE, 5 * MINUTE, 15 * MINUTE];

const DURATION_RE = /^(\d+)\s*(ms|s|m|h|d)$/i;
const DURATION_UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: SECOND,
  m: MINUTE,
  h: HOUR,
  d: DAY,
};

/** Parse `500ms`, `30s`, `15m`, `2h`, `1d`. Returns null when malformed. */
export function parseDuration(input: string): number | null {
  const match = DURATION_RE.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = DURATION_UNIT_MS[match[2]!.toLowerCase()];
  if (!Number.isFinite(value) || unit === undefined) return null;
  return value * unit;
}

export function parseDurationOr(input: string, fallback: number): number {
  return parseDuration(input) ?? fallback;
}

export function formatDuration(ms: number): string {
  if (ms < SECOND) return `${ms}ms`;
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  return `${Math.round(ms / HOUR)}h`;
}

export function isExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}

/** `2026-11-24T23:14:55Z` — audit log timestamps are always UTC. */
export function isoUtc(ts: number): string {
  return new Date(ts).toISOString();
}

/** Median of a numeric sample, or null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  return sorted[middle] ?? null;
}

/** Percentile (nearest-rank) of a numeric sample, or null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}
