/**
 * The transparency routes (BIP-F-45).
 *
 * Read-only for the root and the proof: an auditor must be able to check us
 * without holding a station token — a public claim needs a public check. The
 * checkpoint is write-only and stays authenticated, because publishing a root
 * is an operator act.
 */
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';
import { checkpoint, transparencyProof, transparencyRoot } from '../transparency.js';

export interface TransparencyRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

export function registerTransparencyRoutes(app: Hono, deps: TransparencyRouteDeps): void {
  const { ctx } = deps;

  app.get('/v1/transparency/root', (c) => {
    const since = c.req.query('since');
    if (since !== undefined && !/^\d+$/.test(since)) return json({ error: 'invalid_since' }, 400);
    return json(transparencyRoot(ctx.store));
  });

  app.get('/v1/transparency/proof', (c) => {
    const raw = c.req.query('event_id');
    if (!raw || !/^\d+$/.test(raw)) return json({ error: 'event_id_required' }, 400);
    const proof = transparencyProof(ctx, Number(raw));
    if (!proof) return json({ error: 'not_found', event_id: Number(raw) }, 404);
    return json(proof);
  });

  app.post('/v1/transparency/checkpoint', async (c) => {
    const auth = authenticateStation(ctx, deps.stationLimiter, c);
    if (!auth.ok) return auth.response;
    return json(checkpoint(ctx, ctx.config.anchorPath), 201);
  });
}
