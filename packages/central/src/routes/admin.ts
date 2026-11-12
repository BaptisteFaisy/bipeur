/** Dashboard routes: health, audit, metrics, digest. Read-only by design. */
import type { AuditEventType } from '@bipeur/core';
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import { CENTRAL_VERSION } from '../config.js';
import type { CentralContext } from '../context.js';
import { isChatty, isStuck, reputationOf } from '../governance.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';

export interface AdminRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

export function registerAdminRoutes(app: Hono, deps: AdminRouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.get('/healthz', (c) => c.json({ ok: true, version: CENTRAL_VERSION }));

  // An agent proves it is alive; the Central answers with how it is seen:
  // reputation, chattiness, and whether it has been silent long enough to be
  // presumed stuck. Any station request already refreshes `last_seen_at`, so
  // this is a semantic, self-describing beat, not a new timer.
  app.post('/v1/heartbeat', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const now = ctx.clock();
    const activity = ctx.store.sourceActivity(auth.source.id, now);
    return json({
      ok: true,
      alias: auth.source.alias,
      reputation: reputationOf(activity),
      chatty: isChatty(activity),
      stuck: isStuck(auth.source.last_seen_at, now),
    });
  });

  app.get('/v1/audit', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const limit = Number.parseInt(c.req.query('limit') ?? '100', 10);
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10);
    const type = (c.req.query('type') ?? null) as AuditEventType | null;
    return json({
      events: ctx.audit.list({
        limit: Number.isFinite(limit) ? limit : 100,
        type,
        sourceId: c.req.query('source') ?? null,
        offset: Number.isFinite(offset) ? offset : 0,
      }),
    });
  });

  app.get('/v1/metrics', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    // `in_use` is the real operator's own scope: demo visitors each have an
    // isolated budget (BIP-F-31), so summing them would exceed
    // `budget_per_hour` and misdescribe the human's budget (BIP-F-09).
    return json({ ...ctx.store.metrics(), budget_per_hour: ctx.gate.perHour, in_use: ctx.gate.inUse(ctx.clock()) });
  });

  app.get('/v1/notices', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const limit = Number.parseInt(c.req.query('limit') ?? '50', 10);
    return json({ notices: ctx.store.listNotices(Number.isFinite(limit) ? limit : 50) });
  });
}
