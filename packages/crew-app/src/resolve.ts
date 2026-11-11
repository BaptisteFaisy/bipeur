/**
 * Resolution of a Crew approval (BIP-F-27). The Gateway endpoint is configurable
 * (`CREW_APPROVAL_PATH`), its exact path is marked "to verify" in A.9.
 * Failure is bounded: three attempts with a backoff, then the relay writes an
 * explicit notice — a lost resolution is never silent.
 */
import type { WaitResponse } from '@bipeur/core';
import { endpointOf, type CrewConfig } from './config.js';

export interface Resolution {
  approval_id: string;
  decision: 'approve' | 'deny';
  reason: string;
}

export interface ResolveDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

export interface ResolveOutcome {
  ok: boolean;
  attempts: number;
  error: string | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A page decision becomes an approval resolution. Anything else than a yes denies. */
export function toResolution(approvalId: string, decision: WaitResponse): Resolution {
  switch (decision.status) {
    case 'approved':
      return { approval_id: approvalId, decision: 'approve', reason: 'approved from the pager' };
    case 'choice':
      return {
        approval_id: approvalId,
        decision: 'approve',
        reason: `choice ${decision.choice ?? '?'} from the pager`,
      };
    case 'denied':
      return {
        approval_id: approvalId,
        decision: 'deny',
        reason: decision.reason ?? 'denied from the pager',
      };
    case 'cancelled':
      return { approval_id: approvalId, decision: 'deny', reason: 'page cancelled' };
    case 'expired':
    case 'pending':
      return { approval_id: approvalId, decision: 'deny', reason: 'no decision before expiry' };
  }
}

export async function resolveApproval(
  config: CrewConfig,
  resolution: Resolution,
  deps: ResolveDeps = {},
): Promise<ResolveOutcome> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const attempts = Math.max(1, deps.attempts ?? config.resolveAttempts);
  const backoffMs = deps.backoffMs ?? config.backoffMs;
  const url = endpointOf(config.gatewayUrl, config.approvalPath);
  let lastError = 'no attempt made';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(resolution),
        signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
      });
      if (response.ok) return { ok: true, attempts: attempt, error: null };
      lastError = `crew gateway answered ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await sleep(backoffMs * 2 ** (attempt - 1));
  }
  return { ok: false, attempts, error: lastError };
}
