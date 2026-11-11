/**
 * Page state machine (BIP-F-05). Any transition outside the graph is refused
 * and a final state never changes again. Property BIP-P-03.
 */
import type { PageState } from './types.js';

export const PAGE_STATES: readonly PageState[] = [
  'queued',
  'delivered',
  'read',
  'decided',
  'expired',
  'cancelled',
] as const;

export const FINAL_STATES: readonly PageState[] = ['decided', 'expired', 'cancelled'] as const;

const TRANSITIONS: Readonly<Record<PageState, readonly PageState[]>> = {
  queued: ['delivered', 'expired', 'cancelled'],
  delivered: ['read', 'decided', 'expired', 'cancelled'],
  read: ['decided', 'expired', 'cancelled'],
  decided: [],
  expired: [],
  cancelled: [],
};

export class IllegalTransitionError extends Error {
  readonly from: PageState;
  readonly to: PageState;

  constructor(from: PageState, to: PageState) {
    super(`illegal page transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function isFinalState(state: PageState): boolean {
  return FINAL_STATES.includes(state);
}

export function allowedTransitions(state: PageState): readonly PageState[] {
  return TRANSITIONS[state];
}

export function canTransition(from: PageState, to: PageState): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

/** Returns `to` or throws `IllegalTransitionError`. */
export function transition(from: PageState, to: PageState): PageState {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
  return to;
}

/**
 * Fold a sequence of requested transitions: illegal moves are ignored, the
 * state never leaves the graph and a final state is stable (BIP-P-03).
 */
export function applyTransitions(
  initial: PageState,
  requested: readonly PageState[],
): { state: PageState; accepted: number; refused: number } {
  let state = initial;
  let accepted = 0;
  let refused = 0;
  for (const to of requested) {
    if (canTransition(state, to)) {
      state = to;
      accepted += 1;
    } else {
      refused += 1;
    }
  }
  return { state, accepted, refused };
}

/** Graphviz source, regenerated into the README by the state-machine-guard hook. */
export function stateGraphDot(): string {
  const edges: string[] = [];
  for (const from of PAGE_STATES) {
    for (const to of TRANSITIONS[from]) edges.push(`  ${from} -> ${to};`);
  }
  return ['digraph page {', '  rankdir=LR;', ...edges, '}'].join('\n');
}
