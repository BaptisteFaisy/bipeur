/**
 * BIP-F-08 — an unread delivered page is re-sent at 2, 5 and 15 minutes, then
 * the reminders stop. Every reminder is a `beep.requested` event: the intent to
 * beep is proved by the log, never by a sound (BIP-N-06).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

const MINUTE = 60 * 1000;

describe('BIP-F-08 — reminders at 2, 5 and 15 minutes', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('sends exactly three reminders and stops', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
      ttl_seconds: 3600,
    });
    expect(created.body.state).toBe('delivered');

    bench.clock.advance(1 * MINUTE);
    bench.central.sweep();
    expect(bench.central.audit.list({ type: 'beep.requested' })).toHaveLength(1);

    bench.clock.advance(1 * MINUTE);
    bench.central.sweep();
    expect(bench.central.audit.list({ type: 'beep.requested' })).toHaveLength(2);

    bench.clock.advance(3 * MINUTE);
    bench.central.sweep();
    expect(bench.central.audit.list({ type: 'beep.requested' })).toHaveLength(3);

    bench.clock.advance(10 * MINUTE);
    bench.central.sweep();
    expect(bench.central.audit.list({ type: 'beep.requested' })).toHaveLength(4);

    bench.clock.advance(30 * MINUTE);
    bench.central.sweep();
    expect(bench.central.audit.list({ type: 'beep.requested' })).toHaveLength(4);
    expect(bench.central.store.pageById(created.body.page_id)?.reminders_sent).toBe(3);
  });

  it('stops reminding once the page is read', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
      ttl_seconds: 3600,
    });
    const device = await pair(bench);
    const read = await call(bench.central, 'POST', `/v1/pages/${created.body.page_id}/read`, device, {});
    expect(read.body.ok).toBe(true);
    bench.clock.advance(20 * MINUTE);
    bench.central.sweep();
    expect(bench.central.audit.list({ type: 'beep.requested' })).toHaveLength(1);
    expect(bench.central.store.pageById(created.body.page_id)?.state).toBe('read');
  });
});

/** Minimal pairing helper: returns the device token. */
async function pair(bench: Bench): Promise<string> {
  const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
  const created = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
    pairing_id: pairing.body.pairing_id,
    code: pairing.body.code,
    device_name: 'Reminder pager',
    public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' },
  });
  return created.body.device_token;
}
