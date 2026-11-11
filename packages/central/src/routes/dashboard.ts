/**
 * Data routes of the Central dashboard (BIP-F-30): the station list with its
 * page counts, station revocation, and the queue with the hold reason computed
 * server side. They reuse the station authentication of the admin routes —
 * no second auth system — and never expose a payload (BIP-N-03).
 */
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';
import type { PageRow, PageStateFilter } from '../store/types.js';
import { pageView } from '../view.js';

export interface DashboardRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

export function registerDashboardRoutes(app: Hono, deps: DashboardRouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.get('/v1/sources', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const counts = ctx.store.pageCountBySource();
    return json({
      sources: ctx.store.listSources().map((source) => ({
        source_id: source.id,
        alias: source.alias,
        kind: source.kind,
        last_seen_at: source.last_seen_at,
        revoked_at: source.revoked_at,
        pages_created: counts[source.id] ?? 0,
      })),
    });
  });

  app.delete('/v1/sources/:id', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const revoked = ctx.store.revokeSource(c.req.param('id') ?? '', ctx.clock());
    if (!revoked) return json({ error: 'unknown_or_already_revoked' }, 404);
    return json({ ok: true });
  });

  app.get('/v1/pages', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const state = (c.req.query('state') ?? 'pending') as PageStateFilter;
    const pages = ctx.store.listPages({ state, limit: 50 });
    const now = ctx.clock();
    return json({ pages: pages.map((page) => queueEntry(ctx, page, now)) });
  });
}

/** One queue entry: composed facts plus why it is held — never a payload. */
export function queueEntry(ctx: CentralContext, page: PageRow, now: number): Record<string, unknown> {
  const verdict = page.state === 'queued' ? ctx.gate.admission(page, now) : { admit: true };
  return {
    ...pageView(page),
    hold: verdict.admit ? null : { reason: verdict.reason ?? 'budget' },
  };
}
