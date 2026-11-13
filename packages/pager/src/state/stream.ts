/** Translation of the WebSocket stream into reducer actions. */
import type { StreamMessage } from '@bipeur/core';
import { parsePage } from '../api/client.js';
import { pulse } from '../feedback.js';
import type { Action } from './reducer.js';
import type { Settings } from './types.js';

export interface StreamContext {
  dispatch: (action: Action) => void;
  settings: () => Settings;
}

export function handleStream(message: StreamMessage, context: StreamContext): void {
  switch (message.type) {
    case 'page.delivered': {
      const page = safePage(message.page);
      if (!page) return;
      context.dispatch({ type: 'page.delivered', page });
      pulse(context.settings().vibration);
      return;
    }
    case 'page.decided':
    case 'page.expired':
    case 'page.cancelled':
    case 'page.escalated': // BIP-F-37: the page moved on, it is no longer ours
      context.dispatch({ type: 'page.closed', pageId: message.page_id });
      return;
    case 'hello':
      context.dispatch({ type: 'connection', connection: 'online' });
      return;
    default:
      return;
  }
}

function safePage(raw: Record<string, unknown>) {
  try {
    return parsePage(raw);
  } catch {
    return null;
  }
}
