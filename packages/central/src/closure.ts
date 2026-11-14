/**
 * The closing page (BIP-F-41).
 *
 * An approval used to be the end of the story: the agent got its green light
 * and vanished. Nobody knew what it did with it, and the human who approved a
 * four-line summary had no way to check the outcome. A closure is the other
 * half of the loop — the agent *proves* what it did, and the pager of the
 * person who decided learns the result.
 *
 * The closing page is a real page, so it is audited, streamed and readable on
 * the pager like any other. Three things set it apart, and each is a decision,
 * not a convenience:
 *
 * - it is composed from the **evidence** (a commit sha, a PR number, a file
 *   list), never from the agent's prose; the prose goes behind `AGENT SAYS:`,
 *   exactly as on an approval page. The honesty rule does not pause for
 *   receipts;
 * - it **asks nothing**: no option, no callback, a short TTL. It expires inert;
 * - it **never costs attention**: family 8 bypasses the budget, so closing the
 *   loop is the one thing that can never be held behind a queue of questions.
 *
 * One page has one closure. The primary key is the proof, and a retried
 * request lands on the row that already exists instead of writing a second
 * receipt.
 */
import {
  CLOSURE_CODE,
  CLOSURE_TTL_MS,
  closureRequestSchema,
  composeLineDetailed,
  buildDetailScreens,
  type ClosureRequest,
} from '@bipeur/core';
import { fingerprint, newId } from '@bipeur/core/node';
import type { CentralContext } from './context.js';
import type { ClosureRow, PageRow, SourceRow } from './store/types.js';
import { pageView } from './view.js';

export type ClosureOutcome =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

/** What the closing page is composed from: the fact, never the narrative. */
function closureFacts(closure: ClosureRequest, origin: PageRow): Record<string, unknown> {
  return {
    page_id: closure.page_id,
    origin_fingerprint: origin.payload_sha256,
    evidence: closure.evidence ?? null,
    verdict: 'closed',
  };
}

export function recordClosure(ctx: CentralContext, source: SourceRow, body: unknown): ClosureOutcome {
  const parsed = closureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return reject(ctx, source, null, null, 422, 'invalid_request', {
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`),
    });
  }
  const closure = parsed.data;
  const origin = ctx.store.pageById(closure.page_id);
  if (!origin) return reject(ctx, source, closure.page_id, null, 404, 'unknown_page');
  if (origin.source_id !== source.id) {
    return reject(ctx, source, origin.id, origin.payload_sha256, 403, 'not_your_page');
  }
  const decision = ctx.store.decisionByPage(origin.id);
  if (!decision) return reject(ctx, source, origin.id, origin.payload_sha256, 409, 'not_decided');
  if (decision.verdict === 'deny') {
    return reject(ctx, source, origin.id, origin.payload_sha256, 409, 'denied_page');
  }
  const existing = ctx.store.closureByPage(origin.id);
  if (existing) {
    // A retry is not a second closure: the receipt already exists.
    return { ok: true, status: 200, body: { ...closureView(existing), page: pageView(reloadPage(ctx, existing.closure_page_id)) } };
  }
  return accept(ctx, source, closure, origin, decision.device_id);
}

/** Writes the closing page and its receipt in one transaction. */
function accept(
  ctx: CentralContext,
  source: SourceRow,
  closure: ClosureRequest,
  origin: PageRow,
  deviceId: string,
): ClosureOutcome {
  const now = ctx.clock();
  const facts = closureFacts(closure, origin);
  const payloadFingerprint = fingerprint(facts);
  const closing = buildClosingPage({ source, closure, origin, payloadFingerprint, now });
  const row: ClosureRow = {
    page_id: origin.id,
    closure_page_id: closing.id,
    source_id: source.id,
    summary: closure.summary,
    evidence: closure.evidence ?? null,
    origin_fingerprint: origin.payload_sha256,
    created_at: now,
  };
  ctx.store.transaction(() => {
    ctx.store.insertPage(closing);
    ctx.store.addPageTarget(closing.id, deviceId);
    const written = ctx.store.insertClosure(row);
    if (!written) return;
    ctx.audit.append({
      type: 'page.closed',
      page_id: origin.id,
      source_id: source.id,
      device_id: deviceId,
      fingerprint: origin.payload_sha256,
      data: { closure_page_id: closing.id, code: closing.code, risk: closing.risk, evidence: true },
    });
    ctx.audit.append({
      type: 'page.created',
      page_id: closing.id,
      source_id: source.id,
      fingerprint: closing.payload_sha256,
      data: { code: closing.code, risk: closing.risk, kind: closing.kind, closes: origin.id },
    });
  });
  // Delivery is outside the transaction: a page that never reached a pager is
  // still a closed page, and the receipt must not be rolled back for a socket.
  const delivered = ctx.gate.attempt(closing, now);
  return { ok: true, status: 201, body: { ...closureView(row), page: pageView(delivered) } };
}

interface ClosingInput {
  source: SourceRow;
  closure: ClosureRequest;
  origin: PageRow;
  payloadFingerprint: string;
  now: number;
}

/**
 * The closing page: family 8, verb DONE, no option, no callback. The line
 * carries the evidence; the agent's summary sits on the last screen, labelled.
 */
function buildClosingPage(input: ClosingInput): PageRow {
  const { source, closure, origin, payloadFingerprint, now } = input;
  const subject = closure.evidence?.trim() || `closed ${origin.line.slice(-9)}`;
  const line = composeLineDetailed({
    code: CLOSURE_CODE,
    station: source.alias,
    verb: 'DONE',
    subject,
    fingerprint: payloadFingerprint,
  });
  return {
    id: newId('pg'),
    source_id: source.id,
    source_alias: source.alias,
    kind: 'tool',
    code: CLOSURE_CODE,
    risk: 'green',
    line: line.line,
    detail: closingScreens(origin, closure),
    payload: { tool_name: 'closure', command: closure.evidence ?? '', agent_says: closure.summary },
    payload_sha256: payloadFingerprint,
    options: [],
    state: 'queued',
    created_at: now,
    delivered_at: null,
    read_at: null,
    expires_at: now + CLOSURE_TTL_MS,
    dedupe_key: `closure:${origin.id}`,
    callback_url: null,
    reminders_sent: 0,
    visitor_id: source.visitor_id,
    rota_id: null,
    escalation_level: 0,
    escalated_at: null,
    // BIP-F-47: a receipt is its own block. It asks nothing, so it must never
    // be grouped with a question — and it never belongs to one.
    group_key: null,
    group_leader_id: null,
    // BIP-F-42: a receipt is never simulated — it is the proof of a real
    // decision, and shadow mode must never be able to stamp one.
    shadow_resolved_at: null,

    // BIP-F-43: a receipt is never a canary — it asks nothing, and the
    // reflex guard is about the pages a human is asked to DECIDE.
    canary: false,
  };
}

/**
 * The screens of a receipt: the fact first (`closes <page> <line>`), the
 * evidence as context, and the agent's own words last, behind `AGENT SAYS:`.
 * The honesty rule does not pause for receipts (A.6, BIP-F-41).
 */
function closingScreens(origin: PageRow, closure: ClosureRequest): string[] {
  return buildDetailScreens({
    full: `closes ${origin.id} ${origin.line}`,
    context: closure.evidence ? `evidence ${closure.evidence}` : undefined,
    agentSays: closure.summary,
  });
}

/** The receipt as it goes back on the wire — the summary is the caller's own. */
export function closureView(row: ClosureRow): Record<string, unknown> {
  return {
    page_id: row.page_id,
    closure_page_id: row.closure_page_id,
    evidence: row.evidence,
    summary: row.summary,
    origin_fingerprint: row.origin_fingerprint,
    closed_at: row.created_at,
  };
}

function reloadPage(ctx: CentralContext, id: string): PageRow {
  const page = ctx.store.pageById(id);
  if (!page) throw new Error(`closure page ${id} vanished after being written`);
  return page;
}

/** A refusal is always journalled: a rejected closure is a fact too. */
function reject(
  ctx: CentralContext,
  source: SourceRow,
  pageId: string | null,
  fingerprintValue: string | null,
  status: number,
  reason: string,
  extra?: Record<string, unknown>,
): ClosureOutcome {
  ctx.audit.append({
    type: 'closure.rejected',
    page_id: pageId,
    source_id: source.id,
    fingerprint: fingerprintValue,
    data: { reason, ...(extra ?? {}) },
  });
  return { ok: false, status, body: { error: reason, ...(extra ?? {}) } };
}
