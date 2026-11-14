/**
 * The replay route (BIP-F-46).
 *
 * `GET /v1/pages/:id/replay` answers the question a dispute actually asks:
 * "what did the human see, and what did they answer?". It returns the bytes
 * stored at creation — the line and the detail screens — plus the timestamps
 * and the signed verdict.
 *
 * It is authenticated like every other station route: a replay carries the
 * facts of a decision, and those are not public. The audit event records the
 * consultation with ids only, never the replayed text (BIP-N-03).
 */
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import { ownedPage } from '../pages.js';
import type { RateLimiter } from '../rate-limit.js';
import { auditReplay, replayOf, replayText } from '../replay.js';

export interface ReplayRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

export function registerReplayRoutes(app: Hono, deps: ReplayRouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.get('/v1/pages/:id/replay', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const page = ownedPage(ctx, auth.source, c.req.param('id') ?? '');
    if (!page) return json({ error: 'unknown_page' }, 404);
    const decision = ctx.store.decisionByPage(page.id);
    const replay = replayOf(ctx, page, decision);
    auditReplay(ctx, page);
    const format = c.req.query('format');
    if (format === 'text') {
      return new Response(replayText(replay), {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return json(replay);
  });
}
