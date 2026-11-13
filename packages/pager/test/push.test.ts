/**
 * BIP-F-19 — the push subscription is best effort and never blocks pairing.
 * BIP-N-06 — the sound setting exists but no audio API is ever touched, and
 * the vibration stays off until the user turns it on.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserPush,
  createBrowserPush,
  decodeVapidKey,
  fetchPushConfig,
} from '../src/api/push.js';
import { pulse } from '../src/feedback.js';

/** happy-dom exposes `navigator` as a getter: it is patched, never replaced. */
function patchNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  }
});

/** A VAPID public key is unpadded base64url; this one is 4 bytes. */
const VAPID_KEY = 'AQIDBA';

function pushConfigFetch(body: unknown, ok = true) {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'content-type': 'application/json' },
    })) as unknown as (input: string, init?: RequestInit) => Promise<Response>;
}

describe('BIP-F-19 — the push subscription is optional', () => {
  it('returns null when the browser has no service worker', async () => {
    expect(await browserPush.subscribe(false)).toBeNull();
  });

  it('returns null when the Central publishes no VAPID key', async () => {
    const nav = { serviceWorker: { register: async () => ({}) } };
    patchNavigator(nav);
    const push = createBrowserPush({ fetchImpl: pushConfigFetch({ enabled: false, vapid_public_key: null }) });
    expect(await push.subscribe(false)).toBeNull();
  });

  it('returns null when the service worker has no push manager', async () => {
    const nav = { serviceWorker: { register: async () => ({}) } };
    patchNavigator(nav);
    const push = createBrowserPush({
      fetchImpl: pushConfigFetch({ enabled: true, vapid_public_key: VAPID_KEY }),
    });
    expect(await push.subscribe(false)).toBeNull();
  });

  it('returns null when the permission is refused', async () => {
    const nav = {
      serviceWorker: {
        register: async () => ({ pushManager: { subscribe: async () => ({ endpoint: 'x' }) } }),
      },
    };
    patchNavigator(nav);
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: async () => 'denied',
    };
    const push = createBrowserPush({
      fetchImpl: pushConfigFetch({ enabled: true, vapid_public_key: VAPID_KEY }),
    });
    expect(await push.subscribe(false)).toBeNull();
    delete (globalThis as { Notification?: unknown }).Notification;
  });

  it('subscribes with the VAPID key and carries the masking preference', async () => {
    // A holder, not a `let`: TypeScript narrows a closure-assigned variable to
    // `never`, because it cannot see the assignment happen. `PushSubscribeOptions`
    // is not in every DOM lib version either, so the two fields that matter are
    // described inline.
    const seen: { options?: { userVisibleOnly?: boolean; applicationServerKey?: unknown } } = {};
    const subscribeOptions = (): { userVisibleOnly?: boolean; applicationServerKey?: unknown } => {
      if (!seen.options) throw new Error('pushManager.subscribe was never called');
      return seen.options;
    };
    const subscription = { endpoint: 'https://push.example/1', toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } }) };
    const nav = {
      serviceWorker: {
        register: async () => ({
          pushManager: {
            subscribe: async (options: { userVisibleOnly?: boolean; applicationServerKey?: unknown }) => {
              seen.options = options;
              return subscription;
            },
          },
        }),
      },
    };
    patchNavigator(nav);
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: async () => 'granted',
    };
    const push = createBrowserPush({
      fetchImpl: pushConfigFetch({ enabled: true, vapid_public_key: VAPID_KEY }),
    });

    const stored = (await push.subscribe(true)) as Record<string, unknown>;
    expect(stored).toMatchObject({ endpoint: 'https://push.example/1', masked: true });
    // Without applicationServerKey the push service silently refuses delivery.
    expect(subscribeOptions().userVisibleOnly).toBe(true);
    expect(subscribeOptions().applicationServerKey).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(subscribeOptions().applicationServerKey as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    delete (globalThis as { Notification?: unknown }).Notification;
  });

  it('reads the push config without throwing when the route is missing', async () => {
    expect(await fetchPushConfig('', pushConfigFetch({}, false))).toBeNull();
    expect(await fetchPushConfig('', pushConfigFetch({ enabled: true }))).toBeNull();
    expect(await fetchPushConfig('', pushConfigFetch({ enabled: true, vapid_public_key: VAPID_KEY }))).toEqual({
      enabled: true,
      vapid_public_key: VAPID_KEY,
    });
  });

  it('decodes an unpadded base64url VAPID key, and rejects garbage', () => {
    expect(new Uint8Array(decodeVapidKey(VAPID_KEY) as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(decodeVapidKey('!!!not base64!!!')).toBeNull();
    expect(decodeVapidKey('')).toBeNull();
  });
});

describe('BIP-N-06 — no sound, and no vibration unless asked', () => {
  it('never touches the vibration motor when the setting is off', () => {
    const vibrate = vi.fn();
    patchNavigator({ vibrate });
    pulse(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('pulses once when the user turned the vibration on', () => {
    const vibrate = vi.fn();
    patchNavigator({ vibrate });
    pulse(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('ships no audio call anywhere in the package', async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const source = readFileSync(path, 'utf8');
          if (/\bnew Audio\b|AudioContext|HTMLAudioElement|\.play\(\)|vibrate\(/i.test(source)) {
            if (!/navigator\?\.vibrate/.test(source)) offenders.push(path);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
