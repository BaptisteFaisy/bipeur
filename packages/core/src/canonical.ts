/**
 * Deterministic JSON canonicalisation. Two payloads that carry the same facts
 * must produce the same bytes, because the fingerprint of a page — and the
 * string a pager signs — are derived from it (BIP-F-18, BIP-P-05).
 *
 * Pure module: no Node API, safe in the browser bundle.
 */

export function canonicalize(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'string') return JSON.stringify(value);
  if (type === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => stringify(item)).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (type !== 'object') return 'null';
  return stringifyObject(value as Record<string, unknown>);
}

function stringifyObject(value: Record<string, unknown>): string {
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stringify(value[key])}`);
  return `{${parts.join(',')}}`;
}
