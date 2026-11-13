/**
 * `POST /page` — the simplest contract Beeper has: one line, one tap.
 *
 * Everything the product does is reachable through `/v1/pages`, but the point
 * of this endpoint is that a script or an agent needs nothing but:
 *
 *   curl -X POST https://…/page -H "Authorization: Bearer <token>" \
 *     -d '{"message":"night build finished","priority":"normal","ttl_seconds":900}'
 *
 * It composes a line the 1995 way — a code, a verb, a subject — and asks the
 * human. The OpenAPI spec next to this file (`openapi.yaml`) is generated
 * from the same surface for every other language.
 */
import type { Hono } from 'hono';
import { LINE_MAX } from '@bipeur/core';
import { authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { createPage } from '../pages.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';
import { pageView } from '../view.js';

export interface PublicPageRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

const PRECEDENCE: Readonly<Record<string, { code: number; risk?: 'red' }>> = {
  low: { code: 510 }, // green — informative, one tap
  normal: { code: 310 }, // amber — a real question
  critical: { code: 110, risk: 'red' }, // red — press-and-hold
};

export function registerPublicPageRoute(app: Hono, deps: PublicPageRouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.post('/page', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length === 0 || message.length > LINE_MAX) {
      return json({ error: 'message is required, at most 80 characters' }, 422);
    }
    const priority = typeof body.priority === 'string' ? body.priority : 'normal';
    const level = PRECEDENCE[priority] ?? PRECEDENCE.normal!;
    const ttlSeconds = Number(body.ttl_seconds ?? 900);
    const rota = typeof body.rota === 'string' ? body.rota : undefined;

    const outcome = createPage(ctx, auth.source, {
      kind: 'question',
      question: message,
      code: level.code,
      ...(level.risk ? { risk: level.risk } : {}),
      ttl_seconds: Number.isFinite(ttlSeconds) ? ttlSeconds : 900,
      ...(rota ? { rota } : {}),
    });
    if (!outcome.ok) return json(outcome.body, outcome.status);
    return json(pageView(outcome.page), outcome.created ? 201 : 200);
  });
}