/**
 * The HTTP surface of the Central (A.9). Every inbound payload is validated by
 * a core schema, every caller is authenticated, and every station is rate
 * limited — the routes themselves stay thin.
 */
import { MINUTE } from '@bipeur/core';
import { Hono } from 'hono';
import type { CentralContext } from './context.js';
import { json } from './http-json.js';
import { RateLimiter } from './rate-limit.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerDemoRoutes } from './routes/demo.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerPageRoutes } from './routes/pages.js';
import type { Simulator } from './simulator.js';
import { fallbackPage, servePager } from './static.js';

export interface ApiDeps {
  ctx: CentralContext;
  simulator: Simulator;
}

export function createApi(deps: ApiDeps): Hono {
  const { ctx, simulator } = deps;
  const app = new Hono();
  const perMinute = ctx.config.rateLimitPerMinute;
  const stationLimiter = new RateLimiter(perMinute, MINUTE, ctx.clock);
  const deviceLimiter = new RateLimiter(perMinute, MINUTE, ctx.clock);
  const pairLimiter = new RateLimiter(20, MINUTE, ctx.clock);

  registerPageRoutes(app, { ctx, stationLimiter, deviceLimiter });
  registerDeviceRoutes(app, { ctx, stationLimiter, deviceLimiter, pairLimiter });
  registerAdminRoutes(app, { ctx, stationLimiter });
  registerDemoRoutes(app, { ctx, simulator, limiter: pairLimiter });

  app.get('/', () => servePager('/') ?? fallbackPage());
  // Anything under /v1 is API territory: never answered by the static fallback.
  app.get('/*', (c) => {
    if (c.req.path.startsWith('/v1/')) return json({ error: 'not_found', path: c.req.path }, 404);
    return servePager(c.req.path) ?? fallbackPage();
  });
  app.notFound((c) => json({ error: 'not_found', path: c.req.path }, 404));
  app.onError((error) => {
    console.error(`[central] ${error.name}: ${error.message}`);
    return json({ error: 'internal_error' }, 500);
  });
  return app;
}
