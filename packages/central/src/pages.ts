/**
 * Creation, cancellation, read and expiry of a page (BIP-F-01 to F-04, F-07,
 * F-11, F-14). The line is composed here, never taken from the caller's prose;
 * the dedupe key makes a retried request land on the page already waiting.
 */
import {
  DEFAULT_TTL_MS,
  LINE_MAX,
  createPageRequestSchema,
  parseDurationOr,
  type CreatePageRequest,
} from '@bipeur/core';
import { newId } from '@bipeur/core/node';
import { composeRequest, fingerprintOf, type Composed } from './compose.js';
import type { CentralContext } from './context.js';
import { onCall } from './rota.js';
import { applyPageState, ensureDelivered, isPending } from './states.js';
import { streamFilterFor } from './targeting.js';
import type { DeviceRow, PageRow, SourceRow } from './store/types.js';

export type CreateOutcome =
  | { ok: true; created: boolean; page: PageRow }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Printable ASCII only on the wire (A.6, BIP-N-08): a control character is refused. */
function hasControlChar(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function createPage(ctx: CentralContext, source: SourceRow, body: unknown): CreateOutcome {
  const parsed = createPageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 422,
      body: {
        error: 'invalid_request',
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`),
      },
    };
  }
  const request = parsed.data;
  const problem = checkQuestion(request);
  if (problem) return { ok: false, status: 422, body: problem };

  const now = ctx.clock();
  const rota = resolveRota(ctx, request.rota, now);
  if (!rota.ok) return rota;

  const rules = ctx.rules.current();
  const payloadFingerprint = fingerprintOf(request);
  // The same line paged to two different rotas must not dedupe (BIP-F-37).
  const dedupeKey = request.dedupe_key ?? (request.rota ? `${payloadFingerprint}::rota:${request.rota}` : payloadFingerprint);
  const existing = ctx.store.pendingPageByDedupe(source.id, dedupeKey, now);
  if (existing) return { ok: true, created: false, page: existing };

  const composed = composeRequest(request, source.alias, rules, payloadFingerprint);
  const ttl = request.ttl_seconds ? request.ttl_seconds * 1000 : parseDurationOr(rules.defaults.ttl, DEFAULT_TTL_MS);
  const page = buildPageRow({ request, source, composed, ttl, dedupeKey, payloadFingerprint, now, rotaId: rota.rotaId, rotaTarget: rota.target });
  persistPage(ctx, page, composed.matched_by, rota.target, composed.truncated);
  return { ok: true, created: true, page: ctx.gate.attempt(page, now) };
}

interface BuildInput {
  request: CreatePageRequest;
  source: SourceRow;
  composed: Composed;
  ttl: number;
  dedupeKey: string;
  payloadFingerprint: string;
  now: number;
  rotaId: string | null;
  rotaTarget: string | null;
}

/** The record as it goes to SQLite: composed facts only, never agent prose. */
function buildPageRow(input: BuildInput): PageRow {
  const { request, source, composed, ttl, dedupeKey, payloadFingerprint, now, rotaId } = input;
  return {
    id: newId('pg'),
    source_id: source.id,
    source_alias: source.alias,
    kind: request.kind,
    code: composed.code,
    risk: composed.risk,
    line: composed.line,
    detail: composed.detail,
    payload: request,
    payload_sha256: payloadFingerprint,
    options: request.kind === 'question' ? (request.options ?? []) : [],
    state: 'queued',
    created_at: now,
    delivered_at: null,
    read_at: null,
    expires_at: now + ttl,
    dedupe_key: dedupeKey,
    callback_url: request.callback_url ?? null,
    reminders_sent: 0,
    visitor_id: source.visitor_id,
    rota_id: rotaId,
    escalation_level: 0,
    escalated_at: null,
  };
}

/** Validates the rota of the request and returns the on-call to ring. */
type RotaResolution =
  | { ok: true; rotaId: string | null; target: string | null }
  | { ok: false; status: number; body: Record<string, unknown> };

function resolveRota(ctx: CentralContext, label: string | undefined, now: number): RotaResolution {
  if (label === undefined || label === '') return { ok: true, rotaId: null, target: null };
  const rota = ctx.store.rotaByLabel(label);
  if (!rota) return { ok: false, status: 422, body: { error: 'unknown_rota', label } };
  const current = onCall(rota, ctx.store.listShifts(rota.id), now);
  if (!current) return { ok: false, status: 422, body: { error: 'rota_has_no_oncall', label } };
  return { ok: true, rotaId: rota.id, target: current.target };
}

function persistPage(
  ctx: CentralContext,
  page: PageRow,
  matchedBy: string,
  target: string | null,
  truncated: boolean,
): void {
  ctx.store.transaction(() => {
    ctx.store.insertPage(page);
    if (target) ctx.store.addPageTarget(page.id, target);
    ctx.audit.append({
      type: 'page.created',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: {
        code: page.code,
        risk: page.risk,
        kind: page.kind,
        ttl_ms: page.expires_at - page.created_at,
        matched_by: matchedBy,
        // BIP-F-03: the log says the line was cut, so nobody believes a
        // shortened line is the whole message.
        ...(truncated ? { truncated: true } : {}),
        ...(page.rota_id ? { rota_id: page.rota_id, rota_target: target } : {}),
      },
    });
  });
}

/** BIP-F-03: a question that cannot fit 80 characters is refused, with the count. */
function checkQuestion(request: CreatePageRequest): { error: string; length?: number; max?: number; overflow?: number } | null {
  if (request.kind !== 'question') return null;
  if (hasControlChar(request.question)) {
    return { error: 'non_printable', length: request.question.length, max: LINE_MAX };
  }
  if (request.question.length > LINE_MAX) {
    return {
      error: 'question_too_long',
      length: request.question.length,
      max: LINE_MAX,
      overflow: request.question.length - LINE_MAX,
    };
  }
  return null;
}

export function ownedPage(ctx: CentralContext, source: SourceRow, id: string): PageRow | null {
  const page = ctx.store.pageById(id);
  if (!page) return null;
  if (page.source_id !== source.id) return null;
  return page;
}

export function cancelPage(ctx: CentralContext, source: SourceRow, id: string): { status: number; body: Record<string, unknown> } {
  const page = ownedPage(ctx, source, id);
  if (!page) return { status: 404, body: { error: 'unknown_page' } };
  if (!isPending(page.state)) return { status: 409, body: { error: 'not_cancellable', state: page.state } };
  const now = ctx.clock();
  const outcome = applyPageState(ctx, page, 'cancelled', now);
  if (!outcome.ok) return { status: 409, body: { error: 'illegal_transition', state: page.state } };
  ctx.audit.append({
    type: 'page.cancelled',
    page_id: page.id,
    source_id: page.source_id,
    fingerprint: page.payload_sha256,
    data: { after_ms: now - page.created_at },
  });
  ctx.hub.broadcast({ type: 'page.cancelled', page_id: page.id }, streamFilterFor(ctx, page));
  return { status: 200, body: { state: 'cancelled', page_id: page.id } };
}

export function markRead(ctx: CentralContext, device: DeviceRow, id: string): { status: number; body: Record<string, unknown> } {
  const page = ctx.store.pageById(id);
  if (!page) return { status: 404, body: { error: 'unknown_page' } };
  if (page.visitor_id !== null && page.visitor_id !== device.visitor_id) {
    return { status: 403, body: { error: 'forbidden' } };
  }
  if (page.state === 'read' || page.state === 'decided') return { status: 200, body: { ok: true, state: page.state } };
  if (!isPending(page.state)) return { status: 409, body: { error: 'not_pending', state: page.state } };
  const now = ctx.clock();
  const delivered = ensureDelivered(ctx, page, now);
  const outcome = applyPageState(ctx, delivered, 'read', now, { read_at: now });
  if (!outcome.ok) return { status: 409, body: { error: 'illegal_transition', state: delivered.state } };
  ctx.audit.append({
    type: 'page.read',
    page_id: page.id,
    source_id: page.source_id,
    device_id: device.id,
    fingerprint: page.payload_sha256,
    data: { after_ms: now - (page.delivered_at ?? page.created_at) },
  });
  ctx.hub.broadcast({ type: 'page.read', page_id: page.id }, streamFilterFor(ctx, page));
  return { status: 200, body: { ok: true, state: 'read' } };
}

/** BIP-F-07: an expired page is a refusal. It is never approved by default. */
export function expirePage(ctx: CentralContext, page: PageRow, now: number): PageRow {
  const outcome = applyPageState(ctx, page, 'expired', now);
  if (!outcome.ok) return page;
  ctx.audit.append({
    type: 'page.expired',
    page_id: page.id,
    source_id: page.source_id,
    fingerprint: page.payload_sha256,
    data: { after_ms: now - page.created_at, default: 'deny' },
  });
  ctx.hub.broadcast({ type: 'page.expired', page_id: page.id }, streamFilterFor(ctx, page));
  return outcome.page;
}

export function expireDue(ctx: CentralContext, now: number): number {
  let expired = 0;
  for (const page of ctx.store.listPages({ state: 'pending', limit: 200 })) {
    if (page.expires_at > now) continue;
    expirePage(ctx, page, now);
    expired += 1;
  }
  return expired;
}
