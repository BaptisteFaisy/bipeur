/**
 * The background process of the Crew app (BIP-F-27): Gateway events in, pager
 * pages out, signed decisions back into an approval resolution.
 *
 * Reliability: events go through a bounded local queue, each one is retried a
 * bounded number of times, and the Gateway reconnects with a bounded backoff.
 * Idempotence: one approval record (id + instance) means one page (dedupe
 * key) and one resolution — the Gateway's `response_id` replays the same
 * outcome on a retry, so a decision is never resolved twice.
 */
import { LINE_MAX, SECOND, toLineText } from '@bipeur/core';
import type { CrewAuth } from './auth.js';
import type { BeeperClient, PageSummary } from './beeper.js';
import { endpointOf, wsEndpointOf, type CrewConfig } from './config.js';
import { approvalDedupeKey, parseFrame, type CrewFrame } from './events.js';
import { createWebSocketGateway, type CrewGateway } from './gateway.js';
import { BoundedQueue } from './queue.js';
import { resolveApproval, toResolution } from './resolve.js';
import { waitForDecision } from './wait.js';

export const EVENT_ATTEMPTS = 3;
const FLUSH_ROUNDS = 100;

export interface RelayDeps {
  gateway?: CrewGateway;
  auth?: CrewAuth;
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
  auth: CrewAuth;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetchImpl: typeof fetch | undefined;
  log: (line: string) => void;
  queue: BoundedQueue<CrewFrame>;
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

/** The Beeper journal of record, then the Crew notification bus — both best effort. */
async function postNotice(ctx: Ctx, line: string): Promise<void> {
  const text = noticeLine('CREW', line);
  await ctx.client.postNotice(text, ctx.config.station);
  await pushCrewNotice(ctx, text);
}

async function pushCrewNotice(ctx: Ctx, line: string): Promise<void> {
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
  try {
    const cookie = await ctx.auth.cookieHeader();
    await fetchImpl(endpointOf(ctx.config.gatewayUrl, ctx.config.notificationPath), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ channel: 'journal', title: 'Beeper', body: line, priority: 'passive' }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    ctx.log(`crew notice push failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A notice that must never break the relay, but must never be silent either. */
async function postNoticeSafely(ctx: Ctx, line: string): Promise<void> {
  try {
    await postNotice(ctx, line);
  } catch (error) {
    ctx.log(`crew notice failed (${line}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function awaitDecision(ctx: Ctx, page: PageSummary, frame: CrewFrame & { type: 'approval' }): Promise<void> {
  const data = frame.data;
  const approvalId = data.id;
  const deadline = ctx.now() + ctx.config.ttlSeconds * SECOND;
  const decision = await waitForDecision({
    client: ctx.client,
    pageId: page.id,
    deadline,
    waitSeconds: ctx.config.waitSeconds,
    now: ctx.now,
    sleep: ctx.sleep,
  });
  const resolution = toResolution(approvalId, data.instance ?? '', data.slot ?? '', decision);
  const outcome = await resolveApproval(ctx.config, ctx.auth, resolution, {
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
  });
  if (outcome.ok) {
    ctx.resolved.add(approvalId);
    return;
  }
  if (outcome.settled) {
    ctx.resolved.add(approvalId);
    ctx.log(`crew approval ${approvalId} already settled on the Gateway`);
    await postNoticeSafely(ctx, `SETTLED ${approvalId} decided elsewhere`);
    return;
  }
  ctx.log(`crew approval ${approvalId} unresolved after ${outcome.attempts} attempts: ${outcome.error}`);
  await postNoticeSafely(ctx, `RESOLVE FAILED ${approvalId} after ${outcome.attempts} tries`);
}

async function handleApproval(ctx: Ctx, frame: CrewFrame & { type: 'approval' }): Promise<void> {
  const data = frame.data;
  if (ctx.resolved.has(data.id) || ctx.inFlight.has(data.id)) return;
  const page = await ctx.client.createPage({
    kind: 'tool',
    tool_name: (data.tool ?? 'crew.approval').slice(0, 64),
    agent_says: data.tool_purpose ?? '',
    dedupe_key: approvalDedupeKey(data.id, data.instance),
    station: ctx.config.station,
    ttl_seconds: ctx.config.ttlSeconds,
    ...(data.tool_input === undefined ? {} : { command: data.tool_input }),
  });
  const task = (async () => {
    try {
      await awaitDecision(ctx, page, frame);
    } finally {
      ctx.inFlight.delete(data.id);
    }
  })();
  ctx.inFlight.set(data.id, task);
}

function journalText(frame: CrewFrame & { type: 'notification' | 'task_complete' | 'task_update' }): string {
  if (frame.type === 'notification') {
    const data = frame.data;
    return `NOTIFY ${data.title ?? data.body ?? data.channel ?? 'notification'}`;
  }
  return `DONE ${frame.data.summary ?? frame.data.task_id ?? 'task'}`;
}

async function handleEvent(ctx: Ctx, frame: CrewFrame): Promise<void> {
  switch (frame.type) {
    case 'approval':
      await handleApproval(ctx, frame);
      return;
    case 'approval_resolved':
      // Decided on the dashboard first: never page for it again; a decision
      // already in flight meets the Gateway's 404 and journals SETTLED.
      ctx.resolved.add(frame.data.id);
      return;
    case 'notification':
    case 'task_complete':
    case 'task_update':
      await postNotice(ctx, journalText(frame));
      return;
  }
}

/** Bounded retries: an event is dropped only after `EVENT_ATTEMPTS` failures, and loudly. */
async function dispatch(ctx: Ctx, frame: CrewFrame): Promise<void> {
  for (let attempt = 1; attempt <= EVENT_ATTEMPTS; attempt += 1) {
    try {
      await handleEvent(ctx, frame);
      return;
    } catch (error) {
      if (attempt === EVENT_ATTEMPTS) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.log(`crew event ${frame.type} dropped after ${attempt} attempts: ${reason}`);
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
        const frame = ctx.queue.shift();
        if (frame === undefined) return;
        await dispatch(ctx, frame);
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
    auth: deps.auth ?? stubAuth(deps.log),
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? defaultSleep,
    fetchImpl: deps.fetchImpl,
    log: deps.log ?? ((line: string) => console.log(line)),
    queue: new BoundedQueue<CrewFrame>(config.queueLimit),
    inFlight: new Map(),
    resolved: new Set(),
    pumpPromise: null,
  };

  const gateway =
    deps.gateway ??
    createWebSocketGateway({
      url: wsEndpointOf(config),
      headers: async () => ({ cookie: await ctx.auth.cookieHeader() }),
      backoffMs: config.backoffMs,
      maxBackoffMs: config.maxBackoffMs,
      onState: (state) => ctx.log(`crew gateway ${state}`),
    });

  gateway.start((raw) => {
    const frame = parseFrame(raw);
    if (frame === null) {
      ctx.log('crew event ignored: unrecognised shape');
      return;
    }
    ctx.queue.push(frame);
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

/** Relay unit tests inject no auth: resolutions then carry no cookie. */
function stubAuth(log?: (line: string) => void): CrewAuth {
  return {
    token: async () => '',
    cookieHeader: async () => '',
    invalidate: () => log?.('crew auth invalidated without a secret source'),
  };
}
