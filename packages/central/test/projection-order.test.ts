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

describe('the noise rule (BIP-F-47)', () => {
  it('does not announce a free page while the hour still has room', async () => {
    bench = await startBench();
    // A red page bypasses the budget: "costs 0 of 6" is not news while the
    // window has room, and it must not take a screen a page's contract counts.
    const made = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'rm -rf packages/',
      agent_says: 'the build output must go',
    });
    expect(made.body.risk).toBe('red');
    const detail = made.body.detail as string[];
    expect(detail.some((screen) => screen.includes('BUDGET:'))).toBe(false);
  });

  it('announces a free page once the hour is saturated', async () => {
    bench = await startBench({ budgetPerHour: 1 });
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin plein-1',
    });
    const made = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'rm -rf packages/',
      agent_says: 'the build output must go',
    });
    const detail = made.body.detail as string[];
    // Getting through a saturated hour IS news: it is the page that does not
    // wait, and the human should know the gate is open behind it.
    expect(detail.some((screen) => screen.includes('BUDGET:'))).toBe(true);
    expect(detail.at(-1)).toContain('AGENT SAYS:');
  });
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
