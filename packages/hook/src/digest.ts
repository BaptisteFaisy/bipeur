/**
 * SHA-256 in hex. `@bipeur/core/node` holds the same helper, but the core
 * package exports only `"."` today, so the hook cannot import it yet. This is
 * the single place that repeats it: the day `./node` is exported, this file
 * disappears and callers import from the core instead.
 */
import { createHash } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
