/**
 * Chaos bench, part 2 — a clock that misbehaves.
 *
 * The injected clock goes backwards, quiet hours cross midnight: expiry,
 * reminders, the sliding budget window and quiet-hour admission must never
 * produce a default approval, nor a page stuck forever. BIP-F-07/F-08/F-10
 * under a hostile time source.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

let bench: Bench | null = null;

afterEach(async () => {
  if (bench) {
    await bench.close();
    bench = null;
  }
});

let dedupe = 0;
async function create(question: string, extra: Record<string, unknown> = {}) {
  dedupe += 1;
  return call(bench!.central, 'POST', '/v1/pages', bench!.stationToken, {
    kind: 'question',
    question,
    dedupe_key: `chaos-clock-${dedupe}`,
    ...extra,
  });
}

async function stateOf(pageId: string): Promise<string> {
  const res = await call(bench!.central, 'GET', `/v1/pages/${pageId}`, bench!.stationToken);
  return res.body.state as string;
}

describe('a clock that goes backwards', () => {
  it('an expired page stays expired: rewinding never resurrects it', async () => {
    bench = await startBench();
    const page = await create('expires, then the clock rewinds?', { ttl_seconds: 60 });
    expect(page.status).toBe(201);
    bench.clock.advance(61_000);
    bench.central.sweep();
    expect(await stateOf(page.body.page_id)).toBe('expired');
    // The operator's NTP jumps back before the deadline: a final state is
    // stable (BIP-P-03) — expiry is a refusal and must stay one.
    bench.clock.advance(-120_000);
    bench.central.sweep();
    expect(await stateOf(page.body.page_id)).toBe('expired');
    const waited = await call(bench.central, 'GET', `/v1/pages/${page.body.page_id}/decision?wait=0`, bench.stationToken);
    expect(waited.body.status).toBe('expired');
  });

  it('a rewind never widens the budget into an extra delivery', async () => {
    bench = await startBench();
    const states: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await create(`fills the budget ${i}?`);
      states.push(res.body.state as string);
    }
    expect(states.filter((s) => s !== 'queued')).toHaveLength(6);
    // Rewind one hour: the window floor moves into the past, deliveries keep
    // their future timestamps — the budget must stay full, not reset.
    bench.clock.advance(-3_600_000);
    const extra = await create('sneaky page after the rewind?');
    expect(extra.body.state).toBe('queued');
    const held = await call(bench.central, 'GET', `/v1/pages/${extra.body.page_id}`, bench.stationToken);
    expect(held.body.state).toBe('queued');
  });

  it('a held page is not stuck forever: it expires when the clock moves on', async () => {
    bench = await startBench();
    for (let i = 0; i < 6; i += 1) await create(`occupies a slot ${i}?`);
    const held = await create('held, then abandoned?', { ttl_seconds: 300 });
    expect(held.body.state).toBe('queued');
    bench.clock.advance(301_000);
    bench.central.sweep();
    expect(await stateOf(held.body.page_id)).toBe('expired');
    const decisions = await call(bench.central, 'GET', '/v1/audit?type=page.decided', bench.stationToken);
    expect(decisions.body.events).toHaveLength(0);
  });

  it('reminders do not fire twice when the clock rewinds', async () => {
    bench = await startBench();
    const page = await create('remind me, then rewind?');
    bench.clock.advance(3 * 60_000); // the 2-minute reminder is due
    bench.central.sweep();
    const first = await call(bench.central, 'GET', '/v1/audit?type=reminder.sent', bench.stationToken);
    bench.clock.advance(-3 * 60_000); // rewind before the delivery itself
    bench.central.sweep();
    bench.clock.advance(3 * 60_000); // and replay the same instant
    bench.central.sweep();
    const second = await call(bench.central, 'GET', '/v1/audit?type=reminder.sent', bench.stationToken);
    expect(second.body.events.length).toBe(first.body.events.length);
    expect(await stateOf(page.body.page_id)).not.toBe('decided');
  });
});

describe('quiet hours across midnight', () => {
  /** Local-time epoch ms for a wall-clock time on a fixed date. */
  function localMs(hours: number, minutes: number): number {
    return new Date(2026, 10, 11, hours, minutes, 0, 0).getTime();
  }

  it('suppresses green pages at 23:30 and 06:59, delivers at 07:01', async () => {
    bench = await startBench();
    bench.central.gate.setQuietHours({ enabled: true, start: '23:00', end: '07:00' });

    bench.clock.set(localMs(23, 30));
    const late = await create('late night green page?');
    expect(late.body.state).toBe('expired'); // suppressed = denied, BIP-F-10

    bench.clock.set(localMs(6, 59));
    const dawn = await create('just before the end of quiet hours?');
    expect(dawn.body.state).toBe('expired');

    bench.clock.set(localMs(7, 1));
    const morning = await create('right after quiet hours?');
    expect(morning.body.state).not.toBe('expired');
  });

  it('a red page walks through quiet hours (BIP-P-08)', async () => {
    bench = await startBench();
    bench.central.gate.setQuietHours({ enabled: true, start: '23:00', end: '07:00' });
    bench.clock.set(localMs(23, 30));
    const red = await create('the build is on fire?', { code: 911, risk: 'red' });
    expect(red.body.state).not.toBe('expired');
    const notices = await call(bench.central, 'GET', '/v1/notices', bench.stationToken);
    expect(notices.body.notices).toHaveLength(0);
  });

  it('a suppression is logged as a notice and a denial, never an approval', async () => {
    bench = await startBench();
    bench.central.gate.setQuietHours({ enabled: true, start: '23:00', end: '07:00' });
    bench.clock.set(localMs(0, 30)); // the window crosses midnight
    const page = await create('midnight green page?');
    expect(page.body.state).toBe('expired');
    const notices = await call(bench.central, 'GET', '/v1/notices', bench.stationToken);
    expect(notices.body.notices.length).toBeGreaterThanOrEqual(1);
    const decisions = await call(bench.central, 'GET', '/v1/audit?type=page.decided', bench.stationToken);
    expect(decisions.body.events).toHaveLength(0);
  });
});
