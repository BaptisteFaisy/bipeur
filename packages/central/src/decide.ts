/**
 * Reception of a signed decision (BIP-F-18, BIP-P-04/05/06). The order is the
 * one security.md imposes: signature, device, fingerprint, deadline, nonce.
 * Any failure writes `decision.rejected` and changes nothing.
 */
import {
  checkClaims,
  isExpired,
  signedDecisionSchema,
  type ClaimProblem,
  type DecisionClaims,
  type SignedDecision,
} from '@bipeur/core';
import { verifyDecisionSignature } from '@bipeur/core/node';
import type { CentralContext } from './context.js';
import { expirePage } from './pages.js';
import { applyPageState, ensureDelivered, isPending } from './states.js';
import type { DeviceRow, PageRow } from './store/types.js';

export interface DecideOutcome {
  status: number;
  body: Record<string, unknown>;
}

const PROBLEM_STATUS: Record<ClaimProblem['code'], number> = {
  fingerprint_mismatch: 422,
  expired: 409,
  malformed: 422,
  choice_required: 422,
};

export function decidePage(ctx: CentralContext, device: DeviceRow, rawBody: unknown): DecideOutcome {
  const now = ctx.clock();
  const parsed = signedDecisionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return reject(ctx, device, null, null, 422, 'malformed', {
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
  }
  const signed = parsed.data;
  const page = ctx.store.pageById(signed.page_id);
  if (!page) return reject(ctx, device, null, signed.fingerprint, 404, 'unknown_page');
  if (signed.device_id !== device.id) {
    return reject(ctx, device, page.id, signed.fingerprint, 403, 'device_mismatch');
  }

  const claims = claimsOf(signed);
  if (!verifyDecisionSignature({ claims, signature: signed.signature, publicKeyJwk: device.public_key_jwk })) {
    return reject(ctx, device, page.id, signed.fingerprint, 422, 'bad_signature');
  }

  const refused = checkAdmissible(ctx, device, page, claims, now);
  if (refused) return refused;

  return accept(ctx, device, page, claims, signed.signature, now);
}

/** BIP-P-04: the nonce and the decision are written in one transaction. */
function accept(
  ctx: CentralContext,
  device: DeviceRow,
  page: PageRow,
  claims: DecisionClaims,
  signature: string,
  now: number,
): DecideOutcome {
  const delivered = ensureDelivered(ctx, page, now);
  const latency = Math.max(0, now - (delivered.delivered_at ?? delivered.created_at));
  const accepted = ctx.store.transaction(() => {
    ctx.store.recordNonce(claims.nonce, device.id, now);
    return ctx.store.insertDecision({
      page_id: page.id,
      device_id: device.id,
      verdict: claims.verdict,
      choice_code: claims.choice,
      nonce: claims.nonce,
      signature,
      decided_at: now,
      latency_ms: latency,
    });
  });
  if (!accepted) return reject(ctx, device, page.id, claims.fingerprint, 409, 'already_decided');

  const outcome = applyPageState(ctx, delivered, 'decided', now);
  if (!outcome.ok) return reject(ctx, device, page.id, claims.fingerprint, 409, 'illegal_transition');

  ctx.audit.append({
    type: 'page.decided', page_id: page.id, source_id: page.source_id, device_id: device.id,
    fingerprint: page.payload_sha256,
    data: { verdict: claims.verdict, choice: claims.choice, latency_ms: latency },
  });
  ctx.hub.broadcast({ type: 'page.decided', page_id: page.id, verdict: claims.verdict }, { visitorId: page.visitor_id });
  return {
    status: 200,
    body: { accepted: true, page_id: page.id, verdict: claims.verdict, choice: claims.choice, latency_ms: latency },
  };
}

function claimsOf(signed: SignedDecision): DecisionClaims {
  return {
    page_id: signed.page_id,
    fingerprint: signed.fingerprint,
    verdict: signed.verdict,
    choice: signed.choice ?? null,
    nonce: signed.nonce,
    expires_at: signed.expires_at,
    device_id: signed.device_id,
  };
}

/**
 * The cheap refusals, in the order security.md imposes: claims, replay,
 * state, deadline, choice. Returns null when the decision may be applied.
 */
function checkAdmissible(
  ctx: CentralContext,
  device: DeviceRow,
  page: PageRow,
  claims: DecisionClaims,
  now: number,
): DecideOutcome | null {
  const fingerprint = claims.fingerprint;
  const problem = checkClaims(claims, {
    fingerprint: page.payload_sha256,
    now,
    hasOptions: page.options.length > 0,
  });
  if (problem) {
    return reject(ctx, device, page.id, fingerprint, PROBLEM_STATUS[problem.code], problem.code, {
      detail: problem.detail,
    });
  }
  if (ctx.store.hasNonce(claims.nonce)) {
    return reject(ctx, device, page.id, fingerprint, 409, 'replayed_nonce');
  }
  if (!isPending(page.state)) {
    return reject(ctx, device, page.id, fingerprint, 409, `page_${page.state}`);
  }
  if (isExpired(page.expires_at, now)) {
    expirePage(ctx, page, now);
    return reject(ctx, device, page.id, fingerprint, 409, 'expired');
  }
  if (claims.verdict === 'choice' && !page.options.some((option) => option.code === claims.choice)) {
    return reject(ctx, device, page.id, fingerprint, 422, 'unknown_choice');
  }
  return null;
}

function reject(
  ctx: CentralContext,
  device: DeviceRow,
  pageId: string | null,
  fingerprint: string | null,
  status: number,
  reason: string,
  extra: Record<string, unknown> = {},
): DecideOutcome {
  ctx.audit.append({
    type: 'decision.rejected',
    page_id: pageId,
    device_id: device.id,
    fingerprint,
    data: { reason, ...extra },
  });
  return { status, body: { accepted: false, reason, ...extra } };
}
