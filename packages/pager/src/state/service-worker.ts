/**
 * BIP-F-19 — the open pager answers the service worker.
 *
 * The service worker cannot sign a decision (the private key is
 * non-extractable and never leaves the page), so a notification action is
 * forwarded here and signed by the open pager. When no pager is open, the
 * service worker opens one instead.
 */
import type { Verdict } from '@bipeur/core';
import { currentPage } from './reducer.js';
import type { Action } from './reducer.js';
import type { PagerState } from './types.js';

export interface ServiceWorkerMessage {
  type: string;
  action?: string;
  page_id?: string | null;
}

/** The verdict of a notification action, or null when the message is not one. */
export function verdictOf(message: ServiceWorkerMessage): Verdict | null {
  if (message.type !== 'bipeur:action') return null;
  if (message.action === 'approve') return 'approve';
  if (message.action === 'deny') return 'deny';
  return null;
}

/**
 * The page a notification action applies to: the one it names, or the one on
 * screen. Never another page: a decision must apply to what the human saw.
 */
export function targetPage(
  state: PagerState,
  message: ServiceWorkerMessage,
): ReturnType<typeof currentPage> {
  const current = currentPage(state);
  if (message.page_id && current && current.id !== message.page_id) return null;
  return current;
}

/** Wire the listener; the handler is a plain function so it can be tested. */
export function listenForServiceWorker(
  handler: (message: ServiceWorkerMessage) => void,
): () => void {
  const target = globalThis as {
    navigator?: { serviceWorker?: { addEventListener?: unknown } };
  };
  const container = target.navigator?.serviceWorker as
    | { addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void }
    | undefined;
  if (!container?.addEventListener) return () => undefined;
  const listener = (event: MessageEvent): void => {
    const data = event.data as ServiceWorkerMessage | undefined;
    if (data && typeof data.type === 'string') handler(data);
  };
  container.addEventListener('message', listener);
  return () => container.addEventListener?.('message', listener);
}

export type { Action };

/**
 * The link the service worker opens when no pager was running: `/?page=…&action=…`.
 * The pager reads it, finds the page in its queue and decides it.
 */
export interface OpenRequest {
  pageId: string | null;
  action: Verdict | null;
}

export function readOpenRequest(search: string): OpenRequest {
  const params = new URLSearchParams(search);
  const pageId = params.get('page');
  const action = params.get('action');
  return {
    pageId,
    action: action === 'approve' || action === 'deny' ? action : null,
  };
}
