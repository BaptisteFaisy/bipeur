import { describe, expect, it } from 'vitest';
import { BoundedQueue } from '../src/queue.js';

describe('BIP-F-27 — bounded local queue', () => {
  it('keeps the newest events and counts what it drops', () => {
    const queue = new BoundedQueue<number>(2);
    queue.push(1);
    queue.push(2);
    queue.push(3);
    expect(queue.size).toBe(2);
    expect(queue.dropped).toBe(1);
    expect(queue.shift()).toBe(2);
    expect(queue.shift()).toBe(3);
    expect(queue.shift()).toBeUndefined();
  });

  it('refuses a non-positive bound', () => {
    expect(() => new BoundedQueue<number>(0)).toThrow();
  });
});
