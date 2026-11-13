/**
 * BIP-P-10 — two requests with the same fingerprint from the same station give
 * one page, as long as the first one is still waiting (BIP-F-11).
 */
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

describe('BIP-P-10 — same fingerprint and station means one page', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('returns the existing page for any number of retries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          command: fc.stringMatching(/^git push origin [a-z]{1,8}$/),
          retries: fc.integer({ min: 2, max: 6 }),
        }),
        async ({ command, retries }) => {
          const request = { kind: 'tool', tool_name: 'shell', command };
          const first = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, request);
          expect(first.status).toBe(201);
          for (let index = 0; index < retries; index += 1) {
            const again = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, request);
            expect(again.status).toBe(200);
            expect(again.body.page_id).toBe(first.body.page_id);
            expect(again.body.fingerprint).toBe(first.body.fingerprint);
          }
        },
      ),
      { numRuns: 10, seed: 20_261_114 },
    );
  });

  it('a different command gives a different page', async () => {
    const one = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const two = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin release',
    });
    expect(two.status).toBe(201);
    expect(two.body.page_id).not.toBe(one.body.page_id);
    expect(two.body.fingerprint).not.toBe(one.body.fingerprint);
  });

  it('after a decision the same request creates a new page', async () => {
    const request = { kind: 'tool', tool_name: 'shell', command: 'git push origin main' };
    const first = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, request);
    await call(bench.central, 'DELETE', `/v1/pages/${first.body.page_id}`, bench.stationToken);
    const again = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, request);
    expect(again.status).toBe(201);
    expect(again.body.page_id).not.toBe(first.body.page_id);
  });
});
