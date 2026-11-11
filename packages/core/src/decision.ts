/**
 * Signed decisions (BIP-F-18). The pager signs these exact claims with a
 * non-extractable ECDSA P-256 key; the Central verifies the signature, the
 * device, the fingerprint equality, the deadline and the nonce before it
 * accepts a decision. A decision can therefore never apply to another page.
 */
import { canonicalize } from './canonical.js';
import type { Verdict } from './types.js';

export interface DecisionClaims {
  page_id: string;
  fingerprint: string;
  verdict: Verdict;
  /** Letter of the chosen option for `verdict: 'choice'`, otherwise null. */
  choice: string | null;
  /** Single-use random string, rejected if already seen (anti-replay). */
  nonce: string;
  /** Epoch milliseconds after which the decision is refused (BIP-P-06). */
  expires_at: number;
  device_id: string;
}

/** The exact bytes that are signed. Never change the field order. */
export function decisionSigningString(claims: DecisionClaims): string {
  return canonicalize({
    v: 1,
    page_id: claims.page_id,
    fingerprint: claims.fingerprint,
    verdict: claims.verdict,
    choice: claims.choice,
    nonce: claims.nonce,
    expires_at: claims.expires_at,
    device_id: claims.device_id,
  });
}

export const DECISION_TTL_MS = 60_000;

export function defaultDecisionDeadline(now: number): number {
  return now + DECISION_TTL_MS;
}

/** Cheap structural checks the Central runs before the crypto verification. */
export interface ClaimProblem {
  code: 'fingerprint_mismatch' | 'expired' | 'malformed' | 'choice_required';
  detail: string;
}

export function checkClaims(
  claims: DecisionClaims,
  expected: { fingerprint: string; now: number; hasOptions: boolean },
): ClaimProblem | null {
  if (!claims.page_id || !claims.nonce || !claims.device_id) {
    return { code: 'malformed', detail: 'page_id, nonce and device_id are required' };
  }
  if (claims.fingerprint !== expected.fingerprint) {
    return { code: 'fingerprint_mismatch', detail: 'decision fingerprint differs from the page' };
  }
  if (claims.expires_at <= expected.now) {
    return { code: 'expired', detail: 'decision deadline has passed' };
  }
  if (claims.verdict === 'choice' && (!claims.choice || !expected.hasOptions)) {
    return { code: 'choice_required', detail: 'a choice verdict needs a chosen option' };
  }
  if (claims.verdict !== 'choice' && claims.choice !== null) {
    return { code: 'malformed', detail: 'choice must be null unless the verdict is choice' };
  }
  return null;
}
