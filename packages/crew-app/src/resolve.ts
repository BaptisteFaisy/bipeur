/**
 * Resolution of a Crew approval (BIP-F-27) against the real Gateway routes.
 *
 * Contract (sources in docs/CREW.md):
 * - slot-scoped decide: `POST /api/chat/slots/{slot}/approve` with
 *   `{action: "approved"|"rejected", request_id, response_id?}`
 *   (`dashboard/chat_api/slot_approval.py api_chat_slot_approve`);
 * - a rejection `reason` is only admitted on the native decide form
 *   `{origin:"native", request_id, request_mid, action:"rejected", reason}` —
 *   `request_mid` is the broadcast record's `instance`, which names this one
 *   request; any other caller sending `reason` gets 400
 *   `invalid_rejection_reason`;
 * - `response_id` names one decision, so a retry replays the same outcome
 *   (Gateway-side idempotence, `shared_crew/decisions.py`);
 * - an approval without a slot falls back to the global route
 *   `POST /api/approvals/{id}/{approve|reject}` — with an app token it only
 *   resolves when exactly one controllable slot owns the id;
 * - 401/403 expire the token: exchange again once, then retry; 404 means the
 *   approval is settled or out of scope — terminal, never retried; 429/5xx
 *   and network errors retry with a bounded backoff.
 *
 * Failure is bounded and never silent: after the attempts run out, the relay
 * writes an explicit notice to the Central journal.
 */
import type { WaitResponse } from '@bipeur/core';
import type { CrewAuth } from './auth.js';
import { endpointOf, fillTemplate, type CrewConfig } from './config.js';

export interface Resolution {
  approval_id: string;
  /** The record's `instance`: `request_mid` of the native form. '' if absent. */
  instance: string;
  /** The slot owning the request; '' routes to the global approval path. */
  slot: string;
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
  /** The Gateway answered 404: settled elsewhere or out of scope. Terminal. */
  settled: boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A page decision becomes an approval resolution. Anything else than a yes denies. */
export function toResolution(
  approvalId: string,
  instance: string,
  slot: string,
  decision: WaitResponse,
): Resolution {
  switch (decision.status) {
    case 'approved':
      return { approval_id: approvalId, instance, slot, decision: 'approve', reason: '' };
    case 'choice':
      return {
        approval_id: approvalId,
        instance,
        slot,
        decision: 'approve',
        reason: `choice ${decision.choice ?? '?'}`,
      };
    case 'denied':
      return {
        approval_id: approvalId,
        instance,
        slot,
        decision: 'deny',
        reason: decision.reason ?? 'denied from the pager',
      };
    case 'cancelled':
      return { approval_id: approvalId, instance, slot, decision: 'deny', reason: 'page cancelled' };
    case 'expired':
    case 'pending':
      return { approval_id: approvalId, instance, slot, decision: 'deny', reason: 'no decision before expiry' };
  }
}

/** Stable per (request, decision): a retry replays the same Gateway outcome. */
export function responseIdOf(resolution: Resolution): string {
  const who = resolution.instance.length > 0 ? resolution.instance : resolution.approval_id;
  return `bipeur:${who.slice(0, 100)}:${resolution.decision === 'approve' ? 'a' : 'd'}`;
}

function bodiesFor(resolution: Resolution): Record<string, unknown>[] {
  const response_id = responseIdOf(resolution);
  const request_id = resolution.approval_id;
  if (resolution.decision === 'approve') {
    return [{ action: 'approved', request_id, response_id }];
  }
  if (resolution.reason.length > 0 && resolution.instance.length > 0) {
    // The native form is the only one that carries the human's reason. If the
    // Gateway refuses it (400), the plain form without the reason follows.
    return [
      { origin: 'native', request_id, request_mid: resolution.instance, action: 'rejected', reason: resolution.reason, response_id },
      { action: 'rejected', request_id, response_id },
    ];
  }
  return [{ action: 'rejected', request_id, response_id }];
}

function target(config: CrewConfig, resolution: Resolution): { url: string; body: Record<string, unknown> | null } {
  if (resolution.slot.length > 0) {
    return {
      url: endpointOf(config.gatewayUrl, fillTemplate(config.approvalPath, { slot: resolution.slot })),
      body: null, // filled per attempt from bodiesFor
    };
  }
  const action = resolution.decision === 'approve' ? 'approve' : 'reject';
  return {
    url: endpointOf(config.gatewayUrl, fillTemplate(config.globalApprovalPath, { id: resolution.approval_id, action })),
    body: null,
  };
}

export async function resolveApproval(
  config: CrewConfig,
  auth: CrewAuth,
  resolution: Resolution,
  deps: ResolveDeps = {},
): Promise<ResolveOutcome> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const attempts = Math.max(1, deps.attempts ?? config.resolveAttempts);
  const backoffMs = deps.backoffMs ?? config.backoffMs;
  const { url } = target(config, resolution);
  const bodies = resolution.slot.length > 0 ? bodiesFor(resolution) : [null];
  let lastError = 'no attempt made';
  let reauthed = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (let form = 0; form < bodies.length; form += 1) {
      const outcome = await oneCall(fetchImpl, auth, url, bodies[form] as Record<string, unknown> | null, deps);
      if (outcome.kind === 'ok') return { ok: true, attempts: attempt, error: null, settled: false };
      if (outcome.kind === 'settled') {
        return { ok: false, attempts: attempt, error: outcome.error, settled: true };
      }
      if (outcome.kind === 'auth' && !reauthed) {
        reauthed = true;
        auth.invalidate();
        form -= 1; // same body again, with a fresh token; not a new attempt
        continue;
      }
      if (outcome.kind === 'bad_form' && form + 1 < bodies.length) continue; // next decide form
      lastError = outcome.error;
      break;
    }
    if (attempt < attempts) await sleep(backoffMs * 2 ** (attempt - 1));
  }
  return { ok: false, attempts, error: lastError, settled: false };
}

type CallOutcome =
  | { kind: 'ok' }
  | { kind: 'settled'; error: string }
  | { kind: 'auth'; error: string }
  | { kind: 'bad_form'; error: string }
  | { kind: 'retry'; error: string };

async function oneCall(
  fetchImpl: typeof fetch,
  auth: CrewAuth,
  url: string,
  body: Record<string, unknown> | null,
  deps: ResolveDeps,
): Promise<CallOutcome> {
  let response: Response;
  try {
    const cookie = await auth.cookieHeader();
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie.length > 0 ? { cookie } : {}) },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
    });
  } catch (error) {
    return { kind: 'retry', error: error instanceof Error ? error.message : String(error) };
  }
  if (response.ok) return { kind: 'ok' };
  const code = await response.json().then((j) => (j as { code?: string })?.code ?? '', () => '');
  if (response.status === 401 || response.status === 403) {
    return { kind: 'auth', error: `gateway answered ${response.status}${code ? ` (${code})` : ''}` };
  }
  if (response.status === 404) {
    return { kind: 'settled', error: `gateway answered 404${code ? ` (${code})` : ''}: settled or out of scope` };
  }
  if (response.status === 400) return { kind: 'bad_form', error: `gateway refused the decide form (400 ${code})` };
  return { kind: 'retry', error: `gateway answered ${response.status}` };
}
