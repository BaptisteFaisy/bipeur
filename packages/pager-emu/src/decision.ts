/**
 * The signed decision (BIP-F-18).
 *
 * The claims and the exact bytes that are signed come from `@bipeur/core`,
 * the same ones the PWA signs and the Central verifies: the emulator cannot
 * invent a signature of its own, or the Central would refuse it.
 */
import {
  checkClaims,
  decisionSigningString,
  defaultDecisionDeadline,
  newNonce,
  type DecisionClaims,
  type SignedDecision,
  type Verdict,
} from '@bipeur/core';
import { signBytes, type DeviceKey } from './device-key.js';

/** Everything a decision needs, and nothing the Central does not know. */
export interface DecisionRequest {
  /** The page of the Central this decision applies to. */
  pageId: string;
  /** The fingerprint of that page: the Central compares it (BIP-P-05). */
  fingerprint: string;
  verdict: Verdict;
  /** The letter of the chosen option, for a `choice` verdict. */
  choice: string | null;
  /** The device that signs: the Central compares it too. */
  deviceId: string;
  /** Whether the page carries options at all. */
  hasOptions: boolean;
  /** The clock, injected: a test never reads the wall clock. */
  now: number;
}

/** A decision the emulator refuses to sign: the Central would refuse it too. */
export class DecisionRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'DecisionRefused';
  }
}

/**
 * Build the claims, check them with the shared rules, then sign the exact
 * string of the Central. The order is the one of the PWA: the claims are
 * built, checked, and only then signed.
 */
export async function buildDecision(
  request: DecisionRequest,
  key: DeviceKey,
): Promise<SignedDecision> {
  const claims: DecisionClaims = {
    page_id: request.pageId,
    fingerprint: request.fingerprint,
    verdict: request.verdict,
    choice: request.verdict === 'choice' ? request.choice : null,
    nonce: newNonce(key.crypto),
    expires_at: defaultDecisionDeadline(request.now),
    device_id: request.deviceId,
  };
  const problem = checkClaims(claims, {
    fingerprint: request.fingerprint,
    now: request.now,
    hasOptions: request.hasOptions,
  });
  if (problem) throw new DecisionRefused(`${problem.code}: ${problem.detail}`);
  const signature = await signBytes(key, new TextEncoder().encode(decisionSigningString(claims)));
  return { ...claims, signature };
}
