/**
 * BIP-F-26 — the tool logic against a recorded fake Central: no socket, no
 * port, and a simulated clock wherever time matters.
 */
import { describe, expect, it } from 'vitest';
import { BipeurClient } from '../src/client.js';
import { BipeurError, BipeurService, HUMAN_WAIT_SECONDS } from '../src/service.js';
import type { FetchLike } from '../src/types.js';

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function fakeFetch(handler: (call: Call) => Response | Promise<Response>): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function service(fetchImpl: FetchLike, options: { budgetMs?: number; now?: () => number } = {}): BipeurService {
  return new BipeurService(
    new BipeurClient({ url: 'http://central.test', token: 'bip_test', fetchImpl }),
    options,
  );
}

const PAGE_ID = 'page_42';

describe('BIP-F-26 — page_human creates a question page and returns the decision', () => {
  it('sends the question and reports an approval', async () => {
    const central = fakeFetch((call) =>
      call.method === 'POST'
        ? json({ id: PAGE_ID }, 201)
        : json({
            status: 'approved',
            page_id: PAGE_ID,
            fingerprint: 'a'.repeat(64),
            latency_ms: 4100,
          }),
    );
    const result = await service(central.fetchImpl).pageHuman({
      question: 'Deploy main?',
      options: [
        { code: 'A', label: 'yes' },
        { code: 'B', label: 'no' },
      ],
    });

    expect(result).toEqual({ status: 'approved', page_id: PAGE_ID, choice: null, latency_ms: 4100 });
    expect(central.calls[0]?.url).toBe('http://central.test/v1/pages');
    expect(central.calls[0]?.body).toMatchObject({ kind: 'question', question: 'Deploy main?' });
    expect(central.calls[1]?.url).toBe(
      `http://central.test/v1/pages/${PAGE_ID}/decision?wait=${HUMAN_WAIT_SECONDS}`,
    );
  });

  it('reports the chosen option', async () => {
    const central = fakeFetch((call) =>
      call.method === 'POST'
        ? json({ id: PAGE_ID }, 201)
        : json({ status: 'choice', page_id: PAGE_ID, choice: 'B', fingerprint: 'b'.repeat(64), latency_ms: 900 }),
    );
    const result = await service(central.fetchImpl).pageHuman({ question: 'Which date library?' });
    expect(result.status).toBe('choice');
    expect(result.choice).toBe('B');
  });

  it('reports an expiry as expired, never as an approval', async () => {
    const central = fakeFetch((call) =>
      call.method === 'POST'
        ? json({ id: PAGE_ID }, 201)
        : json({ status: 'expired', page_id: PAGE_ID, fingerprint: 'c'.repeat(64), latency_ms: 0 }),
    );
    const result = await service(central.fetchImpl).pageHuman({ question: 'Ship it?' });
    expect(result.status).toBe('expired');
  });
});

describe('BIP-F-26 — an unreachable Central is a tool error, not a fake decision', () => {
  it('throws a BipeurError when the page cannot be created', async () => {
    const central = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(service(central.fetchImpl).pageHuman({ question: 'Deploy?' })).rejects.toBeInstanceOf(
      BipeurError,
    );
  });

  it('throws a BipeurError when the decision call fails', async () => {
    const central = fakeFetch((call) =>
      call.method === 'POST' ? json({ id: PAGE_ID }, 201) : json({ error: 'down' }, 500),
    );
    await expect(service(central.fetchImpl).pageHuman({ question: 'Deploy?' })).rejects.toThrow(
      /unreachable/,
    );
  });
});

describe('BIP-F-26 — page_wait keeps waiting on the same page', () => {
  it('polls the given page and never creates a second one', async () => {
    const central = fakeFetch(() =>
      json({ status: 'approved', page_id: PAGE_ID, fingerprint: 'e'.repeat(64), latency_ms: 12_000 }),
    );
    const result = await service(central.fetchImpl).pageWait({ page_id: PAGE_ID, wait_seconds: 20 });
    expect(result.status).toBe('approved');
    expect(central.calls).toHaveLength(1);
    expect(central.calls[0]?.method).toBe('GET');
    expect(central.calls[0]?.url).toContain('wait=20');
  });

  it('caps a long wait at the 50-second budget', async () => {
    const central = fakeFetch(() =>
      json({ status: 'pending', page_id: PAGE_ID, fingerprint: 'f'.repeat(64), latency_ms: 0 }),
    );
    await service(central.fetchImpl).pageWait({ page_id: PAGE_ID, wait_seconds: 600 });
    expect(central.calls[0]?.url).toContain(`wait=${HUMAN_WAIT_SECONDS}`);
  });
});

describe('BIP-F-26 — page_cancel cancels, and is idempotent', () => {
  it('deletes the page and reports it cancelled', async () => {
    const central = fakeFetch(() => json({ ok: true }));
    const result = await service(central.fetchImpl).pageCancel({ page_id: PAGE_ID, reason: 'obsolete' });
    expect(result).toEqual({ cancelled: true });
    expect(central.calls[0]?.method).toBe('DELETE');
    expect(central.calls[0]?.body).toEqual({ reason: 'obsolete' });
  });

  it('treats an already gone page as cancelled', async () => {
    const central = fakeFetch(() => json({ error: 'not found' }, 404));
    const result = await service(central.fetchImpl).pageCancel({ page_id: PAGE_ID });
    expect(result).toEqual({ cancelled: true });
  });

  it('raises a tool error when the Central refuses the cancellation', async () => {
    const central = fakeFetch(() => json({ error: 'boom' }, 500));
    await expect(service(central.fetchImpl).pageCancel({ page_id: PAGE_ID })).rejects.toBeInstanceOf(
      BipeurError,
    );
  });
});
