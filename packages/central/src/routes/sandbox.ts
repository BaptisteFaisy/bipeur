/**
 * The public sandbox routes (BIP-F-49).
 *
 * Deliberately unauthenticated: a claim anyone can read is a claim, and the
 * whole point of the sandbox is that a visitor without a token can check what
 * the rules do to `rm -rf /`. Deliberately side-effect-free: it never touches
 * the store, the audit log, the budget or the delivery gate, so no attempt can
 * create a page, ring a pager or block an agent.
 *
 * The cost is bounded CPU — a regex pass over at most 500 characters — and the
 * pair limiter (20/min per client) caps it. An operator who would rather not
 * expose this at all blocks `/v1/sandbox/*` at the reverse proxy: the site
 * keeps working, because the ten published lines are baked into the static
 * page at build time (see `docs/SANDBOX.md`).
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { clientKey } from '../client-key.js';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';
import {
  SANDBOX_COMMAND_MAX,
  SANDBOX_STATION,
  sandboxBoard,
  simulateProbe,
} from '../sandbox.js';

const probeSchema = z.object({
  command: z.string().min(1).max(SANDBOX_COMMAND_MAX),
  tool_name: z.string().min(1).max(64).optional(),
  path: z.string().max(2048).optional(),
});

export interface SandboxRouteDeps {
  ctx: CentralContext;
  /** The strictest limiter of the API: this endpoint is open to strangers. */
  limiter: RateLimiter;
}

export function registerSandboxRoutes(app: Hono, deps: SandboxRouteDeps): void {
  const { ctx } = deps;

  app.get('/v1/sandbox/board', (c) => {
    if (!sandboxAllowed(c, deps)) return json({ error: 'rate_limited' }, 429);
    return json({
      station: SANDBOX_STATION,
      rules_version: ctx.rules.current().version,
      rules_source: ctx.rules.source(),
      rows: sandboxBoard(ctx.rules.current()),
    });
  });

  app.post('/v1/sandbox/probe', async (c) => {
    if (!sandboxAllowed(c, deps)) return json({ error: 'rate_limited' }, 429);
    const parsed = probeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'invalid_request' }, 422);
    return json(simulateProbe(parsed.data, ctx.rules.current()));
  });
}

/** Public, so the only gate is the rate limiter, keyed by the client address. */
function sandboxAllowed(c: Context, deps: SandboxRouteDeps): boolean {
  const key = clientKey(c, deps.ctx.config.trustProxy === true);
  return deps.limiter.take(`sandbox:${key}`);
}
