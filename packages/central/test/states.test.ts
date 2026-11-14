/**
 * BIP-F-05 / BIP-P-03 — a page only walks the edges of the state graph, and an
 * illegal transition is refused *and* journalled instead of silently applied.
 */
import { describe, expect, it } from 'vitest';
import { applyTransitions, canTransition, transition } from '@bipeur/core';
import { applyPageState } from '../src/states.js';
import { call, startBench } from './helpers.js';

describe('BIP-F-05 — the state machine is enforced, not suggested', () => {
  it('refuses an illegal transition and writes the rejection', async () => {
    const bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const page = bench.central.store.pageById(created.body.page_id)!;
    const ctx = {
      config: bench.config,
      store: bench.central.store,
      audit: bench.central.audit,
      rules: bench.central.rules,
      hub: bench.central.hub,
      push: { kind: 'noop' as const, notify: () => undefined },
      gate: bench.central.gate,
      shadow: bench.central.shadow,
      clock: bench.clock.now,
    };
    expect(page.state).toBe('delivered');
    // `delivered -> queued` is not an edge of the graph: it must be refused.
    const refused = applyPageState(ctx, page, 'queued', bench.clock.now());
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('illegal_transition');
    expect(bench.central.store.pageById(page.id)?.state).toBe(page.state);
    const events = bench.central.audit.list({ type: 'decision.rejected' });
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ reason: 'illegal_transition' });
    await bench.close();
  });

  it('a final state never changes again', async () => {
    expect(canTransition('decided', 'delivered')).toBe(false);
    expect(canTransition('expired', 'decided')).toBe(false);
    expect(canTransition('cancelled', 'queued')).toBe(false);
    expect(() => transition('expired', 'decided')).toThrow();
    const folded = applyTransitions('queued', ['delivered', 'read', 'decided', 'expired']);
    expect(folded.state).toBe('decided');
    expect(folded.refused).toBe(1);
  });

  it('a cancelled page cannot be cancelled twice', async () => {
    const bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const first = await call(bench.central, 'DELETE', `/v1/pages/${created.body.page_id}`, bench.stationToken);
    const second = await call(bench.central, 'DELETE', `/v1/pages/${created.body.page_id}`, bench.stationToken);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    await bench.close();
  });
});
