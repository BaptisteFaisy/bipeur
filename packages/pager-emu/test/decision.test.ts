import { describe, expect, it } from 'vitest';
import { decisionSigningString, signedDecisionSchema, type DecisionClaims } from '@bipeur/core';
import { verifyDecisionSignature } from '@bipeur/core/node';
import { buildDecision, DecisionRefused } from '../src/decision.js';
import { generateDeviceKey } from '../src/device-key.js';

const FINGERPRINT = 'c'.repeat(64);
const NOW = 1_700_000_000_000;

function claimsOf(decision: {
  page_id: string;
  fingerprint: string;
  verdict: 'approve' | 'deny' | 'choice';
  choice?: string | null;
  nonce: string;
  expires_at: number;
  device_id: string;
}): DecisionClaims {
  return {
    page_id: decision.page_id,
    fingerprint: decision.fingerprint,
    verdict: decision.verdict,
    choice: decision.choice ?? null,
    nonce: decision.nonce,
    expires_at: decision.expires_at,
    device_id: decision.device_id,
  };
}

describe('BIP-F-33 — the decision of the emulator is signed like the PWA signs it', () => {
  it('signs the claims of a choice, and the Central verifies them', async () => {
    const key = await generateDeviceKey();
    const decision = await buildDecision(
      {
        pageId: 'pg_7f3a1c',
        fingerprint: FINGERPRINT,
        verdict: 'choice',
        choice: 'A',
        deviceId: key.deviceId,
        hasOptions: true,
        now: NOW,
      },
      key,
    );

    expect(decision.page_id).toBe('pg_7f3a1c');
    expect(decision.fingerprint).toBe(FINGERPRINT);
    expect(decision.verdict).toBe('choice');
    expect(decision.choice).toBe('A');
    expect(decision.device_id).toBe(key.deviceId);
    expect(decision.signature.length).toBeGreaterThan(0);
    expect(decision.expires_at).toBeGreaterThan(NOW);

    const verified = verifyDecisionSignature({
      claims: claimsOf(decision),
      signature: decision.signature,
      publicKeyJwk: key.publicKeyJwk,
    });
    expect(verified).toBe(true);
  });

  it('signs the claims: a tampered claim no longer verifies', async () => {
    const key = await generateDeviceKey();
    const decision = await buildDecision(
      {
        pageId: 'pg_7f3a1c',
        fingerprint: FINGERPRINT,
        verdict: 'choice',
        choice: 'B',
        deviceId: key.deviceId,
        hasOptions: true,
        now: NOW,
      },
      key,
    );
    const claims = claimsOf(decision);
    expect(decisionSigningString(claims)).toContain('"choice":"B"');
    const tampered = { ...claims, choice: 'A' };
    expect(
      verifyDecisionSignature({
        claims: tampered,
        signature: decision.signature,
        publicKeyJwk: key.publicKeyJwk,
      }),
    ).toBe(false);
  });

  it('signs an approval without a choice', async () => {
    const key = await generateDeviceKey();
    const decision = await buildDecision(
      {
        pageId: 'pg_7f3a1c',
        fingerprint: FINGERPRINT,
        verdict: 'approve',
        choice: null,
        deviceId: key.deviceId,
        hasOptions: false,
        now: NOW,
      },
      key,
    );
    expect(decision.choice).toBeNull();
    expect(signedDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it('refuses to sign a choice on a page without options', async () => {
    const key = await generateDeviceKey();
    await expect(
      buildDecision(
        {
          pageId: 'pg_7f3a1c',
          fingerprint: FINGERPRINT,
          verdict: 'choice',
          choice: 'A',
          deviceId: key.deviceId,
          hasOptions: false,
          now: NOW,
        },
        key,
      ),
    ).rejects.toBeInstanceOf(DecisionRefused);
  });

  it('keeps the private key inside the process', async () => {
    const key = await generateDeviceKey();
    expect(key.privateKey.extractable).toBe(false);
    expect(key.publicKeyJwk.kty).toBe('EC');
    expect(key.publicKeyJwk.crv).toBe('P-256');
  });
});
