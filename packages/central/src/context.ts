/**
 * The dependency bag every Central module receives. Type-only imports on
 * purpose: `context.ts` must stay free of runtime cycles.
 */
import type { AuditLog } from './audit.js';
import type { DeliveryGate } from './budget.js';
import type { Config } from './config.js';
import type { PushSender } from './push.js';
import type { RulesProvider } from './rules.js';
import type { Store } from './store/types.js';
import type { StreamHub } from './stream.js';

export interface CentralContext {
  config: Config;
  store: Store;
  audit: AuditLog;
  rules: RulesProvider;
  hub: StreamHub;
  push: PushSender;
  gate: DeliveryGate;
  clock: () => number;
}
