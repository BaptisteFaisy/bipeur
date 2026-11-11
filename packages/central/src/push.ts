/**
 * Web Push (BIP-F-19) behind an interface, so no test ever touches the network.
 * Without VAPID keys the sender is a no-op: the WebSocket stream is enough when
 * the pager is open, and the demo needs no configuration at all.
 */
import * as webpushModule from 'web-push';
import type { VapidConfig } from './config.js';
import type { PageRow, Store } from './store/types.js';

/** `web-push` ships CommonJS: the interop default is what carries the API. */
const webpush = (webpushModule as unknown as { default?: typeof webpushModule }).default ?? webpushModule;

export interface PushOptions {
  reminder: boolean;
}

export interface PushSender {
  readonly kind: 'noop' | 'web-push';
  notify(page: PageRow, options: PushOptions): void;
}

/** The subset of a PushSubscription we persist. */
interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class NoopPushSender implements PushSender {
  readonly kind = 'noop' as const;

  notify(_page: PageRow, _options: PushOptions): void {
    /* no VAPID keys configured: nothing to send, nothing to log */
  }
}

export class WebPushSender implements PushSender {
  readonly kind = 'web-push' as const;

  constructor(
    private readonly store: Store,
    vapid: VapidConfig,
  ) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  notify(page: PageRow, options: PushOptions): void {
    const body = JSON.stringify({
      page_id: page.id,
      line: page.line,
      code: page.code,
      risk: page.risk,
      station: page.source_alias,
      reminder: options.reminder,
    });
    for (const device of this.store.listDevices()) {
      if (device.revoked_at !== null || device.push_subscription === null) continue;
      if (page.visitor_id !== null && device.visitor_id !== page.visitor_id) continue;
      const subscription = device.push_subscription as StoredSubscription;
      void webpush.sendNotification(subscription, body, { TTL: 300 }).catch(() => {
        /* a dead subscription must never fail the page */
      });
    }
  }
}

export function createPushSender(store: Store, vapid: VapidConfig | null): PushSender {
  return vapid ? new WebPushSender(store, vapid) : new NoopPushSender();
}
