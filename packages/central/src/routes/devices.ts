/** Pairing and device routes (BIP-F-15), plus the pager resynchronisation list. */
import type { Hono } from 'hono';
import { authenticateDevice, authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { bearer } from '../http-auth.js';
import { json } from '../http-json.js';
import { createPairing, pairDevice, revokeDevice } from '../pairing.js';
import type { RateLimiter } from '../rate-limit.js';
import { pageView } from '../view.js';

export interface DeviceRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
  deviceLimiter: RateLimiter;
  pairLimiter: RateLimiter;
}

export function registerDeviceRoutes(app: Hono, deps: DeviceRouteDeps): void {
  const { ctx, stationLimiter, deviceLimiter, pairLimiter } = deps;

  app.post('/v1/pairings', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    return json(createPairing(ctx, auth.source.visitor_id), 201);
  });

  app.post('/v1/devices', async (c) => {
    // The pairing code is the credential here; the caller has no token yet.
    const key = bearer(c.req.header('authorization')) ?? c.req.header('x-forwarded-for') ?? 'local';
    if (!pairLimiter.take(key)) return json({ error: 'rate_limited' }, 429);
    const outcome = pairDevice(ctx, await c.req.json().catch(() => null));
    return json(outcome.body, outcome.status);
  });

  app.get('/v1/devices', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    return json({
      devices: ctx.store.listDevices().map((device) => ({
        device_id: device.id,
        name: device.name,
        paired_at: device.paired_at,
        revoked_at: device.revoked_at,
      })),
    });
  });

  app.delete('/v1/devices/:id', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const outcome = revokeDevice(ctx, c.req.param('id'));
    return json(outcome.body, outcome.status);
  });

  app.get('/v1/devices/:id/pages', (c) => {
    const auth = authenticateDevice(ctx, deviceLimiter, c);
    if (!auth.ok) return auth.response;
    if (auth.device.id !== c.req.param('id')) return json({ error: 'forbidden' }, 403);
    const requested = c.req.query('state') ?? 'pending';
    const filter = requested === 'pending' ? { state: 'pending' as const } : { state: requested as never };
    const pages = ctx.store
      .listPages({ ...filter, visitorId: auth.device.visitor_id ?? undefined, limit: 50 })
      .map(pageView);
    return json({ pages });
  });
}
