/**
 * BIP-P-04, BIP-P-05, BIP-P-06 — signed decisions.
 *
 * BIP-P-04: a page receives at most one accepted decision, however many arrive.
 * BIP-P-05: a decision whose fingerprint differs is never accepted.
 * BIP-P-06: a decision past its deadline never results in an approval.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decisionSigningString, type DecisionClaims } from '@bipeur/core';
import { newNonce } from '@bipeur/core/node';
import type { Bench } from './helpers.js';
import { call, restart, startBench } from './helpers.js';

interface Pager {
  deviceId: string;
  token: string;
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
}

async function pairPager(bench: Bench): Promise<Pager> {
  const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const created = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
    pairing_id: pairing.body.pairing_id,
    code: pairing.body.code,
    device_name: 'Test pager',
    public_key_jwk: keys.publicKey.export({ format: 'jwk' }),
  });
  return { deviceId: created.body.device_id, token: created.body.device_token, privateKey: keys.privateKey };
}

function signed(pager: Pager, claims: DecisionClaims): Record<string, unknown> {
  const signature = sign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
    key: pager.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  return { ...claims, signature };
}

function claimsFor(page: any, pager: Pager, now: number, overrides: Partial<DecisionClaims> = {}): DecisionClaims {
  return {
    page_id: page.page_id,
    fingerprint: page.fingerprint,
    verdict: 'approve',
    choice: null,
    nonce: newNonce(),
    expires_at: now + 60_000,
    device_id: pager.deviceId,
    ...overrides,
  };
}

async function makePage(bench: Bench, command: string): Promise<any> {
  const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
    kind: 'tool',
    tool_name: 'shell',
    command,
  });
  expect(created.status).toBe(201);
  return created.body;
}

describe('BIP-P-04 — at most one accepted decision per page', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('accepts exactly one of N concurrent signed decisions', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async (attempts) => {
        const pager = await pairPager(bench);
        const page = await makePage(bench, `git push origin main ${newNonce()}`);
        const outcomes = await Promise.all(
          Array.from({ length: attempts }, () =>
            call(bench.central, 'POST', `/v1/pages/${page.page_id}/decision`, pager.token,
              signed(pager, claimsFor(page, pager, bench.clock.now()))),
          ),
        );
        const accepted = outcomes.filter((outcome) => outcome.status === 200 && outcome.body.accepted === true);
        expect(accepted).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === 409).length).toBe(attempts - 1);
      }),
      { numRuns: 12, seed: 20_261_111 },
    );
  });

  it('replays the same nonce and is refused', async () => {
    const pager = await pairPager(bench);
    const page = await makePage(bench, 'git push origin main');
    const body = signed(pager, claimsFor(page, pager, bench.clock.now()));
    const first = await call(bench.central, 'POST', `/v1/pages/${page.page_id}/decision`, pager.token, body);
    const second = await call(bench.central, 'POST', `/v1/pages/${page.page_id}/decision`, pager.token, body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('replayed_nonce');
  });
});

describe('BIP-P-05 — a decision on another fingerprint is never accepted', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('refuses any fingerprint that is not the page one', async () => {
    const pager = await pairPager(bench);
    const page = await makePage(bench, 'git push origin main');
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[0-9a-f]{64}$/).filter((value) => value !== page.fingerprint),
        async (fingerprint) => {
          const body = signed(pager, claimsFor(page, pager, bench.clock.now(), { fingerprint }));
          const outcome = await call(bench.central, 'POST', `/v1/pages/${page.page_id}/decision`, pager.token, body);
          expect(outcome.status).toBe(422);
          expect(outcome.body.reason).toBe('fingerprint_mismatch');
        },
      ),
      { numRuns: 8, seed: 20_261_112 },
    );
    const events = bench.central.audit.list({ type: 'decision.rejected', limit: 100 });
    expect(events.length).toBeGreaterThanOrEqual(8);
    const fresh = await call(bench.central, 'GET', `/v1/pages/${page.page_id}`, bench.stationToken);
    expect(fresh.body.state).not.toBe('decided');
    expect(bench.central.audit.list({ type: 'page.decided' })).toHaveLength(0);
  });

  it('refuses a signature made over other claims', async () => {
    const pager = await pairPager(bench);
    const page = await makePage(bench, 'git push origin main');
    const claims = claimsFor(page, pager, bench.clock.now());
    const tampered = { ...signed(pager, claims), verdict: 'deny' };
    const outcome = await call(bench.central, 'POST', `/v1/pages/${page.page_id}/decision`, pager.token, tampered);
    expect(outcome.status).toBe(422);
    expect(outcome.body.reason).toBe('bad_signature');
  });
});

describe('BIP-P-06 — a decision past its deadline never approves', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('refuses a late decision whatever the delay', async () => {
    const pager = await pairPager(bench);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 600_000 }), async (lateBy) => {
        const page = await makePage(bench, `git push origin main ${newNonce()}`);
        const deadline = bench.clock.now() + 1_000;
        const body = signed(pager, claimsFor(page, pager, bench.clock.now(), { expires_at: deadline }));
        bench.clock.advance(1_000 + lateBy);
        const outcome = await call(bench.central, 'POST', `/v1/pages/${page.page_id}/decision`, pager.token, body);
        expect(outcome.status).toBe(409);
        expect(outcome.body.accepted).toBe(false);
        const fresh = await call(bench.central, 'GET', `/v1/pages/${page.page_id}`, bench.stationToken);
        expect(fresh.body.state).not.toBe('decided');
      }),
      { numRuns: 10, seed: 20_261_113 },
    );
  });

  it('an expired page waits as a refusal, never an approval', async () => {
    const pager = await pairPager(bench);
    const page = await makePage(bench, 'git push origin main');
    bench.clock.advance(page.expires_at - bench.clock.now() + 1);
    bench.central.sweep();
    const body = signed(pager, claimsFor(page, pager, bench.clock.now(), { expires_at: bench.clock.now() + 60_000 }));
    const outcome = await call(bench.central, 'POST', `/v1/pages/${page.page_id}/decision`, pager.token, body);
    expect(outcome.status).toBe(409);
    const wait = await call(bench.central, 'GET', `/v1/pages/${page.page_id}/decision?wait=0`, bench.stationToken);
    expect(wait.body.status).toBe('expired');
    expect(bench.central.audit.list({ type: 'page.decided' })).toHaveLength(0);
  });
});

describe('BIP-P-04 — restart keeps the decision invariant', () => {
  it('a decided page stays decided after a restart', async () => {
    const bench = await startBench();
    const pager = await pairPager(bench);
    const page = await makePage(bench, 'git push origin main');
    await call(bench.central, 'POST', `/v1/pages/${page.page_id}/decision`, pager.token,
      signed(pager, claimsFor(page, pager, bench.clock.now())));
    const reopened = await restart(bench);
    const again = await call(reopened.central, 'GET', `/v1/pages/${page.page_id}`, reopened.stationToken);
    expect(again.body.state).toBe('decided');
    expect(again.body.status).toBe('approved');
    await reopened.close();
  });
});
