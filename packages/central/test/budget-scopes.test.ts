/**
 * BIP-F-31 / BIP-F-09 — the attention budget is scoped: every demo visitor
 * gets its own six-per-hour budget, pages without a visitor share the real
 * operator's scope, and a restart rebuilds every scope (BIP-P-12).
 */
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, restart, startBench } from './helpers.js';

/** A demo visitor with its simulator stopped: only the test posts pages. */
async function startVisitor(bench: Bench): Promise<string> {
  const started = await call(bench.central, 'POST', '/v1/demo/start', bench.stationToken, {});
  expect(started.status).toBe(201);
  bench.central.simulator.stop(started.body.visitor_id);
  return started.body.station_token as string;
}

async function postGreen(bench: Bench, token: string, label: string): Promise<string> {
  const created = await call(bench.central, 'POST', '/v1/pages', token, {
    kind: 'question',
    question: `scope check ${label}`,
    options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
  });
  expect([200, 201]).toContain(created.status);
  return created.body.state as string;
}

async function postRed(bench: Bench, token: string, label: string): Promise<string> {
  const created = await call(bench.central, 'POST', '/v1/pages', token, {
    kind: 'tool',
    tool_name: 'shell',
    command: `rm -rf build-${label}`,
  });
  expect([200, 201]).toContain(created.status);
  expect(created.body.risk).toBe('red');
  return created.body.state as string;
}

describe('BIP-F-31 — each demo visitor has its own attention budget', () => {
  let bench: Bench;
  afterEach(async () => {
    await bench.close();
  });

  it('two visitors each get six deliveries and each seventh page is held', async () => {
    bench = await startBench({ demo: true });
    const first = await startVisitor(bench);
    const second = await startVisitor(bench);
    const statesA: string[] = [];
    const statesB: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      statesA.push(await postGreen(bench, first, `a${index}`));
      statesB.push(await postGreen(bench, second, `b${index}`));
    }
    expect(statesA.slice(0, 6)).toEqual(Array(6).fill('delivered'));
    expect(statesA[6]).toBe('queued');
    expect(statesB.slice(0, 6)).toEqual(Array(6).fill('delivered'));
    expect(statesB[6]).toBe('queued');
    // Twelve deliveries in total, not six shared between the two judges.
    expect(bench.central.audit.list({ type: 'page.delivered' })).toHaveLength(12);
  });

  it('the operator scope and a visitor scope never consume each other', async () => {
    bench = await startBench({ demo: true });
    const visitor = await startVisitor(bench);
    for (let index = 0; index < 6; index += 1) {
      expect(await postGreen(bench, visitor, `v${index}`)).toBe('delivered');
    }
    expect(await postGreen(bench, visitor, 'v6')).toBe('queued');
    // The real operator (visitor_id null) still has a full budget.
    for (let index = 0; index < 6; index += 1) {
      expect(await postGreen(bench, bench.stationToken, `o${index}`)).toBe('delivered');
    }
    expect(await postGreen(bench, bench.stationToken, 'o6')).toBe('queued');
    // The other way round: a saturated operator does not starve a new visitor.
    const fresh = await startVisitor(bench);
    expect(await postGreen(bench, fresh, 'f0')).toBe('delivered');
  });

  it('red and family 9 go through in every saturated scope (BIP-P-08)', async () => {
    bench = await startBench({ demo: true });
    const visitor = await startVisitor(bench);
    for (let index = 0; index < 6; index += 1) await postGreen(bench, visitor, `s${index}`);
    expect(await postRed(bench, visitor, 'held-scope')).toBe('delivered');
    const emergency = await call(bench.central, 'POST', '/v1/pages', visitor, {
      kind: 'question',
      question: 'registry unreachable in a saturated scope',
      code: 911,
      options: [{ code: 'A', label: 'retry' }, { code: 'B', label: 'abort' }],
    });
    expect(emergency.body.state).toBe('delivered');
  });

  it('metrics in_use describes the operator scope, not the visitors', async () => {
    bench = await startBench({ demo: true });
    const visitor = await startVisitor(bench);
    for (let index = 0; index < 4; index += 1) await postGreen(bench, visitor, `m${index}`);
    let metrics = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(metrics.body.budget_per_hour).toBe(6);
    expect(metrics.body.in_use).toBe(0);
    await postGreen(bench, bench.stationToken, 'm-op');
    metrics = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(metrics.body.in_use).toBe(1);
  });
});

describe('BIP-P-12 — a restart rebuilds every scope from the pages table', () => {
  it('keeps a saturated visitor saturated and leaves a new visitor free', async () => {
    const bench = await startBench({ demo: true });
    try {
      const visitor = await startVisitor(bench);
      for (let index = 0; index < 6; index += 1) {
        expect(await postGreen(bench, visitor, `r${index}`)).toBe('delivered');
      }
      for (let index = 0; index < 3; index += 1) {
        expect(await postGreen(bench, bench.stationToken, `ro${index}`)).toBe('delivered');
      }
      const reopened = await restart(bench);
      // The known visitor is still saturated: the seventh page is held.
      expect(await postGreen(reopened, visitor, 'r6')).toBe('queued');
      // The operator scope kept its three deliveries: three more still fit.
      for (let index = 3; index < 6; index += 1) {
        expect(await postGreen(reopened, bench.stationToken, `ro${index}`)).toBe('delivered');
      }
      expect(await postGreen(reopened, bench.stationToken, 'ro6')).toBe('queued');
      // A brand new visitor starts with a full budget.
      const fresh = await startVisitor(reopened);
      for (let index = 0; index < 6; index += 1) {
        expect(await postGreen(reopened, fresh, `n${index}`)).toBe('delivered');
      }
      expect(await postGreen(reopened, fresh, 'n6')).toBe('queued');
    } finally {
      await bench.close();
    }
  });
});

describe('BIP-P-07 / BIP-P-08 hold per scope', () => {
  it('never more than six green pages per scope, red always delivered', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            scope: fc.constantFrom('a', 'b', 'operator'),
            red: fc.boolean(),
          }),
          { minLength: 1, maxLength: 24 },
        ),
        async (requests) => {
          const bench = await startBench({ demo: true });
          try {
            const tokens: Record<string, string> = {
              a: await startVisitor(bench),
              b: await startVisitor(bench),
              operator: bench.stationToken,
            };
            const postedGreen: Record<string, number> = { a: 0, b: 0, operator: 0 };
            const deliveredGreen: Record<string, number> = { a: 0, b: 0, operator: 0 };
            for (const [index, request] of requests.entries()) {
              const token = tokens[request.scope]!;
              if (request.red) {
                expect(await postRed(bench, token, `p${index}`)).toBe('delivered');
                continue;
              }
              const state = await postGreen(bench, token, `p${index}`);
              postedGreen[request.scope] += 1;
              if (state === 'delivered') deliveredGreen[request.scope] += 1;
              // BIP-P-07 per scope: the sliding hour never carries more than six.
              expect(deliveredGreen[request.scope]).toBeLessThanOrEqual(6);
            }
            // BIP-F-09 per scope: greens go out until the scope is full.
            for (const scope of ['a', 'b', 'operator']) {
              expect(deliveredGreen[scope]).toBe(Math.min(6, postedGreen[scope]!));
            }
          } finally {
            await bench.close();
          }
        },
      ),
      { numRuns: 6, seed: 20_261_115 },
    );
  });
});
