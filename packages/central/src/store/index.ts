/** Store factory: one file, one process (BIP-N-09). */
import type { Config } from '../config.js';
import { SqliteStore } from './sqlite.js';
import type { Store } from './types.js';

export function openStore(config: Config): Store {
  return new SqliteStore(config.dbPath);
}

export { SqliteStore };
export type * from './types.js';
