/** Test doubles: no network, no socket, no timer. */
import type { CreatePageRequest, WaitResponse } from '@bipeur/core';
import type { BeeperClient } from '../src/beeper.js';
import type { CrewGateway } from '../src/gateway.js';

export interface BeeperScript {
  decisions?: WaitResponse['status'][];
  choice?: string | null;
}

export interface FakeBeeper {
  client: BeeperClient;
  created: CreatePageRequest[];
  notices: string[];
  waits: number;
}

export function fakeBeeper(script: BeeperScript = {}): FakeBeeper {
  const created: CreatePageRequest[] = [];
  const notices: string[] = [];
  const state = { waits: 0 };
  let poll = 0;
  const client: BeeperClient = {
    async createPage(request) {
      created.push(request);
      return { id: `page_${created.length}`, line: '110 crew RUN crew.approval #a3f9' };
    },
    async waitDecision(pageId) {
      const statuses = script.decisions ?? ['approved'];
      const status = statuses[Math.min(poll, statuses.length - 1)] ?? 'approved';
      poll += 1;
      state.waits += 1;
      return {
        status,
        page_id: pageId,
        choice: script.choice ?? null,
        fingerprint: 'f'.repeat(64),
        latency_ms: 100,
      };
    },
    async postNotice(line) {
      notices.push(line);
    },
  };
  return {
    client,
    created,
    notices,
    get waits() {
      return state.waits;
    },
  };
}

export interface FakeGateway extends CrewGateway {
  emit(event: unknown): void;
}

export function fakeGateway(): FakeGateway {
  let handler: ((event: unknown) => void) | null = null;
  return {
    state: 'connected',
    start(next) {
      handler = next;
    },
    stop() {
      handler = null;
    },
    emit(event) {
      handler?.(event);
    },
  };
}

export interface FakeGatewayFetch {
  fetchImpl: typeof fetch;
  calls: { url: string; body: unknown }[];
}

/** Simulates the Crew Gateway REST endpoint used to resolve an approval. */
export function fakeGatewayFetch(script: { failTimes?: number; status?: number } = {}): FakeGatewayFetch {
  const calls: { url: string; body: unknown }[] = [];
  let failures = script.failTimes ?? 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    if (failures > 0) {
      failures -= 1;
      throw new TypeError('gateway unreachable');
    }
    return new Response('{}', { status: script.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export function fakeClock(start = 1_000_000): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let current = start;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}
