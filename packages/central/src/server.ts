/**
 * Assembly of the Central: one store, one rules file, one HTTP app, one
 * WebSocket hub and one bounded sweeper (BIP-N-09). `createServer` is exported
 * so the tests drive the very same object the binary runs.
 */
import { serve } from '@hono/node-server';
import { DAY } from '@bipeur/core';
import type { Hono } from 'hono';
import type { Server } from 'node:http';
import { createApi } from './api.js';
import type { AuditLog } from './audit.js';
import type { DeliveryGate } from './budget.js';
import { CENTRAL_VERSION, type Config } from './config.js';
import type { CentralContext } from './context.js';
import type { EscalationSweeper } from './escalate.js';
import { expireDue } from './pages.js';
import type { ReminderSweeper } from './remind.js';
import type { RulesProvider } from './rules.js';
import type { Simulator } from './simulator.js';
import type { WsHub } from './stream.js';
import { openStore } from './store/index.js';
import type { Store } from './store/types.js';
import type { ShadowMode } from './shadow.js';
import { checkpoint, checkpointDue } from './transparency.js';
import { ensureBootstrapSource, wire } from './wiring.js';

export interface CentralServer {
  app: Hono;
  store: Store;
  hub: WsHub;
  gate: DeliveryGate;
  /** The shadow-mode switch (BIP-F-42): live, and readable by the dashboard. */
  shadow: ShadowMode;
  audit: AuditLog;
  rules: RulesProvider;
  simulator: Simulator;
  reminders: ReminderSweeper;
  escalation: EscalationSweeper;
  config: Config;
  /** Printed once by `bin.ts` when it was generated; null when supplied. */
  bootstrapToken: string | null;
  url(): string;
  listen(): Promise<{ url: string }>;
  /** One maintenance pass: flush held pages, expire, remind, purge. */
  sweep(now?: number): void;
  close(): Promise<void>;
}

export async function createServer(config: Config): Promise<CentralServer> {
  const store = openStore(config);
  const { ctx, audit, rules, hub, gate, reminders, escalation, simulator } = wire(config, store);
  const app = createApi({ ctx, simulator });
  const bootstrapToken = ensureBootstrapSource(config, store);
  audit.append({
    type: 'central.started',
    data: { version: CENTRAL_VERSION, demo: config.demo, budget_per_hour: config.budgetPerHour },
  });

  const lifecycle = newLifecycle({ config, ctx, app, hub, gate, reminders, escalation, simulator });
  const central: CentralServer = {
    app,
    store,
    hub,
    gate,
    shadow: ctx.shadow,
    audit,
    rules,
    simulator,
    reminders,
    escalation,
    config,
    bootstrapToken,
    url: lifecycle.url,
    listen: lifecycle.listen,
    sweep: lifecycle.sweep,
    close: lifecycle.close,
  };
  if (config.sweepIntervalMs > 0) lifecycle.startTimer(() => central.sweep());
  return central;
}

interface LifecycleDeps {
  config: Config;
  ctx: CentralContext;
  app: Hono;
  hub: WsHub;
  gate: DeliveryGate;
  reminders: ReminderSweeper;
  escalation: EscalationSweeper;
  simulator: Simulator;
}

interface Lifecycle {
  url(): string;
  listen(): Promise<{ url: string }>;
  sweep(now?: number): void;
  close(): Promise<void>;
  startTimer(tick: () => void): void;
}

/** Server handle, sweeper and shutdown: the moving parts of `createServer`. */
function newLifecycle(deps: LifecycleDeps): Lifecycle {
  const { config, ctx, app, hub, gate, reminders, escalation, simulator } = deps;
  let server: Server | null = null;
  let timer: NodeJS.Timeout | null = null;
  let sweeps = 0;
  let closed = false;

  const url = (): string => baseUrl(server, config);

  const listen = async (): Promise<{ url: string }> => {
    if (server) return { url: url() };
    server = await bind(config, app);
    hub.attach(server);
    return { url: url() };
  };

  const sweep = (now: number = config.now()): void => {
    sweeps += 1;
    sweepOnce(ctx, gate, reminders, escalation, now, sweeps % 60 === 0);
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    simulator.close();
    hub.close();
    const current = server;
    server = null;
    if (current) await new Promise<void>((resolveClose) => current.close(() => resolveClose()));
    ctx.store.close();
  };

  const startTimer = (tick: () => void): void => {
    timer = setInterval(tick, config.sweepIntervalMs);
    timer.unref();
  };

  return { url, listen, sweep, close, startTimer };
}

function baseUrl(server: Server | null, config: Config): string {
  const address = server?.address();
  const port = address && typeof address === 'object' ? address.port : config.port;
  return `http://${config.host}:${port}`;
}

/** One maintenance pass (BIP-F-07, F-08, F-09, F-37) plus the hourly retention. */
function sweepOnce(
  ctx: CentralContext,
  gate: DeliveryGate,
  reminders: ReminderSweeper,
  escalation: EscalationSweeper,
  now: number,
  retention: boolean,
): void {
  gate.release(now);
  expireDue(ctx, now);
  escalation.sweep(now);
  reminders.sweep(now);
  // A root is published every CHECKPOINT_EVERY events (BIP-F-45): the cost is
  // one hash pass per hundred events, and an outsider can then check any
  // stretch of the journal without touching this machine.
  if (checkpointDue(ctx)) checkpoint(ctx, ctx.config.anchorPath);
  if (!retention) return;
  ctx.store.purgeEventsBefore(now - ctx.config.retentionDays * DAY);
  ctx.store.purgeVisitorsBefore(now - DAY);
}

function bind(config: Config, app: Hono): Promise<Server> {
  return new Promise<Server>((resolveServer, rejectServer) => {
    const created = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => {
      resolveServer(created as unknown as Server);
    });
    created.once('error', rejectServer);
  });
}
