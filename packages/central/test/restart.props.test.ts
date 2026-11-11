/**
 * BIP-P-12 — a stop/restart at any instant loses and duplicates nothing.
 * The store is reopened on the real SQLite file, exactly like a process restart.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, restart, startBench } from './helpers.js';

describe('BIP-P-12 — restart loses no pending page and duplicates none', () => {
  it('keeps every queued page across a restart at any point', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^pnpm publish --tag [a-z]{1,6}$/), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        async (commands, restartAfter) => {
          const bench: Bench = await startBench();
          const ids: string[] = [];
          try {
            for (const [index, command] of commands.entries()) {
              if (index === restartAfter) await restart(bench);
              const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
                kind: 'tool',
                tool_name: 'shell',
                command,
              });
              expect([200, 201]).toContain(created.status);
              if (!ids.includes(created.body.page_id)) ids.push(created.body.page_id);
            }
            await restart(bench);
            const pages = bench.central.store.listPages({ state: 'pending', limit: 100 });
            const pendingIds = pages.map((page) => page.id);
            expect(new Set(pendingIds).size).toBe(pendingIds.length);
            for (const id of ids) expect(pendingIds).toContain(id);
          } finally {
            await bench.close();
          }
        },
      ),
      { numRuns: 6, seed: 20_261_115 },
    );
  });

  it('a page waiting for a decision survives a restart and can still be decided', async () => {
    const bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const reopened = await restart(bench);
    const waited = await call(reopened.central, 'GET', `/v1/pages/${created.body.page_id}/decision?wait=1`, reopened.stationToken);
    expect(waited.status).toBe(200);
    expect(waited.body.status).toBe('pending');
    expect(waited.body.fingerprint).toBe(created.body.fingerprint);
    const cancelled = await call(reopened.central, 'DELETE', `/v1/pages/${created.body.page_id}`, reopened.stationToken);
    expect(cancelled.body.state).toBe('cancelled');
    await reopened.close();
  });

  it('the audit log is append-only across a restart', async () => {
    const bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'ship it?',
      options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
    });
    const before = bench.central.audit.list({ limit: 500 }).length;
    const reopened = await restart(bench);
    const after = reopened.central.audit.list({ limit: 500 });
    expect(after.length).toBeGreaterThanOrEqual(before);
    expect(after.some((event) => event.type === 'central.started')).toBe(true);
    expect(() => reopened.central.store.purgeEventsBefore(0)).not.toThrow();
    await reopened.close();
  });
});
