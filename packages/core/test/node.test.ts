/** Fingerprint, canonicalisation and signed-decision verification (BIP-F-18). */
import { createPublicKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.js';
import { checkClaims, decisionSigningString, type DecisionClaims } from '../src/decision.js';
import {
  fingerprint,
  hashToken,
  newId,
  newNonce,
  newToken,
  safeEqual,
  verifyDecisionSignature,
} from '../src/node.js';

function makeKeyPair(): { publicKey: JsonWebKey; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicKey: publicKey.export({ format: 'jwk' }) as JsonWebKey,
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
  };
}

function signClaims(claims: DecisionClaims, privateKey: string): string {
  const signature = cryptoSign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return signature.toString('base64');
}

const claims: DecisionClaims = {
  page_id: 'page_123',
  fingerprint: 'a'.repeat(64),
  verdict: 'approve',
  choice: null,
  nonce: 'nonce-1',
  expires_at: 1_800_000_000_000,
  device_id: 'dev_1',
};

describe('canonical form and fingerprint', () => {
  it('ignores key order and undefined values', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
    expect(canonicalize({ a: [1, { c: 3, b: 2 }] })).toBe('{"a":[1,{"b":2,"c":3}]}');
  });

  it('is stable for the same facts, different for one changed fact', () => {
    const base = { tool_name: 'shell', command: 'git push origin main' };
    expect(fingerprint(base)).toBe(fingerprint({ command: base.command, tool_name: 'shell' }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, command: 'git push --force' }));
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes tokens without keeping them', () => {
    expect(hashToken('bip_secret')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('bip_secret')).not.toBe('bip_secret');
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('generates unique ids, tokens and nonces', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId('page')));
    expect(ids.size).toBe(200);
    expect(newToken().startsWith('bip_')).toBe(true);
    expect(newNonce().length).toBeGreaterThanOrEqual(16);
  });
});

describe('signed decisions', () => {
  it('accepts a genuine signature and rejects a tampered one', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const signature = signClaims(claims, privateKey);
    expect(verifyDecisionSignature({ claims, signature, publicKeyJwk: publicKey })).toBe(true);

    const tampered = { ...claims, verdict: 'deny' as const };
    expect(verifyDecisionSignature({ claims: tampered, signature, publicKeyJwk: publicKey })).toBe(
      false,
    );

    const other = makeKeyPair();
    expect(verifyDecisionSignature({ claims, signature, publicKeyJwk: other.publicKey })).toBe(false);
    expect(verifyDecisionSignature({ claims, signature: 'not-base64!', publicKeyJwk: publicKey })).toBe(
      false,
    );
  });

  it('accepts a JWK round-tripped through JSON', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const roundTripped = JSON.parse(JSON.stringify(publicKey)) as JsonWebKey;
    expect(
      verifyDecisionSignature({ claims, signature: signClaims(claims, privateKey), publicKeyJwk: roundTripped }),
    ).toBe(true);
    const imported = createPublicKey({ key: roundTripped as never, format: 'jwk' });
    expect(imported.asymmetricKeyType).toBe('ec');
  });

  it('refuses a decision on another fingerprint or past its deadline', () => {
    const now = 1_000;
    expect(
      checkClaims(claims, { fingerprint: claims.fingerprint, now, hasOptions: false }),
    ).toBeNull();
    expect(
      checkClaims(claims, { fingerprint: 'b'.repeat(64), now, hasOptions: false })?.code,
    ).toBe('fingerprint_mismatch');
    expect(
      checkClaims(claims, { fingerprint: claims.fingerprint, now: claims.expires_at + 1, hasOptions: false })
        ?.code,
    ).toBe('expired');
    expect(
      checkClaims({ ...claims, verdict: 'choice', choice: null }, {
        fingerprint: claims.fingerprint,
        now,
        hasOptions: true,
      })?.code,
    ).toBe('choice_required');
  });

  it('compares secrets in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
