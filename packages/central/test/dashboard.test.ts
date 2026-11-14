/**
 * BIP-F-30 to F-32 — the Central dashboard: served on /dashboard (never on /,
 * which stays the pager), it reads the existing JSON routes; the metrics come
 * from /v1/metrics, the dry run classifies without creating a page, and no
 * route ever hands a raw payload to the browser.
 */
import { describe, expect, it } from 'vitest';
import { call, startBench, type Bench } from './helpers.js';

async function raw(bench: Bench, path: string): Promise<{ status: number; text: string; type: string | null }> {
  const response = await bench.central.app.request(path);
  return { status: response.status, text: await response.text(), type: response.headers.get('content-type') };
}

function pushPage(index: number): Record<string, unknown> {
  return { kind: 'tool', tool_name: 'shell', command: `git push origin branch-${index}` };
}

describe('BIP-F-30 — the dashboard lives on /dashboard, the pager stays on /', () => {
  it('answers 200 with the four blocks and the token field', async () => {
    const bench = await startBench();
    const page = await raw(bench, '/dashboard');
    expect(page.status).toBe(200);
    expect(page.type).toContain('text/html');
    for (const testid of [
      'dashboard', 'metrics-panel', 'queue-panel', 'sources-panel',
      'rota-panel', 'rota-list', 'rota-empty',
      'attention-panel', 'attention-list', 'attention-empty', 'attention-spark',
      'replay-panel', 'replay-form', 'replay-page', 'replay-out', 'replay-empty',
      'audit-panel', 'dryrun-panel', 'token-input', 'queue-empty',
    ]) {
      expect(page.text).toContain(`data-testid="${testid}"`);
    }
    await bench.close();
  });

  it('serves its stylesheet and its script as static text', async () => {
    const bench = await startBench();
    const css = await raw(bench, '/dashboard/app.css');
    expect(css.status).toBe(200);
    expect(css.type).toContain('text/css');
    const js = await raw(bench, '/dashboard/app.js');
    expect(js.status).toBe(200);
    expect(js.type).toContain('javascript');
    expect(js.text).toContain("'use strict'");
    await bench.close();
  });

  it('leaves / to the pager, never the dashboard', async () => {
    const bench = await startBench();
    const root = await raw(bench, '/');
    expect(root.status).toBe(200);
    expect(root.text).not.toContain('data-testid="dashboard"');
    expect(root.text).not.toContain('/dashboard/app.js');
    await bench.close();
  });
});

describe('BIP-F-30 — stations: list, counts, revocation', () => {
  it('lists the bootstrap station with kind, activity and page count', async () => {
    const bench = await startBench();
    const { status, body } = await call(bench.central, 'GET', '/v1/sources', bench.stationToken);
    expect(status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({ alias: 'main', kind: 'cli', pages_created: 0, revoked_at: null });
    await bench.close();
  });

  it('refuses a caller without a valid token', async () => {
    const bench = await startBench();
    const { status } = await call(bench.central, 'GET', '/v1/sources', 'not-a-token');
    expect(status).toBe(401);
    await bench.close();
  });

  it('revoking a station kills its token immediately', async () => {
    const bench = await startBench();
    const listed = await call(bench.central, 'GET', '/v1/sources', bench.stationToken);
    const id = listed.body.sources[0].source_id;
    const revoked = await call(bench.central, 'DELETE', `/v1/sources/${id}`, bench.stationToken);
    expect(revoked.status).toBe(200);
    const after = await call(bench.central, 'GET', '/v1/sources', bench.stationToken);
    expect(after.status).toBe(403);
    expect(after.body.error).toBe('source_revoked');
    await bench.close();
  });

  it('counts the pages a station emitted', async () => {
    const bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, pushPage(1));
    const { body } = await call(bench.central, 'GET', '/v1/sources', bench.stationToken);
    expect(body.sources[0].pages_created).toBe(1);
    await bench.close();
  });
});

describe('BIP-F-30 — the queue shows the line and why a page is held', () => {
  it('a page held by the attention budget says so', async () => {
    const bench = await startBench();
    for (let index = 0; index < 7; index += 1) {
      await call(bench.central, 'POST', '/v1/pages', bench.stationToken, pushPage(index));
    }
    const { status, body } = await call(bench.central, 'GET', '/v1/pages?state=pending', bench.stationToken);
    expect(status).toBe(200);
    const held = body.pages.filter((page: { hold: unknown }) => page.hold !== null);
    expect(held.length).toBeGreaterThanOrEqual(1);
    expect(held[0].hold.reason).toBe('budget');
    expect(held[0].state).toBe('queued');
    expect(typeof held[0].line).toBe('string');
    await bench.close();
  });

  it('never carries a payload: the queue answer has no payload key', async () => {
    const bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool', tool_name: 'shell', command: 'git push origin secret-branch',
      agent_says: 'SECRET_AGENT_PROSE_MARKER',
    });
    expect(created.status).toBe(201);
    const queue = await raw(bench, '/v1/pages?state=pending');
    expect(queue.text).not.toContain('SECRET_AGENT_PROSE_MARKER');
    expect(queue.text).not.toContain('"payload"');
    await bench.close();
  });
});

describe('A.3 — the indicators are computed by the Central, never by the browser', () => {
  it('orphans are zero by construction and the client reads /v1/metrics', async () => {
    const bench = await startBench();
    const { status, body } = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(status).toBe(200);
    expect(body.orphan_approvals).toBe(0);
    expect(body).toHaveProperty('decision_median_ms');
    expect(body).toHaveProperty('filter_rate');
    expect(body).toHaveProperty('delivery_p95_ms');
    expect(body).toHaveProperty('unblocked_ms');
    const js = await raw(bench, '/dashboard/app.js');
    expect(js.text).toContain("api('/v1/metrics')");
    const html = await raw(bench, '/dashboard');
    expect(html.text).toContain('data-testid="metric-orphans"');
    await bench.close();
  });
});

describe('BIP-F-32 — the dry run classifies without creating a page', () => {
  it('returns line, code and risk, and the page counter does not move', async () => {
    const bench = await startBench();
    const before = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    const { status, body } = await call(bench.central, 'POST', '/v1/rules/dry-run', bench.stationToken, {
      command: 'rm -rf /tmp/something',
    });
    expect(status).toBe(200);
    expect(body.risk).toBe('red');
    expect(typeof body.code).toBe('number');
    expect(body.line.length).toBeGreaterThan(0);
    expect(body.line.length).toBeLessThanOrEqual(80);
    const after = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(after.body.pages_created).toBe(before.body.pages_created);
    await bench.close();
  });
});

describe('BIP-N-08 — a page line is data, never markup', () => {
  it('a trapped line stays raw in JSON and never appears in the served HTML', async () => {
    const bench = await startBench();
    const trapped = 'Deploy <script>alert("x")</script> now?';
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question', question: trapped,
    });
    expect(created.status).toBe(201);
    const { body } = await call(bench.central, 'GET', '/v1/pages?state=pending', bench.stationToken);
    const found = body.pages.find((page: { line: string }) => page.line.includes('<script>'));
    expect(found).toBeTruthy();
    const html = await raw(bench, '/dashboard');
    expect(html.text).not.toContain('alert("x")');
    await bench.close();
  });

  it('the client script escapes by construction: textContent, no innerHTML, no eval', async () => {
    const bench = await startBench();
    const js = await raw(bench, '/dashboard/app.js');
    expect(js.text).toContain('textContent');
    expect(js.text).not.toContain('innerHTML');
    expect(js.text).not.toMatch(/[^.\w]eval\s*\(/);
    await bench.close();
  });
});

describe('BIP-F-30 — the audit history is filterable and bounded', () => {
  it('filters by type and by station, with offset pagination', async () => {
    const bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, pushPage(1));
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, pushPage(2));
    const sources = await call(bench.central, 'GET', '/v1/sources', bench.stationToken);
    const sourceId = sources.body.sources[0].source_id;

    const typed = await call(bench.central, 'GET', '/v1/audit?type=page.created&limit=25', bench.stationToken);
    expect(typed.body.events.length).toBe(2);
    expect(typed.body.events.every((event: { type: string }) => event.type === 'page.created')).toBe(true);

    const bySource = await call(bench.central, 'GET', `/v1/audit?source=${sourceId}&limit=25`, bench.stationToken);
    expect(bySource.body.events.length).toBeGreaterThan(0);
    expect(bySource.body.events.every((event: { source_id: string | null }) => event.source_id === sourceId)).toBe(true);

    const paged = await call(bench.central, 'GET', '/v1/audit?limit=2&offset=2', bench.stationToken);
    expect(paged.body.events.length).toBeLessThanOrEqual(2);
    const unbounded = await call(bench.central, 'GET', '/v1/audit?limit=100000', bench.stationToken);
    expect(unbounded.body.events.length).toBeLessThanOrEqual(500);
    await bench.close();
  });

  it('the audit answer never carries agent prose or a payload', async () => {
    const bench = await startBench();
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool', tool_name: 'shell', command: 'git push origin main',
      agent_says: 'SECRET_AGENT_PROSE_MARKER',
    });
    const audit = await call(bench.central, 'GET', '/v1/audit?limit=100', bench.stationToken);
    const text = JSON.stringify(audit.body);
    expect(text).not.toContain('SECRET_AGENT_PROSE_MARKER');
    expect(text).not.toContain('"payload"');
    await bench.close();
  });
});
