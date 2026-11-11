/** `POST /v1/demo/start` — no account, no data kept (BIP-F-31). */
import type { Hono } from 'hono';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';
import { startDemo, type Simulator } from '../simulator.js';

export interface DemoRouteDeps {
  ctx: CentralContext;
  simulator: Simulator;
  limiter: RateLimiter;
}

export function registerDemoRoutes(app: Hono, deps: DemoRouteDeps): void {
  app.post('/v1/demo/start', (c) => {
    if (!deps.ctx.config.demo) return json({ error: 'demo_disabled' }, 404);
    const key = c.req.header('x-forwarded-for') ?? 'local';
    if (!deps.limiter.take(`demo:${key}`)) return json({ error: 'rate_limited' }, 429);
    return json(startDemo(deps.ctx, deps.simulator), 201);
  });
}
