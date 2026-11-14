/** Dashboard routes: health, audit, metrics, digest. Read-only by design. */
import type { AuditEventType } from '@bipeur/core';
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import { attentionReport } from '../attention.js';
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

  // BIP-F-44: what the attention actually costs, per station and per hour.
  // A dashboard is not something you scrape, so the numbers are on the wire.
  app.get('/v1/metrics/attention', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const raw = c.req.query('hours');
    const hours = raw === undefined ? 24 : Number.parseInt(raw, 10);
    const window = Number.isFinite(hours) ? Math.min(168, Math.max(1, hours)) : 24;
    return json(attentionReport(ctx.store, ctx.clock(), window));
  });

  app.get('/v1/notices', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const limit = Number.parseInt(c.req.query('limit') ?? '50', 10);
    return json({ notices: ctx.store.listNotices(Number.isFinite(limit) ? limit : 50) });
  });
}
