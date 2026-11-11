/**
 * Node-only entry point (`@bipeur/core/node`): hashing, identifiers and the
 * ECDSA verification of a signed decision. Kept out of the browser bundle.
 */
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as cryptoVerify,
  type JsonWebKey as NodeJsonWebKey,
} from 'node:crypto';
import { canonicalize } from './canonical.js';
import { decisionSigningString, type DecisionClaims } from './decision.js';

/** SHA-256 of the canonical form of a payload: the fingerprint of a page. */
export function fingerprint(payload: unknown): string {
  return sha256Hex(canonicalize(payload));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Station tokens are stored hashed only (BIP-N-03). */
export function hashToken(token: string): string {
  return sha256Hex(`bipeur-token:${token}`);
}

export function shortFingerprintOf(payload: unknown): string {
  return fingerprint(payload).slice(0, 4);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function newToken(): string {
  return `bip_${randomBytes(24).toString('base64url')}`;
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}

export interface VerifyInput {
  claims: DecisionClaims;
  /** base64 or base64url of the raw (IEEE P1363) ECDSA signature. */
  signature: string;
  publicKeyJwk: JsonWebKey;
}

/**
 * Verify the signature of a decision with the device's public key.
 * WebCrypto exports raw `r||s` signatures, hence `dsaEncoding: 'ieee-p1363'`.
 */
export function verifyDecisionSignature(input: VerifyInput): boolean {
  const data = decisionSigningString(input.claims);
  const signature = toBase64(input.signature);
  if (!signature) return false;
  try {
    const key = createPublicKey({
      key: input.publicKeyJwk as unknown as NodeJsonWebKey,
      format: 'jwk',
    });
    return cryptoVerify(
      'sha256',
      Buffer.from(data, 'utf8'),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function toBase64(value: string): string | null {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/=]+$/.test(normalised)) return null;
  return normalised;
}

/** Constant-time comparison for tokens and fingerprints. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return left.equals(right);
}
