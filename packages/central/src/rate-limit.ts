/**
 * Sliding-window rate limit per key (BIP-N-03). The clock is injected so a test
 * can drive it; the window never grows without bound — and neither does the
 * table of keys, which is the part that was exploitable.
 *
 * A limiter keyed on something the caller chooses is a memory leak with extra
 * steps: a thousand forged bearer tokens allocate a thousand entries *before*
 * authentication happens, and nothing ever frees them (~2.9 KiB each measured,
 * so about 1 GB for 350 000 requests). Entries are therefore pruned as they
 * expire, the table is capped, and a full table evicts its oldest key rather
 * than refusing the caller — bounded memory without handing an attacker a way
 * to lock out a legitimate station.
 */
export const DEFAULT_MAX_KEYS = 10_000;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxKeys: number;
  private calls = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number,
    maxKeys: number = DEFAULT_MAX_KEYS,
  ) {
    this.maxKeys = maxKeys > 0 ? maxKeys : DEFAULT_MAX_KEYS;
  }

  /** Records one call; false means the caller is over its budget. */
  take(key: string): boolean {
    const now = this.clock();
    this.calls += 1;
    // Prune on a cadence rather than on every call: the common case is a key
    // that is already known and does not need the table walked.
    if (this.calls % 64 === 0 || this.hits.size >= this.maxKeys) this.prune(now);

    const floor = now - this.windowMs;
    const known = this.hits.get(key);
    const kept = (known ?? []).filter((at) => at > floor);
    if (kept.length >= this.limit) {
      this.hits.set(key, kept);
      return false;
    }
    if (known === undefined && this.hits.size >= this.maxKeys) this.evictOldest();
    kept.push(now);
    // Re-insert so insertion order stays "least recently seen first".
    this.hits.delete(key);
    this.hits.set(key, kept);
    return true;
  }

  /** Distinct keys currently held. What a test asserts to prove the bound. */
  get size(): number {
    return this.hits.size;
  }

  reset(): void {
    this.hits.clear();
    this.calls = 0;
  }

  private prune(now: number): void {
    const floor = now - this.windowMs;
    for (const [key, stamps] of this.hits) {
      const kept = stamps.filter((at) => at > floor);
      if (kept.length === 0) this.hits.delete(key);
      else if (kept.length !== stamps.length) this.hits.set(key, kept);
    }
  }

  private evictOldest(): void {
    const oldest = this.hits.keys().next();
    if (!oldest.done) this.hits.delete(oldest.value);
  }
}
