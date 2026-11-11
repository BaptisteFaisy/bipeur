/**
 * P6 — être protégé du bruit (A.5, BIP-F-09).
 *
 * Seven requests in one minute: the attention budget of six pages per hour
 * holds the seventh, and the held pages wait. A red page always goes
 * through. The scenario runs on its own Central, with its own budget.
 */
import { expect, test } from '@playwright/test';
import { startDedicatedCentral } from './helpers/server.js';

const REQUESTS = Array.from({ length: 7 }, (_, index) => ({
  kind: 'tool',
  tool_name: 'shell',
  command: `curl https://example.com/noise-${index + 1}`,
}));

test('P6 — seven requests give six deliveries and one held page', async () => {
  const dedicated = await startDedicatedCentral(8831);
  try {
    const central = dedicated.central;
    const created = [];
    for (const request of REQUESTS) {
      created.push(await central.createPage(request));
    }
    const delivered = created.filter((page) => page.state === 'delivered');
    const queued = created.filter((page) => page.state === 'queued');
    expect(delivered).toHaveLength(6);
    expect(queued).toHaveLength(1);

    const held = await central.audit(20, 'page.held');
    expect(held.events).toHaveLength(1);
    expect(held.events[0].page_id).toBe(queued[0].page_id);
    expect(held.events[0].data.reason).toBe('budget');
    expect(held.events[0].data.budget).toBe(6);

    const metrics = await central.call<{ in_use: number; budget_per_hour: number }>('/v1/metrics', {
      headers: { authorization: `Bearer ${central.token}` },
    });
    expect(metrics.in_use).toBe(6);
    expect(metrics.budget_per_hour).toBe(6);
  } finally {
    await dedicated.stop();
  }
});

test('P6 — a red page goes through even when the budget is full', async () => {
  const dedicated = await startDedicatedCentral(8832);
  try {
    const central = dedicated.central;
    for (const request of REQUESTS) {
      await central.createPage(request);
    }
    const red = await central.createPage({
      kind: 'tool',
      tool_name: 'shell',
      command: 'rm -rf packages/',
    });
    expect(red.risk).toBe('red');
    expect(red.state).toBe('delivered');
  } finally {
    await dedicated.stop();
  }
});
