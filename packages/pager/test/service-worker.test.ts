/**
 * BIP-F-19 — a notification action reaches the open pager, which signs it.
 * The service worker never signs: it asks the page.
 */
import { describe, expect, it } from 'vitest';
import {
  listenForServiceWorker,
  targetPage,
  verdictOf,
  type ServiceWorkerMessage,
} from '../src/state/service-worker.js';
import { initialState, reducer } from '../src/state/reducer.js';
import { makePage } from './support/fixtures.js';

describe('BIP-F-19 — the notification action', () => {
  it('maps approve and deny to a verdict, and ignores anything else', () => {
    expect(verdictOf({ type: 'bipeur:action', action: 'approve' })).toBe('approve');
    expect(verdictOf({ type: 'bipeur:action', action: 'deny' })).toBe('deny');
    expect(verdictOf({ type: 'bipeur:action', action: 'open' })).toBeNull();
    expect(verdictOf({ type: 'something-else' })).toBeNull();
  });

  it('applies to the page on screen, and to no other page', () => {
    const page = makePage({ id: 'pg_1' });
    const state = reducer(initialState(), { type: 'page.delivered', page });
    expect(targetPage(state, { type: 'bipeur:action', action: 'approve' })).toBe(page);
    expect(
      targetPage(state, { type: 'bipeur:action', action: 'approve', page_id: 'pg_other' }),
    ).toBeNull();
  });

  it('reaches a listener registered on the service worker container', () => {
    const listeners: ((event: MessageEvent) => void)[] = [];
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
            if (type === 'message') listeners.push(listener);
          },
        },
      },
    });
    const received: ServiceWorkerMessage[] = [];
    listenForServiceWorker((message) => received.push(message));
    listeners[0]?.({ data: { type: 'bipeur:action', action: 'approve' } } as MessageEvent);
    expect(received).toHaveLength(1);
    expect(received[0]?.action).toBe('approve');
    if (original) Object.defineProperty(globalThis, 'navigator', original);
  });
});
