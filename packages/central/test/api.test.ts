/**
 * API surface of the Central: creation, auth, validation, waiting, expiry,
 * cancellation, notices, audit and metrics (BIP-F-01 to F-14).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

describe('BIP-F-01 — POST /v1/pages', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('answers 201 with the contract fields', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
      branch: 'main',
      stats: '3 commits +120-14',
      cwd: '/repo',
    });
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(
      expect.arrayContaining(['page_id', 'state', 'line', 'code', 'risk', 'fingerprint', 'expires_at', 'detail', 'options']),
    );
    expect(created.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(created.body.line.endsWith(`#${created.body.fingerprint.slice(0, 4)}`)).toBe(true);
    expect(created.body.detail.length).toBeLessThanOrEqual(3);
  });

  it('answers 401 without a token and records nothing', async () => {
    const response = await bench.central.app.request('/v1/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', tool_name: 'shell', command: 'ls' }),
    });
    expect(response.status).toBe(401);
    expect(bench.central.store.listPages({ limit: 10 })).toHaveLength(0);
  });

  it('answers 401 with an unknown token', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', 'not-a-token', {
      kind: 'tool',
      tool_name: 'shell',
      command: 'ls',
    });
    expect(created.status).toBe(401);
  });

  it('answers 422 for a malformed payload', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, { kind: 'tool' });
    expect(created.status).toBe(422);
  });
});

describe('BIP-F-03 — a question that does not fit is refused with the overflow', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('answers 422 with the number of characters over 80', async () => {
    const question = `why is the build red ${'x'.repeat(80)}`;
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question,
    });
    expect(created.status).toBe(422);
    expect(created.body.error).toBe('question_too_long');
    expect(created.body.overflow).toBe(question.length - 80);
    expect(bench.central.store.listPages({ limit: 10 })).toHaveLength(0);
  });

  it('accepts a question of exactly 80 characters', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'q'.repeat(80),
      options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.line.length).toBeLessThanOrEqual(80);
  });
});

describe('BIP-F-06 — GET /v1/pages/:id/decision?wait=N', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('answers pending when nothing happened', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const waited = await call(bench.central, 'GET', `/v1/pages/${created.body.page_id}/decision?wait=1`, bench.stationToken);
    expect(waited.status).toBe(200);
    expect(waited.body).toMatchObject({
      status: 'pending',
      page_id: created.body.page_id,
      fingerprint: created.body.fingerprint,
      choice: null,
    });
    expect(typeof waited.body.latency_ms).toBe('number');
  });

  it('answers cancelled after DELETE', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const cancelled = await call(bench.central, 'DELETE', `/v1/pages/${created.body.page_id}`, bench.stationToken);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.state).toBe('cancelled');
    const waited = await call(bench.central, 'GET', `/v1/pages/${created.body.page_id}/decision?wait=1`, bench.stationToken);
    expect(waited.body.status).toBe('cancelled');
  });

  it('refuses a page that belongs to another station', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const other = await call(bench.central, 'GET', `/v1/pages/${created.body.page_id}`, 'another-token');
    expect(other.status).toBe(401);
  });
});

describe('BIP-F-07 — an expired page is a refusal', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('expires and answers expired, never approved', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
      ttl_seconds: 30,
    });
    bench.clock.advance(31_000);
    bench.central.sweep();
    const waited = await call(bench.central, 'GET', `/v1/pages/${created.body.page_id}/decision?wait=0`, bench.stationToken);
    expect(waited.body.status).toBe('expired');
    expect(waited.body.reason).toBe('no human decision');
    expect(bench.central.audit.list({ type: 'page.decided' })).toHaveLength(0);
    expect(bench.central.audit.list({ type: 'page.expired' })).toHaveLength(1);
  });
});

describe('BIP-F-13 — POST /v1/notices never beeps', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('records a digest line and creates no page', async () => {
    const notice = await call(bench.central, 'POST', '/v1/notices', bench.stationToken, {
      line: 'turn complete: 12 files touched',
    });
    expect(notice.status).toBe(201);
    expect(notice.body.notice_id).toMatch(/^nt_/);
    expect(bench.central.store.listPages({ limit: 10 })).toHaveLength(0);
    expect(bench.central.store.listNotices(10)).toHaveLength(1);
    expect(bench.central.audit.list({ type: 'beep.requested' })).toHaveLength(0);
  });
});

describe('BIP-F-12 — audit log and metrics', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('lists the creation event without any payload', async () => {
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const audit = await call(bench.central, 'GET', '/v1/audit?limit=50&type=page.created', bench.stationToken);
    expect(audit.status).toBe(200);
    expect(audit.body.events.length).toBe(1);
    const event = audit.body.events[0];
    expect(event.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(event)).not.toContain('git push origin main');
  });

  it('answers metrics of the shared contract', async () => {
    await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const metrics = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(metrics.status).toBe(200);
    expect(metrics.body).toMatchObject({
      pages_created: 1,
      pages_delivered: 1,
      orphan_approvals: 0,
    });
    expect(metrics.body.filter_rate).toBeGreaterThanOrEqual(0);
  });

  it('answers healthz without auth', async () => {
    const health = await bench.central.app.request('/healthz');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });
  });
});
