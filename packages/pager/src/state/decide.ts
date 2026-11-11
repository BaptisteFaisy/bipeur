/**
 * Build the signed decision of BIP-F-18. Every field and the exact signing
 * string come from `@bipeur/core` so the pager and the Central can never drift:
 * the pager signs `decisionSigningString(claims)`, the Central re-derives it.
 */
import {
  checkClaims,
  decisionSigningString,
  defaultDecisionDeadline,
  type DecisionClaims,
  type PageRecord,
  type Verdict,
} from '@bipeur/core';
import { newNonce, signClaims, type CryptoPort, type DeviceKeys } from '../crypto/device-key.js';

export interface SignedDecision extends DecisionClaims {
  signature: string;
}

export interface DecideDeps {
  crypto: CryptoPort;
  keys: DeviceKeys;
  now: () => number;
}

export class DecisionRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'DecisionRefused';
  }
}

/**
 * `checkClaims` runs here as well as in the Central: a pager that cannot build
 * a valid claim (expired deadline, choice without options) refuses to sign
 * instead of sending something the Central would reject anyway.
 */
export async function buildSignedDecision(
  deps: DecideDeps,
  page: PageRecord,
  verdict: Verdict,
  choice: string | null = null,
): Promise<SignedDecision> {
  const claims: DecisionClaims = {
    page_id: page.id,
    fingerprint: page.payload_sha256,
    verdict,
    choice: verdict === 'choice' ? choice : null,
    nonce: newNonce(deps.crypto),
    expires_at: defaultDecisionDeadline(deps.now()),
    device_id: deps.keys.deviceId,
  };
  const problem = checkClaims(claims, {
    fingerprint: page.payload_sha256,
    now: deps.now(),
    hasOptions: page.options.length > 0,
  });
  if (problem) throw new DecisionRefused(`${problem.code}: ${problem.detail}`);
  const signature = await signClaims(deps.crypto, deps.keys, decisionSigningString(claims));
  return { ...claims, signature };
}
