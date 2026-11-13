/**
 * A bounded local queue: a Gateway outage must never grow memory without
 * limit. Past `limit`, the oldest event is dropped and counted, so the loss is
 * visible in the log instead of being silent.
 */
export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private droppedCount = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('queue limit must be a positive integer');
  }

  push(item: T): void {
    if (this.items.length >= this.limit) {
      this.items.shift();
      this.droppedCount += 1;
    }
    this.items.push(item);
  }

  shift(): T | undefined {
    return this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }

  get dropped(): number {
    return this.droppedCount;
  }
}
