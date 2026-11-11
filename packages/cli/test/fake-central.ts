/** A scripted Central: no network, no port, no timer. */
import type { WaitResponse } from '@bipeur/core';

export interface FakeScript {
  pageId?: string;
  line?: string;
  /** Statuses returned by successive decision polls; the last one repeats. */
  decisions?: WaitResponse['status'][];
  choice?: string | null;
  latencyMs?: number;
  /** Throw as an unreachable Central would. */
  failCreate?: boolean;
  /** Answer a non-2xx status on page creation. */
  statusCreate?: number;
}

export interface FakeCall {
  method: string;
  url: string;
  body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function fakeCentral(script: FakeScript = {}): {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  let poll = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });

    if (method === 'POST' && url.endsWith('/v1/pages')) {
      if (script.failCreate) throw new TypeError('fetch failed');
      if (script.statusCreate !== undefined) return json({ error: 'boom' }, script.statusCreate);
      return json({
        id: script.pageId ?? 'page_1',
        line: script.line ?? '510 crew PICK Deploy now? #a3f9',
      });
    }
    if (url.includes('/decision')) {
      const statuses = script.decisions ?? ['approved'];
      const status = statuses[Math.min(poll, statuses.length - 1)] ?? 'approved';
      poll += 1;
      return json({
        status,
        page_id: script.pageId ?? 'page_1',
        choice: script.choice ?? null,
        fingerprint: 'f'.repeat(64),
        latency_ms: script.latencyMs ?? 1500,
      });
    }
    if (method === 'POST' && url.endsWith('/v1/notices')) return json({ id: 'notice_1' });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** A clock the test moves: no real sleeping, ever. */
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
