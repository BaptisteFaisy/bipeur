/** One-line mounting of the whole pager against the fake Central. */
import type { PageRecord } from '@bipeur/core';
import { App } from '../../src/App.js';
import type { Lang } from '../../src/i18n/index.js';
import { memoryStorage, type StoragePort } from '../../src/state/storage.js';
import type { Settings } from '../../src/state/types.js';
import { createFakeClient, type FakeClient } from './fake-client.js';
import type { CryptoPort, DeviceKeys } from '../../src/crypto/device-key.js';
import { TEST_DEVICE, testKeys } from './keys.js';
import { mount, type Harness } from './render.js';

/** Fixed clock: 1 000 500 ms, half a second after the fixture was delivered. */
export const TEST_NOW = 1_000_500;

export interface PagerHarness extends Harness {
  client: FakeClient;
  keys: DeviceKeys;
}

export interface MountOptions {
  pages?: PageRecord[];
  failSend?: boolean;
  ack?: { status: 'accepted' | 'rejected' | 'duplicate'; reason: string | null };
  lang?: Lang;
  settings?: Partial<Settings>;
  /** `false` mounts an unpaired pager. */
  paired?: boolean;
  /** `false` mounts a pager with no key in memory (a reloaded tab). */
  withKeys?: boolean;
  now?: number;
  /** Defaults to a fresh in-memory store: no test leaks state into another. */
  storage?: StoragePort;
  /** `null` simulates a browser without the WebCrypto we need. */
  crypto?: CryptoPort | null;
}

export async function mountPager(options: MountOptions = {}): Promise<PagerHarness> {
  const keys = await testKeys();
  const client = createFakeClient({
    pages: options.pages,
    failSend: options.failSend,
    ack: options.ack,
  });
  const settings: Partial<Settings> = { ...(options.settings ?? {}) };
  if (options.lang) settings.lang = options.lang;
  const ui = await mount(
    <App
      client={client}
      storage={options.storage ?? memoryStorage()}
      crypto={options.crypto}
      deviceKeys={options.withKeys === false ? null : keys}
      now={() => options.now ?? TEST_NOW}
      initialState={{
        settings,
        ...(options.paired === false ? {} : { device: TEST_DEVICE }),
      }}
    />,
  );
  return { ...ui, client, keys };
}
