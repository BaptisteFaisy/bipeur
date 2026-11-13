/** Wiring of the pager's dependencies: everything is injectable, nothing global. */
import type { PageRecord, Verdict } from '@bipeur/core';
import { resolveCentralUrl } from '../api/central-url.js';
import { resolveInitialScreen } from './initial-screen.js';
import { createCentralClient, type CentralClient } from '../api/client.js';
import { createBrowserPush, type PushPort } from '../api/push.js';
import { browserSpeech, type SpeechPort } from '../api/speech.js';
import { browserCrypto, type CryptoPort } from '../crypto/device-key.js';
import { initialState } from './reducer.js';
import { browserStorage, readJson, STORAGE_KEYS, type StoragePort } from './storage.js';
import {
  MEMORY_LIMIT,
  type DeviceInfo,
  type MemoryEntry,
  type PagerState,
  type Settings,
} from './types.js';

export const DEVICE_NAME = 'Beeper';

export interface Deps {
  client: CentralClient;
  crypto: CryptoPort | null;
  push: PushPort;
  speech: SpeechPort;
  storage: StoragePort;
  now: () => number;
  /**
   * Live device token. A mutable holder because pairing happens long after the
   * client is built: the client reads it on every call instead of being
   * rebuilt, and the WebSocket reconnects with it.
   */
  deviceToken: { current: string | null };
}

export interface RuntimeInput {
  client?: CentralClient;
  /** Override for tests; by default it is resolved from the page and storage. */
  centralUrl?: string;
  crypto?: CryptoPort | null;
  push?: PushPort;
  speech?: SpeechPort;
  storage?: StoragePort;
  now?: () => number;
  deviceToken?: { current: string | null };
}

export function createDeps(input: RuntimeInput): Deps {
  const storage = input.storage ?? browserStorage();
  const deviceToken = input.deviceToken ?? { current: storedToken(storage) };
  // The Central is same-origin when it serves the pager; elsewhere (GitHub
  // Pages) the URL comes from ?central=, the stored setting, or the build.
  const centralUrl = input.centralUrl ?? resolveCentralUrl();
  return {
    client:
      input.client ??
      createCentralClient({
        baseUrl: centralUrl,
        getDeviceToken: () => deviceToken.current,
      }),
    crypto: input.crypto === undefined ? browserCrypto() : input.crypto,
    push: input.push ?? createBrowserPush({ baseUrl: centralUrl }),
    speech: input.speech ?? browserSpeech,
    storage,
    now: input.now ?? (() => Date.now()),
    deviceToken,
  };
}

/** The token of an already paired device, read back from storage on boot. */
function storedToken(storage: StoragePort): string | null {
  const device = readJson<DeviceInfo | null>(storage, STORAGE_KEYS.device, null);
  return device?.token ?? null;
}

/** Rebuild the state from storage, then let explicit overrides win (tests). */
/** Partial overrides, with a partial `settings` so a test sets one switch only. */
export type StateOverrides = Partial<Omit<PagerState, 'settings'>> & { settings?: Partial<Settings> };

export function hydrateState(
  overrides: StateOverrides | undefined,
  storage: StoragePort,
): PagerState {
  // Boot screen: `?screen=demo` (or any known screen) wins over the default;
  // an explicit override (tests) still wins over the deep-link.
  const base: PagerState = { ...initialState(), screen: resolveInitialScreen() };
  const { settings, ...rest } = overrides ?? {};
  const storedSettings = readJson<Partial<Settings>>(storage, STORAGE_KEYS.settings, {});
  const memory = rest.memory ?? readJson<MemoryEntry[]>(storage, STORAGE_KEYS.memory, []);
  const device = rest.device ?? readJson<DeviceInfo | null>(storage, STORAGE_KEYS.device, null);
  return {
    ...base,
    ...rest,
    settings: { ...base.settings, ...storedSettings, ...(settings ?? {}) },
    memory: memory.slice(0, MEMORY_LIMIT),
    device,
  };
}

export function toMemoryEntry(
  page: PageRecord,
  verdict: Verdict,
  choice: string | null,
  now: number,
): MemoryEntry {
  const startedAt = page.delivered_at ?? page.created_at;
  return {
    pageId: page.id,
    line: page.line,
    risk: page.risk,
    code: page.code,
    station: page.source_alias,
    verdict,
    choice,
    decidedAt: now,
    latencyMs: Math.max(0, now - startedAt),
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unexpected error';
}
