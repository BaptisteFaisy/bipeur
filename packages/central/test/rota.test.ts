/**
 * BIP-F-37 — the on-call rota and its escalation.
 *
 * The unit tests pin the pure rules (who holds the pager, who is next); the
 * integration tests drive the real Central: a page sent to a rota lands on the
 * on-call device only, and moves to the next when nobody answers in time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextShift, onCall, sortShifts } from '../src/rota.js';
import type { OncallShiftRow, RotaRow } from '../src/store/types.js';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

const JWK = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' };
const MIN = 60_000;

async function pairDevice(bench: Bench, name: string): Promise<{ id: string; token: string }> {
  const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
  const paired = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
    code: pairing.body.code,
    device_name: name,
    public_key_jwk: JWK,
  });
  expect(paired.status).toBe(201);
  return { id: paired.body.device_id, token: paired.body.device_token };
}

async function createRota(bench: Bench, label: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await call(bench.central, 'POST', '/v1/rotas', bench.stationToken, {
    label,
    escalate_after_seconds: 120,
    ...extra,
  });
  expect(created.status).toBe(201);
  return created.body.rota_id;
}

async function addShift(bench: Bench, rotaId: string, body: Record<string, unknown>): Promise<string> {
  const added = await call(bench.central, 'POST', `/v1/rotas/${rotaId}/shifts`, bench.stationToken, body);
  expect(added.status).toBe(201);
  return added.body.shift_id;
}

async function pagesOf(bench: Bench, device: { id: string; token: string }): Promise<string[]> {
  const listed = await call(bench.central, 'GET', `/v1/devices/${device.id}/pages?state=pending`, device.token);
  expect(listed.status).toBe(200);
  return listed.body.pages.map((page: { page_id: string }) => page.page_id);
}

describe('BIP-F-37 — the rota rules', () => {
  const rota = (over: Partial<RotaRow> = {}): RotaRow => ({
    id: 'rt_1',
    label: 'night',
    escalate_after_ms: MIN,
    rotation_ms: null,
    created_at: 0,
    ...over,
  });
  const shift = (id: string, target: string, priority: number, over: Partial<OncallShiftRow> = {}): OncallShiftRow => ({
    id,
    rota_id: 'rt_1',
    alias: id,
    target,
    priority,
    starts_at: null,
    ends_at: null,
    created_at: priority,
    ...over,
  });

  it('sorts by priority, then by insertion order', () => {
    const shifts = [shift('b', 'dev_b', 1, { created_at: 1 }), shift('a', 'dev_a', 0), shift('c', 'dev_c', 1, { created_at: 2 })];
    expect(sortShifts(shifts).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('a whole-rota on call is the first shift; escalation walks the list without wrapping', () => {
    const shifts = [shift('a', 'dev_a', 0), shift('b', 'dev_b', 1), shift('c', 'dev_c', 2)];
    expect(onCall(rota(), shifts, 1000)?.id).toBe('a');
    expect(nextShift(shifts, shifts[0]!)?.id).toBe('b');
    expect(nextShift(shifts, shifts[2]!)).toBeNull();
  });

  it('a windowed shift holds only inside its window', () => {
    const shifts = [
      shift('day', 'dev_day', 0, { starts_at: 1000, ends_at: 5000 }),
      shift('night', 'dev_night', 1, { starts_at: 5000, ends_at: 10_000 }),
    ];
    expect(onCall(rota(), shifts, 3_000)?.id).toBe('day');
    expect(onCall(rota(), shifts, 7_000)?.id).toBe('night');
  });

  it('a rotation hands the pager over every rotation_ms', () => {
    const shifts = [shift('a', 'dev_a', 0), shift('b', 'dev_b', 1)];
    const rotated = rota({ rotation_ms: 1000, created_at: 0 });
    expect(onCall(rotated, shifts, 500)?.id).toBe('a');
    expect(onCall(rotated, shifts, 1500)?.id).toBe('b');
    expect(onCall(rotated, shifts, 2500)?.id).toBe('a');
  });
});

describe('BIP-F-37 — a rota page', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('creates a rota, its shifts, and shows who is on call', async () => {
    const alice = await pairDevice(bench, 'Alice');
    const bob = await pairDevice(bench, 'Bob');
    const rotaId = await createRota(bench, 'night');
    await addShift(bench, rotaId, { alias: 'alice', target: alice.id });
    await addShift(bench, rotaId, { alias: 'bob', target: bob.id });

    const listed = await call(bench.central, 'GET', `/v1/rotas/${rotaId}`, bench.stationToken);
    expect(listed.status).toBe(200);
    expect(listed.body.on_call).toBe('alice');
    expect(listed.body.shifts.length).toBe(2);
  });

  it('refuses a page to an unknown rota and a rota with no on-call', async () => {
    const unknown = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'go?',
      rota: 'nope',
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toBe('unknown_rota');

    const emptyId = await createRota(bench, 'empty');
    const empty = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'go?',
      rota: 'empty',
    });
    expect(empty.status).toBe(422);
    expect(empty.body.error).toBe('rota_has_no_oncall');
    expect(emptyId).toMatch(/^rt_/);
  });

  it('delivers to the on-call device only, not to the other operator pagers', async () => {
    const alice = await pairDevice(bench, 'Alice');
    const bob = await pairDevice(bench, 'Bob');
    const rotaId = await createRota(bench, 'night');
    await addShift(bench, rotaId, { alias: 'alice', target: alice.id });
    await addShift(bench, rotaId, { alias: 'bob', target: bob.id });

    const paged = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'deploy?',
      rota: 'night',
    });
    expect(paged.status).toBe(201);
    expect(paged.body.state).toBe('delivered');

    const pageId = paged.body.page_id;
    expect(await pagesOf(bench, alice)).toContain(pageId);
    expect(await pagesOf(bench, bob)).not.toContain(pageId);
  });

  it('escalates to the next on-call when nobody answers, and logs it', async () => {
    const alice = await pairDevice(bench, 'Alice');
    const bob = await pairDevice(bench, 'Bob');
    const rotaId = await createRota(bench, 'night', { escalate_after_seconds: 120 });
    await addShift(bench, rotaId, { alias: 'alice', target: alice.id });
    await addShift(bench, rotaId, { alias: 'bob', target: bob.id });

    const paged = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'deploy?',
      rota: 'night',
    });
    const pageId = paged.body.page_id;
    expect(await pagesOf(bench, alice)).toContain(pageId);

    // Before the window: nothing moves.
    bench.clock.advance(60 * 1000);
    bench.central.sweep();
    expect(await pagesOf(bench, bob)).not.toContain(pageId);

    // After the window: Bob takes over, Alice is told the page moved on.
    bench.clock.advance(61 * 1000);
    bench.central.sweep();
    expect(await pagesOf(bench, bob)).toContain(pageId);
    expect(await pagesOf(bench, alice)).not.toContain(pageId);

    const audit = await call(bench.central, 'GET', '/v1/audit?type=page.escalated', bench.stationToken);
    const escalated = audit.body.events.find((event: { page_id: string }) => event.page_id === pageId);
    expect(escalated).toBeTruthy();
    expect(escalated.data.level).toBe(1);
    expect(escalated.data.to).toBe(bob.id);

    const page = await call(bench.central, 'GET', `/v1/pages/${pageId}`, bench.stationToken);
    expect(page.body.state).toBe('delivered');
  });

  it('stops at the last on-call: no wrap, the page simply expires unanswered', async () => {
    const alice = await pairDevice(bench, 'Alice');
    const bob = await pairDevice(bench, 'Bob');
    const rotaId = await createRota(bench, 'night', { escalate_after_seconds: 30 });
    await addShift(bench, rotaId, { alias: 'alice', target: alice.id });
    await addShift(bench, rotaId, { alias: 'bob', target: bob.id });

    const paged = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'deploy?',
      rota: 'night',
      ttl_seconds: 900,
    });
    const pageId = paged.body.page_id;
    bench.clock.advance(31 * 1000);
    bench.central.sweep();
    expect(await pagesOf(bench, bob)).toContain(pageId);

    // Bob is last: a further window changes nothing.
    bench.clock.advance(120 * 1000);
    bench.central.sweep();
    expect(await pagesOf(bench, bob)).toContain(pageId);
    const audit = await call(bench.central, 'GET', '/v1/audit?type=page.escalated', bench.stationToken);
    const mine = audit.body.events.filter((event: { page_id: string }) => event.page_id === pageId);
    expect(mine).toHaveLength(1);
  });

  it('honours an explicit shift window: only the on-duty human is paged first', async () => {
    const day = await pairDevice(bench, 'Day');
    const night = await pairDevice(bench, 'Night');
    const now = bench.clock.now();
    const rotaId = await createRota(bench, 'shifted');
    await addShift(bench, rotaId, { alias: 'day', target: day.id, starts_at: now - MIN, ends_at: now + MIN });
    await addShift(bench, rotaId, { alias: 'night', target: night.id, starts_at: now + MIN, ends_at: now + 10 * MIN });

    const paged = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'deploy?',
      rota: 'shifted',
    });
    const pageId = paged.body.page_id;
    expect(await pagesOf(bench, day)).toContain(pageId);
    expect(await pagesOf(bench, night)).not.toContain(pageId);
  });

  it('deletes a rota and its shifts in one gesture', async () => {
    const alice = await pairDevice(bench, 'Alice');
    const rotaId = await createRota(bench, 'gone');
    await addShift(bench, rotaId, { alias: 'alice', target: alice.id });

    const removed = await call(bench.central, 'DELETE', `/v1/rotas/${rotaId}`, bench.stationToken);
    expect(removed.status).toBe(200);
    const after = await call(bench.central, 'GET', `/v1/rotas/${rotaId}`, bench.stationToken);
    expect(after.status).toBe(404);

    const paged = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'deploy?',
      rota: 'gone',
    });
    expect(paged.status).toBe(422);
    expect(paged.body.error).toBe('unknown_rota');
  });

  it('refuses a shift whose target is not a live device', async () => {
    const rotaId = await createRota(bench, 'night');
    const bad = await call(bench.central, 'POST', `/v1/rotas/${rotaId}/shifts`, bench.stationToken, {
      alias: 'ghost',
      target: 'dev_does_not_exist',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toContain('live device');
  });

  it('refuses a duplicate label and an out-of-range escalation window', async () => {
    await createRota(bench, 'night');
    const dup = await call(bench.central, 'POST', '/v1/rotas', bench.stationToken, {
      label: 'night',
      escalate_after_seconds: 120,
    });
    expect(dup.status).toBe(409);
    const short = await call(bench.central, 'POST', '/v1/rotas', bench.stationToken, {
      label: 'instant',
      escalate_after_seconds: 5,
    });
    expect(short.status).toBe(422);
  });
});