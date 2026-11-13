/**
 * The signed decision of the hardware pager (BIP-F-18).
 *
 * The claims and the exact bytes that are signed come from `@bipeur/core` —
 * the same ones the PWA signs and the Central verifies. The pager cannot
 * invent a signature of its own, or the Central would refuse it.
 */
import {
  checkClaims,
  decisionSigningString,
  defaultDecisionDeadline,
  newNonce,
  signClaims,
  type DecisionClaims,
  type SignedDecision,
  type Verdict,
} from '@bipeur/core';
import type { DeviceKey } from './device.js';

/** Everything a decision needs, and nothing the Central does not know. */
export interface DecisionInput {
  /** The page id of the Central this decision applies to (not the key id). */
  pageId: string;
  /** The fingerprint of that page: the Central compares it (BIP-P-05). */
  fingerprint: string;
  verdict: Verdict;
  /** The letter of the chosen option, for a `choice` verdict only. */
  choice: string | null;
  /** The device id the Central handed over at pairing. */
  deviceId: string;
  /** Whether the page carries options at all. */
  hasOptions: boolean;
  /** The clock, injected: a test never reads the wall clock. */
  now: number;
}

/** A decision the pager refuses to sign: the Central would refuse it too. */
export class DecisionRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'DecisionRefused';
  }
}

/**
 * Build the claims, check them with the shared rules, then sign the exact
 * string of the Central. The order is the one of the PWA: build, check, sign.
 */
export async function signDecision(
  input: DecisionInput,
  key: DeviceKey,
): Promise<SignedDecision> {
  const claims: DecisionClaims = {
    page_id: input.pageId,
    fingerprint: input.fingerprint,
    verdict: input.verdict,
    choice: input.verdict === 'choice' ? input.choice : null,
    nonce: newNonce(key.crypto),
    expires_at: defaultDecisionDeadline(input.now),
    device_id: input.deviceId,
  };
  const problem = checkClaims(claims, {
    fingerprint: input.fingerprint,
    now: input.now,
    hasOptions: input.hasOptions,
  });
  if (problem) throw new DecisionRefused(`${problem.code}: ${problem.detail}`);
  const signature = await signClaims(key, decisionSigningString(claims));
  return { ...claims, signature };
}