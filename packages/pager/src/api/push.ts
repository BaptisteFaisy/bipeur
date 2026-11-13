/**
 * BIP-F-19 — Web Push, best effort.
 *
 * The service worker is registered by `vite-plugin-pwa`; here we only ask for
 * the subscription the Central needs. Two things make it real rather than
 * decorative:
 *
 *  - the subscription carries the Central's **VAPID public key** as
 *    `applicationServerKey`. Without it the browser hands back a subscription
 *    the push service will refuse to deliver to, and the failure is silent;
 *  - the subscription carries the operator's lock-screen masking preference, so
 *    the Central composes a reduced payload instead of the pager hiding a line
 *    it already received (BIP-F-21, BIP-N-04).
 *
 * Documented fallback: when push is unavailable — no VAPID keys on the Central,
 * no service worker, permission refused, platform without notification actions
 * — the WebSocket stream is enough as long as the pager is open, and a red page
 * always requires the open pager anyway. Nothing here throws: a browser that
 * cannot do push must still pair and still decide.
 */
export interface PushPort {
  /** Returns the subscription to store, or null when push is unavailable. */
  subscribe(masked: boolean): Promise<unknown | null>;
}

/** `GET /v1/push-config` — public: a VAPID public key is not a secret. */
export interface PushConfig {
  enabled: true;
  vapid_public_key: string;
}

export async function fetchPushConfig(
  baseUrl: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = globalThis.fetch,
): Promise<PushConfig | null> {
  try {
    const response = await fetchImpl(`${baseUrl}/v1/push-config`);
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<PushConfig>;
    if (body.enabled !== true || !body.vapid_public_key) return null;
    return { enabled: true, vapid_public_key: body.vapid_public_key };
  } catch {
    return null;
  }
}

/** VAPID keys are unpadded base64url; `applicationServerKey` wants raw bytes. */
export function decodeVapidKey(key: string): ArrayBuffer | null {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    if (binary.length === 0) return null;
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return buffer;
  } catch {
    return null;
  }
}

export interface BrowserPushOptions {
  /** Central base URL; empty in the browser, where the pager is same-origin. */
  baseUrl?: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** The generated worker sits under the build's base path, never at `/sw.js`. */
export function swUrl(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base.replace(/\/$/, '')}/sw.js`;
}

export function createBrowserPush(options: BrowserPushOptions = {}): PushPort {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  return {
    async subscribe(masked: boolean) {
      const nav = (globalThis as { navigator?: Navigator }).navigator;
      const container = nav?.serviceWorker;
      if (!container || typeof container.register !== 'function') return null;
      try {
        const config = await fetchPushConfig(baseUrl, fetchImpl);
        if (!config) return null;
        const applicationServerKey = decodeVapidKey(config.vapid_public_key);
        if (!applicationServerKey) return null;

        const registration = await container.register(swUrl());
        const manager = (registration as { pushManager?: PushManager }).pushManager;
        if (!manager) return null;
        const permission = await requestPermission();
        if (permission !== 'granted') return null;

        const subscription = await manager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        // The masking flag rides along: the Central stores it with the device
        // and composes a reduced payload for a locked screen.
        const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
        return { ...json, masked };
      } catch {
        return null;
      }
    },
  };
}

async function requestPermission(): Promise<NotificationPermission> {
  const Ctor = (globalThis as { Notification?: typeof Notification }).Notification;
  if (!Ctor || typeof Ctor.requestPermission !== 'function') return 'denied';
  return Ctor.requestPermission();
}

/**
 * The default port: same-origin, so an empty base URL. Kept as a value (not a
 * call) because the runtime wires it as a dependency and the tests replace it.
 */
export const browserPush: PushPort = createBrowserPush();
