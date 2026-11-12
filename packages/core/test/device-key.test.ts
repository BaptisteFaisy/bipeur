/**
 * The shared device key (BIP-F-15, BIP-F-18) — ONE implementation for the PWA
 * and the emulator: a non-extractable ECDSA P-256 key pair, a public JWK
 * without the secret, and a signature the Central verifies.
 */
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decisionSigningString, type DecisionClaims } from '../src/decision.js';
import {
  browserCrypto,
  generateDeviceKeys,
  importDeviceKeys,
  newNonce,
  publicJwkOf,
  signBytes,
  signClaims,
  supportsDeviceKeys,
} from '../src/device-key.js';
import { verifyDecisionSignature } from '../src/node.js';

const claims: DecisionClaims = {
  page_id: 'pg_7f3a1c',
  fingerprint: 'c'.repeat(64),
  verdict: 'choice',
  choice: 'A',
  nonce: 'a'.repeat(32),
  expires_at: 1_800_000_000_000,
  device_id: 'dev_1',
};

/** The WebCrypto of the runtime — Node has it, like a browser. */
function port(): NonNullable<ReturnType<typeof browserCrypto>> {
  const found = browserCrypto();
  if (!found) throw new Error('WebCrypto is required to run the core tests');
  return found;
}

describe('the device key of the core', () => {
  it('makes a non-extractable key pair the Central can verify', async () => {
    const keys = await generateDeviceKeys(port());
    expect(keys.privateKey.extractable).toBe(false);
    expect(keys.publicKeyJwk.kty).toBe('EC');
    expect(keys.publicKeyJwk.crv).toBe('P-256');
    expect(keys.deviceId).toMatch(/^dev_[0-9a-f]{16}$/);

    const signature = await signClaims(keys, decisionSigningString(claims));
    expect(Buffer.from(signature, 'base64')).toHaveLength(64);
    expect(
      verifyDecisionSignature({ claims, signature, publicKeyJwk: keys.publicKeyJwk }),
    ).toBe(true);

    const tampered = { ...claims, choice: 'B' };
    expect(
      verifyDecisionSignature({
        claims: tampered,
        signature,
        publicKeyJwk: keys.publicKeyJwk,
      }),
    ).toBe(false);
  });

  it('signs raw bytes exactly like the signing string does', async () => {
    const keys = await generateDeviceKeys(port());
    const bytes = new TextEncoder().encode(decisionSigningString(claims));
    const signature = await signBytes(keys, bytes);
    expect(Buffer.from(signature, 'base64')).toHaveLength(64);
    expect(
      verifyDecisionSignature({ claims, signature, publicKeyJwk: keys.publicKeyJwk }),
    ).toBe(true);
  });

  it('imports the key of a demo space and never keeps the secret in the JWK', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const privateJwk = privateKey.export({ format: 'jwk' }) as JsonWebKey;
    const keys = await importDeviceKeys(port(), privateJwk, 'dev_demo1');

    expect(keys.deviceId).toBe('dev_demo1');
    expect(keys.publicKeyJwk.d).toBeUndefined();
    expect(Object.keys(keys.publicKeyJwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);

    const signature = await signClaims(keys, decisionSigningString(claims));
    expect(
      verifyDecisionSignature({ claims, signature, publicKeyJwk: keys.publicKeyJwk }),
    ).toBe(true);
  });

  it('keeps only the public members of a private JWK', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const privateJwk = privateKey.export({ format: 'jwk' }) as JsonWebKey;
    const publicJwk = publicJwkOf(privateJwk);
    expect(publicJwk.d).toBeUndefined();
    expect(publicJwk.x).toBe(privateJwk.x);
    expect(publicJwk.y).toBe(privateJwk.y);
  });

  it('makes a fresh nonce every time, and refuses a port without WebCrypto', async () => {
    const found = port();
    expect(supportsDeviceKeys(found)).toBe(true);
    expect(supportsDeviceKeys(null)).toBe(false);
    const nonces = new Set(Array.from({ length: 100 }, () => newNonce(found)));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});
