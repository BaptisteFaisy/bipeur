/**
 * The HTTP surface of the Central (A.9). Every inbound payload is validated by
 * a core schema, every caller is authenticated, and every station is rate
 * limited — the routes themselves stay thin.
 */
import { MINUTE } from '@bipeur/core';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import type { CentralContext } from './context.js';
import { registerDashboardUi } from './dashboard/index.js';
import { json } from './http-json.js';
import { RateLimiter } from './rate-limit.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerClosureRoutes } from './routes/closures.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerDelegationRoutes } from './routes/delegations.js';
import { registerDemoRoutes } from './routes/demo.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerHeartbeatRoute } from './routes/heartbeat.js';
import { registerPushConfigRoute } from './push.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerPublicPageRoute } from './routes/public-page.js';
import { registerReplayRoutes } from './routes/replay.js';
import { registerRotaRoutes } from './routes/rotas.js';
import { registerSandboxRoutes } from './routes/sandbox.js';
import { registerTransparencyRoutes } from './routes/transparency.js';
import type { Simulator } from './simulator.js';
import { fallbackPage, servePager } from './static.js';

export interface ApiDeps {
  ctx: CentralContext;
  simulator: Simulator;
}

/**
 * Chrome's Private Network Access: for a tailnet member, this server's name
 * resolves to a 100.64/10 address — a "private" space for the browser — and a
 * public page (GitHub Pages) calling it is blocked unless the preflight,
 * marked `Access-Control-Request-Private-Network: true`, is answered with the
 * header below. It is granted only to origins the CORS list accepts: the CORS
 * middleware runs inside, and a rejected origin gets no allow-origin to key on.
 */
function privateNetworkAccess(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (
      c.req.header('access-control-request-private-network') === 'true' &&
      c.res.headers.get('access-control-allow-origin') !== null
    ) {
      c.res.headers.set('access-control-allow-private-network', 'true');
    }
  };
}

/** The three rate limiters of the API, keyed by the injected clock. */
interface Limiters {
  station: RateLimiter;
  device: RateLimiter;
  pair: RateLimiter;
}

function buildLimiters(ctx: CentralContext): Limiters {
  const perMinute = ctx.config.rateLimitPerMinute;
  return {
    station: new RateLimiter(perMinute, MINUTE, ctx.clock),
    device: new RateLimiter(perMinute, MINUTE, ctx.clock),
    pair: new RateLimiter(20, MINUTE, ctx.clock),
  };
}

interface RouteDeps {
  ctx: CentralContext;
  simulator: Simulator;
  limiters: Limiters;
}

/**
 * Every route of the surface, in one place. Kept apart from `createApi` so the
 * assembly reads as a list, not a wall — the file rule is under 500 lines and
 * under 50 lines per function, and the honest answer is to SPLIT.
 */
function registerRoutes(app: Hono, deps: RouteDeps): void {
  const { ctx, simulator, limiters } = deps;

  registerPageRoutes(app, { ctx, stationLimiter: limiters.station, deviceLimiter: limiters.device });
  registerClosureRoutes(app, { ctx, stationLimiter: limiters.station });
  registerPublicPageRoute(app, { ctx, stationLimiter: limiters.station });
  registerDeviceRoutes(app, { ctx, stationLimiter: limiters.station, deviceLimiter: limiters.device, pairLimiter: limiters.pair });
  registerAdminRoutes(app, { ctx, stationLimiter: limiters.station });
  registerHeartbeatRoute(app, { ctx, stationLimiter: limiters.station });
  // Public on purpose: a VAPID public key is what a browser needs to subscribe.
  registerPushConfigRoute(app, ctx.config.vapid);
  registerDashboardRoutes(app, { ctx, stationLimiter: limiters.station });
  registerDelegationRoutes(app, { ctx, stationLimiter: limiters.station });
  registerRotaRoutes(app, { ctx, stationLimiter: limiters.station });
  registerReplayRoutes(app, { ctx, stationLimiter: limiters.station });
  registerTransparencyRoutes(app, { ctx, stationLimiter: limiters.station });
  registerDemoRoutes(app, { ctx, simulator, limiter: limiters.pair });
  // BIP-F-49: the public sandbox — read-only, side-effect-free, stranger-facing.
  registerSandboxRoutes(app, { ctx, limiter: limiters.pair });

  // BIP-F-30: the dashboard lives on /dashboard only — / keeps serving the pager.
  registerDashboardUi(app);

}

export function createApi(deps: ApiDeps): Hono {
  const { ctx, simulator } = deps;
  const app = new Hono();
  app.use('*', privateNetworkAccess());
  // A static deployment of the pager (GitHub Pages) calls this API from another
  // origin: the browser then asks for a preflight before the first call. The
  // list is explicit — `*` would let any site use a stolen token.
  app.use(
    '*',
    cors({
      origin: (origin) => (ctx.config.corsOrigins.includes(origin) ? origin : null),
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  const limiters = buildLimiters(ctx);
  registerRoutes(app, { ctx, simulator, limiters });

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
