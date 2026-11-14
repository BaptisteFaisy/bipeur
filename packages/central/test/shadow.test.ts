/**
 * BIP-F-42 — shadow mode: intercept, display, SIMULATE the agreement, never
 * block.
 *
 * The hole this closes: nobody can say what an interruption would have saved.
 * Seven days of shadow in production and the score is a measurement, not a
 * promise. Three rules keep the measurement honest, and each is a test here:
 *
 * - a simulated verdict is never indistinguishable from a real one;
 * - a page a human actually decides wins over the simulation, whenever it
 *   arrives;
 * - the counters are read back from the journal, not accumulated in memory.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decisionSigningString, type DecisionClaims } from '@bipeur/core';
import { newNonce } from '@bipeur/core/node';
import { call, startBench, type Bench } from './helpers.js';

let bench: Bench | null = null;

beforeEach(async () => {
  bench = await startBench();
});

afterEach(async () => {
  if (bench) await bench.close();
  bench = null;
});

async function pager(b: Bench) {
  const pairing = await call(b.central, 'POST', '/v1/pairings', b.stationToken, {});
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const created = await call(b.central, 'POST', '/v1/devices', b.stationToken, {
    pairing_id: pairing.body.pairing_id,
    code: pairing.body.code,
    device_name: 'Shadow pager',
    public_key_jwk: keys.publicKey.export({ format: 'jwk' }),
  });
  return { deviceId: String(created.body.device_id), token: String(created.body.device_token), key: keys.privateKey };
}

async function decide(b: Bench, device: Awaited<ReturnType<typeof pager>>, page: Record<string, unknown>): Promise<void> {
  const claims: DecisionClaims = {
    page_id: String(page.page_id),
    fingerprint: String(page.fingerprint),
    verdict: 'approve',
    choice: null,
    nonce: newNonce(),
    expires_at: b.clock.now() + 60_000,
    device_id: device.deviceId,
  };
  const signature = sign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
    key: device.key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  const res = await call(b.central, 'POST', `/v1/pages/${claims.page_id}/decision`, device.token, { ...claims, signature });
  expect(res.status).toBe(200);
}

async function toggle(b: Bench, enabled: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(b.central, 'PUT', '/v1/shadow', b.stationToken, { enabled });
}

async function ask(b: Bench, command = 'rm -rf dist/'): Promise<Record<string, unknown>> {
  const created = await call(b.central, 'POST', '/v1/pages', b.stationToken, {
    kind: 'tool',
    tool_name: 'shell',
    command,
  });
  expect(created.status).toBe(201);
  return created.body;
}

describe('off by default', () => {
  it('blocks like a normal Central: no flag, no simulation', async () => {
    if (!bench) throw new Error('no bench');
    const page = await ask(bench);
    expect(page.simulated).toBe(false);
    const waited = await call(bench.central, 'GET', `/v1/pages/${page.page_id}/decision?wait=0`, bench.stationToken);
    expect(waited.body.status).toBe('pending');
    expect(waited.body.simulated).toBe(false);
  });

  it('refuses a toggle without a boolean', async () => {
    if (!bench) throw new Error('no bench');
    const bad = await toggle(bench, undefined as unknown as boolean);
    expect(bad.status).toBe(422);
    const junk = await call(bench.central, 'PUT', '/v1/shadow', bench.stationToken, { enabled: 'oui' });
    expect(junk.status).toBe(422);
  });

  it('needs a station token', async () => {
    if (!bench) throw new Error('no bench');
    const anonymous = await bench.central.app.request('/v1/shadow', { method: 'GET' });
    expect(anonymous.status).toBe(401);
  });
});

describe('the simulated verdict', () => {
  it('lets the agent go at once, and says it was simulated', async () => {
    if (!bench) throw new Error('no bench');
    expect((await toggle(bench, true)).body.enabled).toBe(true);
    const page = await ask(bench);
    expect(page.simulated).toBe(true);
    const waited = await call(bench.central, 'GET', `/v1/pages/${page.page_id}/decision?wait=0`, bench.stationToken);
    expect(waited.body.status).toBe('approved');
    expect(waited.body.simulated).toBe(true);
    expect(waited.body.reason).toBe('shadow mode');
  });

  it('still shows the page on the pager: shadow mode resolves the wait, it never mutes it', async () => {
    if (!bench) throw new Error('no bench');
    const device = await pager(bench);
    await toggle(bench, true);
    const page = await ask(bench);
    const seen = await call(bench.central, 'GET', '/v1/pages?state=pending', device.token);
    // The page is delivered and visible: a human can still decide it for real.
    expect(String(seen.status)).not.toBe('404');
    expect(page.line).toContain('RUN');
  });

  it('writes no decision row: the metrics of A.3 stay what a human did', async () => {
    if (!bench) throw new Error('no bench');
    await toggle(bench, true);
    const page = await ask(bench);
    const metrics = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(metrics.body.pages_created).toBe(1);
    // A simulated approval is not an approval: no latency, no median, no
    // "unblocked" time invented out of a page nobody decided.
    expect(metrics.body.decision_median_ms).toBeNull();
    expect(metrics.body.unblocked_ms).toBe(0);
    expect(bench.central.store.decisionByPage(String(page.page_id))).toBeNull();
  });

  it('lets a real decision win over the simulation, whenever it arrives', async () => {
    if (!bench) throw new Error('no bench');
    const device = await pager(bench);
    await toggle(bench, true);
    const page = await ask(bench);
    expect(page.simulated).toBe(true);
    await decide(bench, device, page);
    const waited = await call(bench.central, 'GET', `/v1/pages/${page.page_id}/decision?wait=0`, bench.stationToken);
    expect(waited.body.status).toBe('approved');
    // The flag flips to false: this verdict has a human behind it.
    expect(waited.body.simulated).toBe(false);
  });

  it('stops simulating the moment the mode is turned off', async () => {
    if (!bench) throw new Error('no bench');
    await toggle(bench, true);
    await ask(bench, 'git push origin pendant-ombre');
    await toggle(bench, false);
    const page = await ask(bench);
    expect(page.simulated).toBe(false);
    const waited = await call(bench.central, 'GET', `/v1/pages/${page.page_id}/decision?wait=0`, bench.stationToken);
    expect(waited.body.status).toBe('pending');
    expect(waited.body.simulated).toBe(false);
  });
});

describe('the score, read back from the journal', () => {
  it('counts simulated pages and what they would have faced', async () => {
    if (!bench) throw new Error('no bench');
    await toggle(bench, true);
    for (let i = 0; i < 3; i += 1) await ask(bench, `git push origin b${i}`);
    const score = await call(bench.central, 'GET', '/v1/shadow', bench.stationToken);
    expect(score.body.enabled).toBe(true);
    expect(score.body.simulated).toBe(3);
    expect(score.body.would_have_held).toBe(0);
    expect(score.body.would_have_been_denied).toBe(0);
  });

  it('counts the pages a saturated budget would have held', async () => {
    if (!bench) throw new Error('no bench');
    // The operator budget is 6 per hour in the bench: the seventh page is the
    // one shadow mode saves the human from, and says so.
    await toggle(bench, true);
    for (let i = 0; i < 8; i += 1) await ask(bench, `git push origin x${i}`);
    const score = await call(bench.central, 'GET', '/v1/shadow', bench.stationToken);
    expect(Number(score.body.simulated)).toBeGreaterThanOrEqual(8);
    expect(Number(score.body.would_have_held)).toBeGreaterThan(0);
  });

  it('survives a restart: the counters are the log, not memory', async () => {
    if (!bench) throw new Error('no bench');
    await toggle(bench, true);
    await ask(bench);
    await ask(bench, 'git push origin main');
    const before = await call(bench.central, 'GET', '/v1/shadow', bench.stationToken);
    const restarted = await startBench({ dbPath: bench.config.dbPath, bootstrapToken: bench.stationToken });
    const after = await call(restarted.central, 'GET', '/v1/shadow', restarted.stationToken);
    expect(after.body.simulated).toBe(before.body.simulated);
    await restarted.close();
  });

  it('records a real decision among the simulated pages', async () => {
    if (!bench) throw new Error('no bench');
    const device = await pager(bench);
    await toggle(bench, true);
    const page = await ask(bench);
    await decide(bench, device, page);
    const score = await call(bench.central, 'GET', '/v1/shadow', bench.stationToken);
    expect(score.body.really_decided).toBe(1);
    expect(score.body.simulated).toBe(1);
  });

  it('journals the toggle itself, as a fact and not as a page', async () => {
    if (!bench) throw new Error('no bench');
    await toggle(bench, true);
    await toggle(bench, false);
    const audit = await call(bench.central, 'GET', '/v1/audit?type=shadow.toggled', bench.stationToken);
    expect(audit.body.events).toHaveLength(2);
    expect(audit.body.events[0].data.enabled).toBe(false);
    expect(audit.body.events[1].data.enabled).toBe(true);
    // A toggle is not a simulated page: the two event types never mix.
    const shadowed = await call(bench.central, 'GET', '/v1/audit?type=page.shadowed', bench.stationToken);
    expect(shadowed.body.events).toHaveLength(0);
  });

  it('never carries a payload in the shadow events (BIP-N-03)', async () => {
    if (!bench) throw new Error('no bench');
    await toggle(bench, true);
    await ask(bench, 'rm -rf /chemin/secret');
    const audit = await call(bench.central, 'GET', '/v1/audit?type=page.shadowed', bench.stationToken);
    const dumped = JSON.stringify(audit.body.events);
    expect(dumped).not.toContain('rm -rf');
    expect(dumped).not.toContain('chemin secret');
    expect(dumped).toContain('"simulated":true');
  });
});
