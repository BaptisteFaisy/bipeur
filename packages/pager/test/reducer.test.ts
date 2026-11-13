/**
 * Pure reducer tests: the queue, the memory cap and the outbox, without a DOM.
 * BIP-F-20 (fifty entries) and BIP-F-22 (an unsent decision stays queued) are
 * properties of the state machine, so they are proved here.
 */
import { describe, expect, it } from 'vitest';
import type { DecisionClaims } from '@bipeur/core';
import { initialState, reducer, type Action } from '../src/state/reducer.js';
import { detailCount } from '../src/state/reducer.js';
import { MEMORY_LIMIT, type MemoryEntry } from '../src/state/types.js';
import { makePage } from './support/fixtures.js';

function entry(index: number): MemoryEntry {
  return {
    pageId: `pg_${index}`,
    line: `110 fw RUN step ${index} #0000`,
    risk: 'green',
    code: 110,
    station: 'fw',
    verdict: 'approve',
    choice: null,
    decidedAt: 1_000_000 + index,
    latencyMs: 120,
  };
}

const claims: DecisionClaims = {
  page_id: 'pg_1',
  fingerprint: 'a'.repeat(64),
  verdict: 'approve',
  choice: null,
  nonce: 'nonce12345678',
  expires_at: 2_000_000,
  device_id: 'dev_1',
};

function run(state = initialState(), actions: Action[] = []) {
  return actions.reduce(reducer, state);
}

describe('BIP-F-20 — the memory keeps the last fifty pages', () => {
  it('drops the oldest entry once fifty are stored', () => {
    const actions: Action[] = Array.from({ length: MEMORY_LIMIT + 3 }, (_, i) => ({
      type: 'decision.sent' as const,
      entry: entry(i),
    }));
    const state = run(initialState(), actions);
    expect(state.memory).toHaveLength(MEMORY_LIMIT);
    expect(state.memory[0]?.pageId).toBe(`pg_${MEMORY_LIMIT + 2}`);
    expect(state.memory.at(-1)?.pageId).toBe('pg_3');
  });

  it('hydrates at most fifty entries from storage', () => {
    const many = Array.from({ length: MEMORY_LIMIT + 10 }, (_, i) => entry(i));
    const state = run(initialState(), [{ type: 'memory.hydrate', memory: many }]);
    expect(state.memory).toHaveLength(MEMORY_LIMIT);
  });
});

describe('BIP-F-22 — an unsent decision is never presented as sent', () => {
  it('keeps the page in the queue and records nothing in the memory', () => {
    const page = makePage({ id: 'pg_1' });
    const state = run(initialState(), [
      { type: 'page.delivered', page },
      { type: 'decision.queued', entry: { pageId: page.id, claims, signature: 'sig', queuedAt: 1 } },
    ]);
    expect(state.queue).toHaveLength(1);
    expect(state.memory).toHaveLength(0);
    expect(state.outbox).toHaveLength(1);
  });

  it('clears the queue and the outbox once the decision is acknowledged', () => {
    const page = makePage({ id: 'pg_1' });
    const state = run(initialState(), [
      { type: 'page.delivered', page },
      { type: 'decision.queued', entry: { pageId: page.id, claims, signature: 'sig', queuedAt: 1 } },
      { type: 'decision.sent', entry: entry(1) },
    ]);
    expect(state.queue).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
    expect(state.memory).toHaveLength(1);
  });
});

describe('BIP-F-16 — the queue and the detail index', () => {
  it('ignores a page delivered twice and keeps the current detail screen', () => {
    const page = makePage({ id: 'pg_1', detail: ['a'.repeat(30), 'b'.repeat(30)] });
    const state = run(initialState(), [
      { type: 'page.delivered', page },
      { type: 'detail.next' },
      { type: 'page.delivered', page },
    ]);
    expect(state.queue).toHaveLength(1);
    expect(state.detailIndex).toBe(1);
  });

  it('wraps the detail index inside the screens the page actually carries', () => {
    const page = makePage({ id: 'pg_1', detail: ['a'.repeat(30)] });
    const state = run(initialState(), [
      { type: 'page.delivered', page },
      { type: 'detail.next' },
      { type: 'detail.next' },
    ]);
    expect(state.detailIndex).toBe(0);
  });

  it('resets the detail index when the current page is closed', () => {
    const page = makePage({ id: 'pg_1', detail: ['a'.repeat(30)] });
    const state = run(initialState(), [
      { type: 'page.delivered', page },
      { type: 'detail.next' },
      { type: 'page.closed', pageId: page.id },
    ]);
    expect(state.detailIndex).toBe(0);
    expect(state.queue).toHaveLength(0);
  });

  it('reaches every detail screen the page carries, not only the first three', () => {
    // A long question brings more screens: the human must be able to walk
    // through all of them (BIP-F-16), or the cut text is lost for good.
    const detail = Array.from({ length: 7 }, (_, index) => `screen ${index} ${'x'.repeat(60)}`);
    const page = makePage({ id: 'pg_1', detail });
    let state = run(initialState(), [{ type: 'page.delivered', page }]);
    for (let index = 1; index <= 7; index += 1) {
      state = run(state, [{ type: 'detail.next' }]);
      expect(state.detailIndex).toBe(index);
    }
    expect(state.detailIndex).toBe(7);
    expect(detailCount(page)).toBe(8);
  });
});
