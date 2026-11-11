/** Tiny storage port so the pager never touches `localStorage` directly. */

export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const STORAGE_KEYS = {
  settings: 'bipeur.settings',
  memory: 'bipeur.memory',
  device: 'bipeur.device',
} as const;

/** In-memory implementation: the default in tests, the fallback in private mode. */
export function memoryStorage(seed: Record<string, string> = {}): StoragePort {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}

/** `localStorage` when the browser allows it, otherwise an ephemeral map. */
export function browserStorage(): StoragePort {
  try {
    const local = globalThis.localStorage;
    const probe = 'bipeur.probe';
    local.setItem(probe, '1');
    local.removeItem(probe);
    return {
      get: (key) => local.getItem(key),
      set: (key, value) => local.setItem(key, value),
      remove: (key) => local.removeItem(key),
    };
  } catch {
    return memoryStorage();
  }
}

export function readJson<T>(storage: StoragePort, key: string, fallback: T): T {
  const raw = storage.get(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(storage: StoragePort, key: string, value: unknown): void {
  try {
    storage.set(key, JSON.stringify(value));
  } catch {
    /* a full or blocked storage never breaks the pager */
  }
}
