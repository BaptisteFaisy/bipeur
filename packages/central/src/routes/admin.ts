/** Dashboard routes: health, audit, metrics, digest. Read-only by design. */
import type { AuditEventType } from '@bipeur/core';
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import { CENTRAL_VERSION } from '../config.js';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';

export interface AdminRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

export function registerAdminRoutes(app: Hono, deps: AdminRouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.get('/healthz', (c) => c.json({ ok: true, version: CENTRAL_VERSION }));

  app.get('/v1/audit', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const limit = Number.parseInt(c.req.query('limit') ?? '100', 10);
    const type = (c.req.query('type') ?? null) as AuditEventType | null;
    return json({ events: ctx.audit.list({ limit: Number.isFinite(limit) ? limit : 100, type }) });
  });

  app.get('/v1/metrics', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    return json({ ...ctx.store.metrics(), budget_per_hour: ctx.gate.perHour, in_use: ctx.gate.inUse(ctx.clock()) });
  });

  app.get('/v1/notices', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const limit = Number.parseInt(c.req.query('limit') ?? '50', 10);
    return json({ notices: ctx.store.listNotices(Number.isFinite(limit) ? limit : 50) });
  });
}
