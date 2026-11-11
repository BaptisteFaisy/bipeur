/**
 * BIP-F-26 — page_human answers `pending` rather than blocking past the MCP
 * client budget, and never invents a decision.
 */
import { describe, expect, it } from 'vitest';
import { BipeurClient } from '../src/client.js';
import { BipeurService, MCP_BUDGET_MS } from '../src/service.js';
import type { FetchLike } from '../src/types.js';

const PAGE_ID = 'page_42';

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

describe('BIP-F-26 — page_human returns pending when the wait exceeds the budget', () => {
  it('answers pending with the page id when the long poll is aborted', async () => {
    const fetchImpl: FetchLike = async (_input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') return json({ id: PAGE_ID }, 201);
      const error = new Error('This operation was aborted');
      error.name = 'TimeoutError';
      throw error;
    };
    const clock = { t: 0 };
    const result = await service(fetchImpl, {
      budgetMs: 20,
      now: () => {
        clock.t += 10;
        return clock.t;
      },
    }).pageHuman({ question: 'Still there?' });

    expect(result.status).toBe('pending');
    expect(result.page_id).toBe(PAGE_ID);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('answers pending when the Central itself reports pending', async () => {
    const fetchImpl: FetchLike = async (_input, init) =>
      (init?.method ?? 'GET') === 'POST'
        ? json({ id: PAGE_ID }, 201)
        : json({ status: 'pending', page_id: PAGE_ID, fingerprint: 'd'.repeat(64), latency_ms: 0 });
    const result = await service(fetchImpl).pageHuman({ question: 'Still there?' });

    expect(result.status).toBe('pending');
    expect(result.page_id).toBe(PAGE_ID);
    expect(result.choice).toBeNull();
  });

  it('keeps the MCP budget at 50 seconds', () => {
    expect(MCP_BUDGET_MS).toBe(50_000);
  });
});
