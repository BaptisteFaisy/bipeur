/**
 * The closure routes (BIP-F-41).
 *
 * `POST /v1/closures` is the agent's half of the loop: it proves what it did
 * with a decision. `GET /v1/pages/:id/closure` is the human's half: the receipt
 * of the page they approved, on demand. Both use the station authentication —
 * a closure is a claim by a station, and only the station that paged it may
 * close it.
 */
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import { recordClosure } from '../closure.js';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';
import { ownedPage } from '../pages.js';

export interface ClosureRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

export function registerClosureRoutes(app: Hono, deps: ClosureRouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.post('/v1/closures', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const body: unknown = await c.req.json().catch(() => null);
    const outcome = recordClosure(ctx, auth.source, body);
    return json(outcome.body, outcome.status);
  });

  app.get('/v1/pages/:id/closure', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const page = ownedPage(ctx, auth.source, c.req.param('id') ?? '');
    if (!page) return json({ error: 'unknown_page' }, 404);
    const closure = ctx.store.closureByPage(page.id);
    if (!closure) return json({ error: 'not_closed', page_id: page.id }, 404);
    return json({
      page_id: closure.page_id,
      closure_page_id: closure.closure_page_id,
      evidence: closure.evidence,
      summary: closure.summary,
      origin_fingerprint: closure.origin_fingerprint,
      closed_at: closure.created_at,
    });
  });
}
