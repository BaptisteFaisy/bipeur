/**
 * The background process of the Crew app (BIP-F-27): Gateway events in, pager
 * pages out, signed decisions back into an approval resolution.
 *
 * Reliability: events go through a bounded local queue, each one is retried a
 * bounded number of times, and the Gateway reconnects with a bounded backoff.
 * Idempotence: one approval_id means one page (dedupe key) and one resolution.
 */
import { LINE_MAX, SECOND, toLineText } from '@bipeur/core';
import type { BeeperClient, PageSummary } from './beeper.js';
import type { CrewConfig } from './config.js';
import { approvalDedupeKey, parseEvent, type ApprovalEvent, type CrewEvent } from './events.js';
import { createWebSocketGateway, type CrewGateway } from './gateway.js';
import { BoundedQueue } from './queue.js';
import { resolveApproval, toResolution } from './resolve.js';
import { waitForDecision } from './wait.js';

export const EVENT_ATTEMPTS = 3;
const FLUSH_ROUNDS = 100;

export interface RelayDeps {
  gateway?: CrewGateway;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export interface Relay {
  readonly gateway: CrewGateway;
  stop(): void;
  /** Wait for the queue to drain and every decision in flight to be resolved. */
  flush(): Promise<void>;
}

interface Ctx {
  config: CrewConfig;
  client: BeeperClient;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetchImpl: typeof fetch | undefined;
  log: (line: string) => void;
  queue: BoundedQueue<CrewEvent>;
  inFlight: Map<string, Promise<void>>;
  resolved: Set<string>;
  pumpPromise: Promise<void> | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function noticeLine(prefix: string, text: string): string {
  return `${prefix} ${toLineText(text)}`.slice(0, LINE_MAX);
}

async function postNotice(ctx: Ctx, line: string): Promise<void> {
  await ctx.client.postNotice(noticeLine('CREW', line), ctx.config.station);
}

/** A notice that must never break the relay, but must never be silent either. */
async function postNoticeSafely(ctx: Ctx, line: string): Promise<void> {
  try {
    await postNotice(ctx, line);
  } catch (error) {
    ctx.log(`crew notice failed (${line}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function awaitDecision(ctx: Ctx, page: PageSummary, approvalId: string): Promise<void> {
  const deadline = ctx.now() + ctx.config.ttlSeconds * SECOND;
  const decision = await waitForDecision({
    client: ctx.client,
    pageId: page.id,
    deadline,
    waitSeconds: ctx.config.waitSeconds,
    now: ctx.now,
    sleep: ctx.sleep,
  });
  const outcome = await resolveApproval(ctx.config, toResolution(approvalId, decision), {
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
  });
  if (outcome.ok) {
    ctx.resolved.add(approvalId);
    return;
  }
  ctx.log(`crew approval ${approvalId} unresolved after ${outcome.attempts} attempts: ${outcome.error}`);
  await postNoticeSafely(ctx, `RESOLVE FAILED ${approvalId} after ${outcome.attempts} tries`);
}

async function handleApproval(ctx: Ctx, event: ApprovalEvent): Promise<void> {
  if (ctx.resolved.has(event.approval_id) || ctx.inFlight.has(event.approval_id)) return;
  const page = await ctx.client.createPage({
    kind: 'tool',
    tool_name: 'crew.approval',
    agent_says: event.summary ?? '',
    dedupe_key: approvalDedupeKey(event.approval_id),
    station: ctx.config.station,
    ttl_seconds: ctx.config.ttlSeconds,
    ...(event.command === undefined ? {} : { command: event.command }),
    ...(event.path === undefined ? {} : { path: event.path }),
  });
  const task = (async () => {
    try {
      await awaitDecision(ctx, page, event.approval_id);
    } finally {
      ctx.inFlight.delete(event.approval_id);
    }
  })();
  ctx.inFlight.set(event.approval_id, task);
}

async function handleEvent(ctx: Ctx, event: CrewEvent): Promise<void> {
  switch (event.type) {
    case 'approval':
      await handleApproval(ctx, event);
      return;
    case 'task_complete':
      await postNotice(ctx, `DONE ${event.summary ?? event.task_id}`);
      return;
    case 'notification':
      await postNotice(ctx, `NOTIFY ${event.message}`);
      return;
  }
}

/** Bounded retries: an event is dropped only after `EVENT_ATTEMPTS` failures, and loudly. */
async function dispatch(ctx: Ctx, event: CrewEvent): Promise<void> {
  for (let attempt = 1; attempt <= EVENT_ATTEMPTS; attempt += 1) {
    try {
      await handleEvent(ctx, event);
      return;
    } catch (error) {
      if (attempt === EVENT_ATTEMPTS) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.log(`crew event ${event.type} dropped after ${attempt} attempts: ${reason}`);
        return;
      }
      await ctx.sleep(ctx.config.backoffMs * 2 ** (attempt - 1));
    }
  }
}

function pump(ctx: Ctx): Promise<void> {
  if (ctx.pumpPromise !== null) return ctx.pumpPromise;
  ctx.pumpPromise = (async () => {
    try {
      for (;;) {
        const event = ctx.queue.shift();
        if (event === undefined) return;
        await dispatch(ctx, event);
      }
    } finally {
      ctx.pumpPromise = null;
    }
  })();
  return ctx.pumpPromise;
}

async function flush(ctx: Ctx): Promise<void> {
  for (let round = 0; round < FLUSH_ROUNDS; round += 1) {
    await pump(ctx);
    const pending = [...ctx.inFlight.values()];
    if (pending.length === 0 && ctx.queue.size === 0) return;
    await Promise.allSettled(pending);
  }
}

export function relay(config: CrewConfig, client: BeeperClient, deps: RelayDeps = {}): Relay {
  const ctx: Ctx = {
    config,
    client,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? defaultSleep,
    fetchImpl: deps.fetchImpl,
    log: deps.log ?? ((line: string) => console.log(line)),
    queue: new BoundedQueue<CrewEvent>(config.queueLimit),
    inFlight: new Map(),
    resolved: new Set(),
    pumpPromise: null,
  };

  const gateway =
    deps.gateway ??
    createWebSocketGateway({
      url: config.gatewayUrl,
      backoffMs: config.backoffMs,
      maxBackoffMs: config.maxBackoffMs,
      onState: (state) => ctx.log(`crew gateway ${state}`),
    });

  gateway.start((raw) => {
    const event = parseEvent(raw);
    if (event === null) {
      ctx.log('crew event ignored: unrecognised shape');
      return;
    }
    ctx.queue.push(event);
    void pump(ctx);
  });

  return {
    gateway,
    stop() {
      gateway.stop();
    },
    flush: () => flush(ctx),
  };
}
