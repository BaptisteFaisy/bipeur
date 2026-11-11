/** Pairing and device routes (BIP-F-15), plus the pager resynchronisation list. */
import type { Context, Hono } from 'hono';
import { authenticateDevice, authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { clientKey } from '../client-key.js';
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

  app.post('/v1/devices', (c) => pairDeviceRoute(ctx, pairLimiter, c));

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


/**
 * BIP-F-15 — register a device against a pairing code.
 *
 * Rate limiting is keyed on the **peer address only**. Keying it on a bearer
 * token would let an attacker mint a fresh bucket per request by rotating
 * forged tokens, and at this point in the flow the caller has no legitimate
 * token anyway: the six-character code is the credential, which is exactly why
 * the number of attempts against it has to be capped.
 */
async function pairDeviceRoute(
  ctx: CentralContext,
  pairLimiter: RateLimiter,
  c: Context,
): Promise<Response> {
  const key = clientKey(c, ctx.config.trustProxy === true);
  if (!pairLimiter.take(key)) return json({ error: 'rate_limited' }, 429);
  const outcome = pairDevice(ctx, await c.req.json().catch(() => null));
  return json(outcome.body, outcome.status);
}
