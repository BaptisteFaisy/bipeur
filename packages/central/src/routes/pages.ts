/** Page routes: creation, reading, waiting, cancelling, deciding, dry-run. */
import {
  dryRunRequestSchema,
  noticeRequestSchema,
  type CreatePageRequest,
} from '@bipeur/core';
import { newId } from '@bipeur/core/node';
import type { Hono } from 'hono';
import { authenticateDevice, authenticateStation } from '../api-auth.js';
import { composeRequest, fingerprintOf } from '../compose.js';
import type { CentralContext } from '../context.js';
import { decidePage } from '../decide.js';
import { bearer } from '../http-auth.js';
import { json } from '../http-json.js';
import { cancelPage, createPage, expirePage, markRead, ownedPage } from '../pages.js';
import type { RateLimiter } from '../rate-limit.js';
import { isPending } from '../states.js';
import type { DecisionRow, PageRow, SourceRow } from '../store/types.js';
import { pageView, statusOf } from '../view.js';

export interface RouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
  deviceLimiter: RateLimiter;
}

const MAX_WAIT_SECONDS = 60;

export function registerPageRoutes(app: Hono, deps: RouteDeps): void {
  registerCreationRoutes(app, deps);
  registerWaitRoutes(app, deps);
  registerDeviceRoutes(app, deps);
}

function registerCreationRoutes(app: Hono, deps: RouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.post('/v1/pages', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const body: unknown = await c.req.json().catch(() => null);
    const outcome = createPage(ctx, auth.source, body);
    if (!outcome.ok) return json(outcome.body, outcome.status);
    return json(pageView(outcome.page), outcome.created ? 201 : 200);
  });

  app.get('/v1/pages/:id', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const page = ownedPage(ctx, auth.source, c.req.param('id') ?? '');
    if (!page) return json({ error: 'unknown_page' }, 404);
    return json({ ...pageView(page), status: statusOf(page, ctx.store.decisionByPage(page.id), ctx.clock()) });
  });

  app.delete('/v1/pages/:id', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const outcome = cancelPage(ctx, auth.source, c.req.param('id') ?? '');
    return json(outcome.body, outcome.status);
  });

  app.post('/v1/notices', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const parsed = noticeRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'invalid_request' }, 422);
    return json(logNotice(ctx, auth.source, parsed.data.line), 201);
  });

  app.post('/v1/rules/dry-run', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const parsed = dryRunRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'invalid_request' }, 422);
    return json(dryRun(ctx, auth.source, parsed.data));
  });
}

function registerWaitRoutes(app: Hono, deps: RouteDeps): void {
  const { ctx, stationLimiter } = deps;

  // The waiting call is also reachable without a token: the page id is an
  // unguessable capability, and the answer carries no payload, only the verdict
  // and the fingerprint. A token, when present, must own the page.
  app.get('/v1/pages/:id/decision', async (c) => {
    const page = await waitablePage(ctx, stationLimiter, c);
    if (!page) return json({ error: 'unknown_page' }, 404);
    if (page instanceof Response) return page;
    const wait = clampWait(c.req.query('wait'));
    return json(await waitForSettlement(ctx, page, wait));
  });
}

function registerDeviceRoutes(app: Hono, deps: RouteDeps): void {
  const { ctx, deviceLimiter } = deps;

  app.post('/v1/pages/:id/decision', async (c) => {
    const auth = authenticateDevice(ctx, deviceLimiter, c);
    if (!auth.ok) return auth.response;
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const outcome = decidePage(ctx, auth.device, { ...raw, page_id: c.req.param('id') });
    return json(outcome.body, outcome.status);
  });

  app.post('/v1/pages/:id/read', (c) => {
    const auth = authenticateDevice(ctx, deviceLimiter, c);
    if (!auth.ok) return auth.response;
    const outcome = markRead(ctx, auth.device, c.req.param('id') ?? '');
    return json(outcome.body, outcome.status);
  });
}

/** BIP-F-13: a notice goes to the digest and never becomes a page. */
function logNotice(ctx: CentralContext, source: SourceRow, line: string): { notice_id: string } {
  const now = ctx.clock();
  const notice = {
    id: newId('nt'),
    source_id: source.id,
    source_alias: source.alias,
    ts: now,
    line,
    visitor_id: source.visitor_id,
  };
  ctx.store.insertNotice(notice);
  ctx.audit.append({ type: 'notice.logged', source_id: source.id, data: { notice_id: notice.id } });
  ctx.hub.broadcast({ type: 'notice.logged', notice: { ...notice } }, { visitorId: source.visitor_id });
  return { notice_id: notice.id };
}

/** BIP-F-32: what the rules would produce, without creating anything. */
function dryRun(ctx: CentralContext, source: SourceRow, input: { command?: string; tool_name?: string; path?: string }): Record<string, unknown> {
  const request: CreatePageRequest = {
    kind: 'tool',
    tool_name: input.tool_name ?? 'shell',
    command: input.command,
    path: input.path,
  };
  const composed = composeRequest(request, source.alias, ctx.rules.current(), fingerprintOf(request));
  return {
    line: composed.line,
    code: composed.code,
    risk: composed.risk,
    verb: composed.verb,
    matched_by: composed.matched_by,
    detail: composed.detail,
  };
}

/** Page a waiter may poll: its owner when a token is given, else by capability. */
function waitablePage(
  ctx: CentralContext,
  stationLimiter: RateLimiter,
  c: Parameters<typeof authenticateStation>[2],
): PageRow | Response | null {
  const token = bearer(c.req.header('authorization'));
  if (!token) {
    const id = c.req.param('id');
    return id ? ctx.store.pageById(id) : null;
  }
  const auth = authenticateStation(ctx, stationLimiter, c);
  if (!auth.ok) return auth.response;
  return ownedPage(ctx, auth.source, c.req.param('id') ?? '');
}

function clampWait(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? '0', 10);
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_WAIT_SECONDS, Math.max(0, value));
}

/** BIP-F-06: answer as soon as a decision exists, or after N seconds. */
async function waitForSettlement(ctx: CentralContext, page: PageRow, waitSeconds: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const current = ctx.store.pageById(page.id) ?? page;
    const now = ctx.clock();
    if (isPending(current.state) && current.expires_at <= now) expirePage(ctx, current, now);
    const fresh = ctx.store.pageById(page.id) ?? current;
    const decision = ctx.store.decisionByPage(fresh.id);
    if (!isPending(fresh.state) || Date.now() >= deadline) return settle(ctx, fresh, decision);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function settle(ctx: CentralContext, page: PageRow, decision: DecisionRow | null): Record<string, unknown> {
  const now = ctx.clock();
  const status = statusOf(page, decision, now);
  return {
    status,
    page_id: page.id,
    choice: decision?.choice_code ?? null,
    reason: status === 'expired' ? 'no human decision' : null,
    fingerprint: page.payload_sha256,
    latency_ms: decision ? decision.latency_ms : Math.max(0, now - page.created_at),
  };
}
