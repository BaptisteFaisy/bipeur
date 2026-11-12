/**
 * Bounded delegation (BIP-F-36): the operator pre-approves a class of
 * commands for one station — a glob pattern, a TTL, a number of uses — and
 * the agent then runs them without opening a page. Every use is a write, so a
 * delegation is provably spent, and revocable in one gesture.
 *
 * The gate consults `POST /v1/delegations/consume` before it pages: a match
 * is the difference between silence and a page.
 */
import { globToRegExp } from '@bipeur/core';
import { newId } from '@bipeur/core/node';
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';
import type { DelegationRow, SourceRow } from '../store/types.js';

export interface DelegationRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

const DEFAULT_TTL_SECONDS = 15 * 60;
const DEFAULT_REMAINING = 10;
const PATTERN_MAX = 200;

function view(delegation: DelegationRow): Record<string, unknown> {
  return {
    delegation_id: delegation.id,
    pattern: delegation.pattern,
    kind: delegation.kind,
    remaining: delegation.remaining,
    expires_at: delegation.expires_at,
    revoked_at: delegation.revoked_at,
  };
}

function create(
  ctx: CentralContext,
  source: SourceRow,
  body: Record<string, unknown> | null,
): { status: number; body: Record<string, unknown> } {
  const pattern = typeof body?.pattern === 'string' ? body.pattern.trim() : '';
  if (pattern.length === 0 || pattern.length > PATTERN_MAX) {
    return { status: 422, body: { error: 'pattern is required, at most 200 characters' } };
  }
  const ttlSeconds = Number(body?.ttl_seconds ?? DEFAULT_TTL_SECONDS);
  const remaining = Number(body?.remaining ?? DEFAULT_REMAINING);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 86_400) {
    return { status: 422, body: { error: 'ttl_seconds must be between 30 and 86400' } };
  }
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 10_000) {
    return { status: 422, body: { error: 'remaining must be an integer between 1 and 10000' } };
  }

  const now = ctx.clock();
  const delegation: DelegationRow = {
    id: newId('dlg'),
    source_id: source.id,
    pattern,
    kind: 'shell',
    remaining,
    created_at: now,
    expires_at: now + ttlSeconds * 1000,
    revoked_at: null,
  };
  ctx.store.insertDelegation(delegation);
  return { status: 201, body: view(delegation) };
}

const live = (delegation: DelegationRow, now: number): boolean =>
  delegation.revoked_at === null && delegation.remaining > 0 && delegation.expires_at > now;

export function registerDelegationRoutes(app: Hono, deps: DelegationRouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.post('/v1/delegations', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const outcome = create(ctx, auth.source, body);
    return json(outcome.body, outcome.status);
  });

  app.get('/v1/delegations', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    return json({ delegations: ctx.store.listDelegations(auth.source.id).map(view) });
  });

  app.delete('/v1/delegations/:id', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const delegation = ctx.store.delegationById(c.req.param('id') ?? '');
    if (!delegation || delegation.source_id !== auth.source.id) {
      return json({ error: 'unknown_delegation' }, 404);
    }
    ctx.store.revokeDelegation(delegation.id, ctx.clock());
    return json({ ok: true });
  });

  app.post('/v1/delegations/consume', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const command = typeof body?.command === 'string' ? body.command.trim() : '';
    if (command.length === 0) return json({ error: 'command is required' }, 422);

    const now = ctx.clock();
    for (const delegation of ctx.store.listDelegations(auth.source.id)) {
      if (!live(delegation, now)) continue;
      if (globToRegExp(delegation.pattern).test(command)) {
        ctx.store.consumeDelegation(delegation.id, now);
        return json({ matched: true, delegation_id: delegation.id, remaining: delegation.remaining - 1 });
      }
    }
    return json({ matched: false });
  });
}