/**
 * Wiring of the Central's collaborators. Kept apart from `server.ts` so the
 * assembly reads as a list of parts rather than a wall of code.
 */
import { DEFAULT_QUIET_HOURS, HOUR, type BudgetPolicy } from '@bipeur/core';
import { hashToken, newId, newToken } from '@bipeur/core/node';
import { AuditLog } from './audit.js';
import { DeliveryGate } from './budget.js';
import type { Config } from './config.js';
import type { CentralContext } from './context.js';
import { createPushSender } from './push.js';
import { ReminderSweeper } from './remind.js';
import { FileRules, type RulesProvider } from './rules.js';
import { Simulator } from './simulator.js';
import { WsHub } from './stream.js';
import type { Store } from './store/types.js';

export interface Wiring {
  ctx: CentralContext;
  audit: AuditLog;
  rules: RulesProvider;
  hub: WsHub;
  gate: DeliveryGate;
  reminders: ReminderSweeper;
  simulator: Simulator;
}

/** Builds every collaborator and hands back the fully populated context. */
export function wire(config: Config, store: Store): Wiring {
  const audit = new AuditLog(store, config.now);
  const rules = new FileRules(config.rulesPath);
  const push = createPushSender(store, config.vapid);
  const hub = new WsHub({ store, budgetPerHour: () => ctx.gate.perHour });
  const ctx: CentralContext = {
    config,
    store,
    audit,
    rules,
    push,
    hub,
    clock: config.now,
    gate: undefined as unknown as DeliveryGate,
  };
  const policy: BudgetPolicy = { perHour: config.budgetPerHour, windowMs: HOUR };
  const gate = new DeliveryGate(ctx, policy, rules.current().quiet_hours ?? DEFAULT_QUIET_HOURS);
  ctx.gate = gate;
  return { ctx, audit, rules, hub, gate, reminders: new ReminderSweeper(ctx), simulator: new Simulator(ctx) };
}

/** The first station: created on boot, token printed once when generated. */
export function ensureBootstrapSource(config: Config, store: Store): string | null {
  const token = config.bootstrapToken ?? newToken();
  const tokenHash = hashToken(token);
  if (!store.sourceByTokenHash(tokenHash)) {
    store.insertSource({
      id: newId('src'),
      alias: config.stationAlias,
      kind: 'cli',
      token_hash: tokenHash,
      last_seen_at: config.now(),
      visitor_id: null,
      revoked_at: null,
    });
  }
  return config.bootstrapToken === null ? token : null;
}
