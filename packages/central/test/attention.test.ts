/**
 * BIP-F-44 — the attention bill on the wire and on the dashboard.
 *
 * The numbers must come from the audit log, never from a parallel counter: a
 * dashboard that invents a figure is worse than none, because it is read as
 * measurement. These tests drive the real Central — pages created, delivered,
 * read, decided — and check the bill against the facts they just produced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { attentionReport } from '../src/attention.js';
import { call, startBench, type Bench } from './helpers.js';

const HOUR = 3_600_000;

describe('the bill of a live Central', () => {
  let bench: Bench | null = null;
  afterEach(async () => {
    if (bench) await bench.close();
    bench = null;
  });

  it('reports zero pages on a fresh instance, and never divides by nothing', async () => {
    bench = await startBench();
    const report = attentionReport(bench.central.store, bench.clock.now(), 24);
    expect(report.total.pages).toBe(0);
    expect(report.total.human_ms).toBe(0);
    expect(report.total.denial_rate).toBe(0);
    expect(report.total.decision_median_ms).toBeNull();
    expect(report.series).toHaveLength(24);
    expect(report.window_hours).toBe(24);
  });

  it('counts a page that was created but never read', async () => {
    bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'diff or no diff?',
    });
    const report = attentionReport(bench.central.store, bench.clock.now(), 24);
    expect(report.total.pages).toBe(1);
    expect(report.total.read).toBe(0);
    expect(report.total.decided).toBe(0);
    expect(report.total.human_ms).toBe(0);
  });

  it('breaks the bill down per station', async () => {
    bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'un choix?',
    });
    const report = attentionReport(bench.central.store, bench.clock.now(), 24);
    expect(report.stations.length).toBeGreaterThanOrEqual(1);
    const mine = report.stations.find((station) => station.alias === 'main')!;
    expect(mine.cost.pages).toBe(1);
    // The sum of the stations is the total: nothing is counted twice, nothing
    // is dropped between the two views.
    const summed = report.stations.reduce((acc, station) => acc + station.cost.pages, 0);
    expect(summed).toBe(report.total.pages);
  });

  it('serves the bill over HTTP, authenticated like the other metrics', async () => {
    bench = await startBench();
    const res = await call(bench.central, 'GET', '/v1/metrics/attention', bench.stationToken);
    expect(res.status).toBe(200);
    expect(res.body.window_hours).toBe(24);
    expect(Array.isArray(res.body.series)).toBe(true);
    expect(Array.isArray(res.body.stations)).toBe(true);
    const anonymous = await bench.central.app.request('/v1/metrics/attention');
    expect(anonymous.status).toBe(401);
  });

  it('clamps the window instead of trusting the query', async () => {
    bench = await startBench();
    const big = await call(bench.central, 'GET', '/v1/metrics/attention?hours=99999', bench.stationToken);
    expect(big.status).toBe(200);
    expect(big.body.window_hours).toBe(168);
    const junk = await call(bench.central, 'GET', '/v1/metrics/attention?hours=abc', bench.stationToken);
    expect(junk.body.window_hours).toBe(24);
    const tiny = await call(bench.central, 'GET', '/v1/metrics/attention?hours=0', bench.stationToken);
    expect(tiny.body.window_hours).toBe(1);
  });

  it('keeps the bill inside the window it was asked for', async () => {
    bench = await startBench();
    const report = attentionReport(bench.central.store, bench.clock.now(), 3);
    expect(report.series).toHaveLength(3);
    const from = bench.clock.now() - 3 * HOUR;
    for (const bucket of report.series) {
      expect(bucket.at).toBeGreaterThanOrEqual(from);
      expect(bucket.at).toBeLessThan(bench.clock.now());
    }
  });

  it('shows the panel on the dashboard, with the spark of the last hours', async () => {
    bench = await startBench();
    const response = await bench.central.app.request('/dashboard');
    const text = await response.text();
    for (const testid of ['attention-panel', 'attention-total', 'attention-list', 'attention-spark', 'attention-empty']) {
      expect(text).toContain(`data-testid="${testid}"`);
    }
    const script = await bench.central.app.request('/dashboard/app.js');
    const js = await script.text();
    expect(js).toContain('renderAttention');
    expect(js).toContain('/v1/metrics/attention');
  });

  it('never carries a payload in the bill (BIP-N-03)', async () => {
    bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'rm -rf /chemin/secret',
    });
    const res = await call(bench.central, 'GET', '/v1/metrics/attention', bench.stationToken);
    const dumped = JSON.stringify(res.body);
    expect(dumped).not.toContain('rm -rf');
    expect(dumped).not.toContain('secret');
  });

  it('ages the bill with the clock, not with a counter', async () => {
    bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'maintenant ?',
    });
    const before = attentionReport(bench.central.store, bench.clock.now(), 1);
    expect(before.total.pages).toBe(1);
    bench.clock.advance(2 * HOUR);
    const after = attentionReport(bench.central.store, bench.clock.now(), 1);
    expect(after.total.pages).toBe(0);
  });
});

