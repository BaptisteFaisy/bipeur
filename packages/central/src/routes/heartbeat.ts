/**
 * `POST /v1/heartbeat` — an agent proves it is alive; the Central answers with
 * how it is seen: reputation, chattiness, and whether it has been silent long
 * enough to be presumed stuck.
 *
 * Any station request already refreshes `last_seen_at` (auth touches it), so
 * this is a semantic, self-describing beat — not a second timer.
 */
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { isChatty, isStuck, reputationOf } from '../governance.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';

export interface HeartbeatRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

export function registerHeartbeatRoute(app: Hono, deps: HeartbeatRouteDeps): void {
  const { ctx, stationLimiter } = deps;

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
}