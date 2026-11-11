/**
 * BIP-F-19 — the push subscription is best effort and never blocks pairing.
 * BIP-N-06 — the sound setting exists but no audio API is ever touched, and
 * the vibration stays off until the user turns it on.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPush } from '../src/api/push.js';
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

describe('BIP-F-19 — the push subscription is optional', () => {
  it('returns null when the browser has no service worker', async () => {
    expect(await browserPush.subscribe()).toBeNull();
  });

  it('returns null when the service worker has no push manager', async () => {
    const nav = { serviceWorker: { register: async () => ({}) } };
    patchNavigator(nav);
    expect(await browserPush.subscribe()).toBeNull();
  });

  it('returns the subscription when the platform allows it', async () => {
    const subscription = { endpoint: 'https://push.example/1' };
    const nav = {
      serviceWorker: {
        register: async () => ({ pushManager: { subscribe: async () => subscription } }),
      },
    };
    patchNavigator(nav);
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: async () => 'granted',
    };
    expect(await browserPush.subscribe()).toBe(subscription);
    delete (globalThis as { Notification?: unknown }).Notification;
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
