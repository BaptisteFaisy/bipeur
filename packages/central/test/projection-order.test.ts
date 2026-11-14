/**
 * BIP-F-47 / A.6 — the agent's prose stays on the LAST screen.
 *
 * The budget projection is a Central fact, so it belongs with the facts. It
 * was appended at the end, which pushed the agent's own words out of last
 * place — and the last thing a human reads is the one the product promises to
 * be the agent's words, behind the `AGENT SAYS:` label.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { call, startBench, type Bench } from './helpers.js';

let bench: Bench | null = null;

afterEach(async () => {
  if (bench) await bench.close();
  bench = null;
});

describe('the order of the screens', () => {
  it('keeps the agent prose last when there is no projection', async () => {
    bench = await startBench();
    const made = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
      agent_says: 'rien de dangereux',
    });
    const detail = made.body.detail as string[];
    expect(detail.at(-1)).toContain('AGENT SAYS:');
  });

  it('keeps the agent prose last even when the projection is shown', async () => {
    bench = await startBench();
    // Spend a slot, so the next page carries the projection note.
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin premiere',
    });
    const made = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin seconde',
      agent_says: 'rien de dangereux',
    });
    const detail = made.body.detail as string[];
    expect(detail.join(' ')).toContain('BUDGET:');
    // The note is a fact: it comes BEFORE the agent's words.
    expect(detail.at(-1)).toContain('AGENT SAYS:');
    expect(detail.at(-1)).toContain('rien de dangereux');
    expect(detail.indexOf(detail.find((s) => s.includes('BUDGET:'))!)).toBeLessThan(
      detail.findIndex((s) => s.startsWith('AGENT SAYS:')),
    );
  });
});
