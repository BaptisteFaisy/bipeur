/**
 * Sliding-window rate limit per station (BIP-N-03). The clock is injected so a
 * test can drive it; the window never grows without bound.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number,
  ) {}

  /** Records one call; false means the caller is over its budget. */
  take(key: string): boolean {
    const now = this.clock();
    const floor = now - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((at) => at > floor);
    if (kept.length >= this.limit) {
      this.hits.set(key, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(key, kept);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}
