/**
 * BIP-F-43 — the canary is a fact on the page, and the deliberate gesture is
 * in the signature.
 *
 * A client that can choose to stop obeying the canary is not a guard, only a
 * hint. The Central therefore refuses a canary decision without a signed
 * `held_ms >= 1000`, and the pager cannot inflate that number after signing.
 * These tests use real ECDSA signatures, not mocked booleans.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decisionSigningString, type DecisionClaims } from '@bipeur/core';
import { newNonce } from '@bipeur/core/node';
import { call, startBench, type Bench } from './helpers.js';

interface Pager {
  deviceId: string;
  token: string;
  key: ReturnType<typeof generateKeyPairSync>['privateKey'];
}

async function pair(bench: Bench): Promise<Pager> {
  const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const made = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
    pairing_id: pairing.body.pairing_id,
    code: pairing.body.code,
    device_name: 'Canary pager',
    public_key_jwk: keys.publicKey.export({ format: 'jwk' }),
  });
  return { deviceId: String(made.body.device_id), token: String(made.body.device_token), key: keys.privateKey };
}

async function page(bench: Bench, command: string): Promise<Record<string, unknown>> {
  return (await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
    kind: 'tool',
    tool_name: 'shell',
    command,
    dedupe_key: command,
  })).body;
}

async function signedDecision(
  bench: Bench,
  pager: Pager,
  target: Record<string, unknown>,
  heldMs?: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const claims: DecisionClaims = {
    page_id: String(target.page_id),
    fingerprint: String(target.fingerprint),
    verdict: 'approve',
    choice: null,
    nonce: newNonce(),
    expires_at: bench.clock.now() + 60_000,
    device_id: pager.deviceId,
    ...(heldMs === undefined ? {} : { held_ms: heldMs }),
  };
  const signature = sign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
    key: pager.key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  return call(bench.central, 'POST', `/v1/pages/${claims.page_id}/decision`, pager.token, { ...claims, signature });
}

async function giveReflexHistory(bench: Bench, pager: Pager, count = 3): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const target = await page(bench, `git push origin fast-${i}`);
    const sent = await signedDecision(bench, pager, target);
    expect(sent.status).toBe(200);
    // The test clock is deliberately faster than the 1.5 s threshold.
    bench.clock.advance(250);
  }
}

async function withBench(test: (bench: Bench) => Promise<void>): Promise<void> {
  const bench = await startBench();
  try {
    await test(bench);
  } finally {
    await bench.close();
  }
}

describe('the canary habit', () => {
  it('does not mark the first pages: a habit needs at least three decisions', async () => {
    await withBench(async (bench) => {
      const pager = await pair(bench);
      await giveReflexHistory(bench, pager, 2);
      const next = await page(bench, 'git push origin habit-not-formed');
      expect(next.canary).toBe(false);
    });
  });

  it('marks the next page after three reflex decisions by this device', async () => {
    await withBench(async (bench) => {
      const pager = await pair(bench);
      await giveReflexHistory(bench, pager, 3);
      const next = await page(bench, 'git push origin canary-next');
      expect(next.canary).toBe(true);
      const details = next.detail as string[];
      expect(details.join(' ')).toContain('CANARY');
      expect(details.join(' ')).toContain('under 1500');
    });
  });

  it('measures each device independently: a fast pager does not brand a careful one', async () => {
    await withBench(async (bench) => {
      const fast = await pair(bench);
      const careful = await pair(bench);
      await giveReflexHistory(bench, fast, 3);
      const target = await page(bench, 'git push origin different-human');
      // The page has no rota, so its whole station scope is the audience; one
      // fast device makes it a canary, because the Central cannot know which
      // pager a human will pick up first.
      expect(target.canary).toBe(true);
      expect(bench.central.store.decisionLatencies(careful.deviceId)).toEqual([]);
    });
  });

  it('measures only the target of a rota page', async () => {
    await withBench(async (bench) => {
      const fast = await pair(bench);
      const careful = await pair(bench);
      await giveReflexHistory(bench, fast, 3);
      const made = await call(bench.central, 'POST', '/v1/rotas', bench.stationToken, {
        label: 'fast-only',
        escalate_after_seconds: 60,
      });
      expect(made.status).toBe(201);
      const shift = await call(bench.central, 'POST', `/v1/rotas/${made.body.rota_id}/shifts`, bench.stationToken, {
        alias: 'fast',
        target: fast.deviceId,
        priority: 0,
      });
      expect(shift.status).toBe(201);
      const target = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
        kind: 'tool',
        tool_name: 'shell',
        command: 'git push origin rota-target',
        rota: 'fast-only',
      });
      expect(target.status).toBe(201);
      expect(target.body.canary).toBe(true);
      expect(bench.central.store.pageTargets(String(target.body.page_id))).toEqual([fast.deviceId]);
      expect(bench.central.store.decisionLatencies(careful.deviceId)).toEqual([]);
    });
  });
});

describe('the canary cannot be tapped through', () => {
  it('refuses a signed tap with no hold time', async () => {
    await withBench(async (bench) => {
      const pager = await pair(bench);
      await giveReflexHistory(bench, pager, 3);
      const target = await page(bench, 'git push origin tap-through');
      expect(target.canary).toBe(true);
      const refused = await signedDecision(bench, pager, target);
      expect(refused.status).toBe(422);
      expect(refused.body.reason).toBe('canary_needs_hold');
      expect(bench.central.store.decisionByPage(String(target.page_id))).toBeNull();
    });
  });

  it('refuses 999 ms: the gesture costs one full second', async () => {
    await withBench(async (bench) => {
      const pager = await pair(bench);
      await giveReflexHistory(bench, pager, 3);
      const target = await page(bench, 'git push origin 999ms');
      const refused = await signedDecision(bench, pager, target, 999);
      expect(refused.status).toBe(422);
      expect(refused.body.reason).toBe('canary_needs_hold');
      expect(refused.body.held_ms).toBe(999);
      expect(refused.body.required_ms).toBe(1_000);
    });
  });

  it('accepts one second of signed hold, and the latency lifts the median', async () => {
    await withBench(async (bench) => {
      const pager = await pair(bench);
      await giveReflexHistory(bench, pager, 3);
      const target = await page(bench, 'git push origin held');
      expect(target.canary).toBe(true);
      bench.clock.advance(1_001);
      const accepted = await signedDecision(bench, pager, target, 1_001);
      expect(accepted.status).toBe(200);
      const latencies = bench.central.store.decisionLatencies(pager.deviceId);
      expect(latencies.at(-1)).toBeGreaterThanOrEqual(1_000);
    });
  });

  it('does not let a client change the hold AFTER signing', async () => {
    await withBench(async (bench) => {
      const pager = await pair(bench);
      await giveReflexHistory(bench, pager, 3);
      const target = await page(bench, 'git push origin tamper-hold');
      const claims: DecisionClaims = {
        page_id: String(target.page_id),
        fingerprint: String(target.fingerprint),
        verdict: 'approve',
        choice: null,
        nonce: newNonce(),
        expires_at: bench.clock.now() + 60_000,
        device_id: pager.deviceId,
        held_ms: 1_000,
      };
      const signature = sign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
        key: pager.key,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64');
      const tampered = await call(bench.central, 'POST', `/v1/pages/${claims.page_id}/decision`, pager.token, {
        ...claims,
        held_ms: 1,
        signature,
      });
      expect(tampered.status).toBe(422);
      expect(tampered.body.reason).toBe('bad_signature');
    });
  });

  it('journals the canary but never the decision text', async () => {
    await withBench(async (bench) => {
      const pager = await pair(bench);
      await giveReflexHistory(bench, pager, 3);
      const target = await page(bench, 'git push origin audit-canary');
      const events = await call(bench.central, 'GET', '/v1/audit?type=page.canary', bench.stationToken);
      expect(events.body.events.length).toBe(1);
      expect(events.body.events[0].fingerprint).toBe(target.fingerprint);
      expect(JSON.stringify(events.body.events)).not.toContain('audit-canary');
    });
  });
});

