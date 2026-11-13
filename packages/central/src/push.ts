/**
 * Web Push (BIP-F-19) behind an interface, so no test ever touches the network.
 * Without VAPID keys the sender is a no-op: the WebSocket stream is enough when
 * the pager is open, and the demo needs no configuration at all.
 */
import type { Hono } from 'hono';
import * as webpushModule from 'web-push';
import type { VapidConfig } from './config.js';
import type { PageRow, Store } from './store/types.js';

/** `web-push` ships CommonJS: the interop default is what carries the API. */
const webpush = (webpushModule as unknown as { default?: typeof webpushModule }).default ?? webpushModule;

export interface PushOptions {
  reminder: boolean;
  /** Only these devices (BIP-F-37); undefined means "the whole scope". */
  deviceIds?: string[];
}

export interface PushSender {
  readonly kind: 'noop' | 'web-push';
  notify(page: PageRow, options: PushOptions): void;
}

/**
 * The subset of a PushSubscription we persist, plus the operator's lock-screen
 * preference (BIP-F-21, BIP-N-04). The preference travels with the
 * subscription because it is the Central that composes the payload: a masked
 * device must never receive the line, not merely hide it locally.
 */
interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  masked?: boolean;
}

/**
 * What the service worker receives. `masked` strips everything but the code and
 * the station, so a lock screen or a notification centre cannot leak the
 * command (A.10: "le contenu d'un bip fuit sur l'écran verrouillé").
 */
export function pushPayload(
  page: PageRow,
  options: PushOptions,
  masked: boolean,
): Record<string, unknown> {
  const base = {
    page_id: page.id,
    code: page.code,
    risk: page.risk,
    station: page.source_alias,
    reminder: options.reminder,
    masked,
  };
  if (masked) return base;
  return { ...base, line: page.line };
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
    for (const device of this.store.listDevices()) {
      if (device.revoked_at !== null || device.push_subscription === null) continue;
      if (options.deviceIds && !options.deviceIds.includes(device.id)) continue;
      if (page.visitor_id !== null && device.visitor_id !== page.visitor_id) continue;
      const subscription = device.push_subscription as StoredSubscription;
      if (!subscription.endpoint || !subscription.keys) continue;
      const body = JSON.stringify(pushPayload(page, options, subscription.masked === true));
      void webpush.sendNotification(subscription, body, { TTL: 300 }).catch(() => {
        /* a dead subscription must never fail the page */
      });
    }
  }
}

export function createPushSender(store: Store, vapid: VapidConfig | null): PushSender {
  return vapid ? new WebPushSender(store, vapid) : new NoopPushSender();
}

/**
 * `GET /v1/push-config` — public, because a VAPID public key is public: the
 * browser needs it as `applicationServerKey` to subscribe at all. The private
 * key never leaves the Central's environment.
 */
export function registerPushConfigRoute(app: Hono, vapid: VapidConfig | null): void {
  app.get('/v1/push-config', (c) =>
    c.json({
      enabled: vapid !== null,
      vapid_public_key: vapid?.publicKey ?? null,
    }),
  );
}
