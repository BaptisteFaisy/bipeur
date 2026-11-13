/**
 * BIP-F-19 / BIP-N-04 / BIP-F-21 — Web Push.
 *
 * No test here contacts a push service: `web-push` is only asked to validate a
 * freshly generated VAPID pair, and the payload composition is a pure function.
 */
import { generateVAPIDKeys } from 'web-push';
import { afterEach, describe, expect, it } from 'vitest';
import { NoopPushSender, pushPayload } from '../src/push.js';
import type { PageRow } from '../src/store/types.js';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

function pageRow(overrides: Partial<PageRow> = {}): PageRow {
  return {
    id: 'pg_1',
    source_id: 'src_1',
    source_alias: 'fw',
    kind: 'tool',
    code: 110,
    risk: 'red',
    line: '110 fw RUN rm -rf dist/ #a3f9',
    detail: ['rm -rf dist/'],
    payload: { tool_name: 'shell', command: 'rm -rf dist/' },
    payload_sha256: 'a3f9'.padEnd(64, '0'),
    options: [],
    state: 'delivered',
    created_at: 1_000,
    delivered_at: 1_100,
    read_at: null,
    expires_at: 900_000,
    dedupe_key: '',
    callback_url: null,
    visitor_id: null,
    rota_id: null,
    escalation_level: 0,
    escalated_at: null,
    reminders_sent: 0,
    ...overrides,
  };
}

describe('the push payload', () => {
  it('carries the line when the operator did not ask for masking', () => {
    const payload = pushPayload(pageRow(), { reminder: false }, false);
    expect(payload).toMatchObject({
      page_id: 'pg_1',
      code: 110,
      risk: 'red',
      station: 'fw',
      line: '110 fw RUN rm -rf dist/ #a3f9',
      masked: false,
    });
  });

  it('drops the line entirely when the device asked for lock-screen masking', () => {
    const payload = pushPayload(pageRow(), { reminder: false }, true);
    // BIP-N-04: reduced to the code and the station. Not hidden locally —
    // never sent, so it cannot leak from the notification store either.
    expect(payload).toMatchObject({ page_id: 'pg_1', code: 110, station: 'fw', masked: true });
    expect(payload).not.toHaveProperty('line');
    expect(JSON.stringify(payload)).not.toContain('rm -rf');
  });

  it('keeps the reminder flag, which the worker uses for its body text', () => {
    expect(pushPayload(pageRow(), { reminder: true }, false)).toMatchObject({ reminder: true });
  });
});

describe('the no-op sender', () => {
  it('does nothing and never throws when no VAPID key is configured', () => {
    const sender = new NoopPushSender();
    expect(sender.kind).toBe('noop');
    expect(() => sender.notify(pageRow(), { reminder: false })).not.toThrow();
  });
});

describe('GET /v1/push-config', () => {
  let bench: Bench;
  afterEach(async () => {
    await bench?.close();
  });

  it('says push is off when the Central has no VAPID keys', async () => {
    bench = await startBench();
    const answer = await call(bench.central, 'GET', '/v1/push-config', '');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ enabled: false, vapid_public_key: null });
  });

  it('publishes the public key — and never the private one', async () => {
    const keys = generateVAPIDKeys();
    bench = await startBench({
      vapid: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:test@example.com' },
    });
    const answer = await call(bench.central, 'GET', '/v1/push-config', '');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ enabled: true, vapid_public_key: keys.publicKey });
    // The route is public by design; leaking the private key would not be.
    expect(JSON.stringify(answer.body)).not.toContain(keys.privateKey);
  });

  it('is reachable without a token, because the browser needs it before pairing', async () => {
    bench = await startBench();
    const response = await bench.central.app.request('/v1/push-config');
    expect(response.status).toBe(200);
  });
});
