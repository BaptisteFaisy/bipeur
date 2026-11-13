/**
 * Property BIP-P-03: for any sequence of events, a page only walks the edges
 * of the graph and a final state never changes again.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FINAL_STATES,
  IllegalTransitionError,
  PAGE_STATES,
  allowedTransitions,
  applyTransitions,
  canTransition,
  isFinalState,
  stateGraphDot,
  transition,
} from '../src/states.js';
import type { PageState } from '../src/types.js';

describe('BIP-P-03 — the state machine never leaves its graph', () => {
  it('only accepts declared edges and keeps final states stable', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...PAGE_STATES), { minLength: 0, maxLength: 40 }),
        (requested) => {
          const { state, accepted, refused } = applyTransitions('queued', requested);
          expect(PAGE_STATES).toContain(state);
          expect(accepted + refused).toBe(requested.length);
          if (isFinalState(state)) {
            for (const next of PAGE_STATES) expect(canTransition(state, next)).toBe(false);
          }
        },
      ),
      { numRuns: 600, seed: 20261121 },
    );
  });

  it('throws on an illegal move', () => {
    expect(() => transition('queued', 'decided')).toThrow(IllegalTransitionError);
    expect(() => transition('expired', 'delivered')).toThrow(IllegalTransitionError);
    expect(() => transition('decided', 'decided')).toThrow(IllegalTransitionError);
  });

  it('accepts the documented happy path', () => {
    let state: PageState = 'queued';
    for (const next of ['delivered', 'read', 'decided'] as PageState[]) {
      state = transition(state, next);
    }
    expect(state).toBe('decided');
  });

  it('has no outgoing edge from a final state', () => {
    for (const final of FINAL_STATES) expect(allowedTransitions(final)).toEqual([]);
  });

  it('exports a Graphviz graph for the README', () => {
    const dot = stateGraphDot();
    expect(dot).toContain('digraph page');
    expect(dot).toContain('queued -> delivered;');
    expect(dot).not.toContain('decided ->');
  });
});
