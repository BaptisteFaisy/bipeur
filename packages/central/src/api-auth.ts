/**
 * Authentication of the two callers of the API: a station (source) and a pager
 * (device). Tokens are compared through their hash, never in clear text, and
 * every token is rate limited (BIP-N-03).
 */
import { hashToken } from '@bipeur/core/node';
import type { Context } from 'hono';
import type { CentralContext } from './context.js';
import { bearer } from './http-auth.js';
import { json } from './http-json.js';
import type { RateLimiter } from './rate-limit.js';
import type { DeviceRow, SourceRow } from './store/types.js';

export type StationAuth = { ok: true; source: SourceRow } | { ok: false; response: Response };
export type DeviceAuth = { ok: true; device: DeviceRow } | { ok: false; response: Response };

export function authenticateStation(ctx: CentralContext, limiter: RateLimiter, c: Context): StationAuth {
  const token = bearer(c.req.header('authorization'));
  if (!token) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  const tokenHash = hashToken(token);
  if (!limiter.take(tokenHash)) return { ok: false, response: json({ error: 'rate_limited' }, 429) };
  const source = ctx.store.sourceByTokenHash(tokenHash);
  if (!source) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  ctx.store.touchSource(source.id, ctx.clock());
  return { ok: true, source };
}

export function authenticateDevice(ctx: CentralContext, limiter: RateLimiter, c: Context): DeviceAuth {
  const token = bearer(c.req.header('authorization'));
  if (!token) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  const tokenHash = hashToken(token);
  if (!limiter.take(tokenHash)) return { ok: false, response: json({ error: 'rate_limited' }, 429) };
  const device = ctx.store.deviceByTokenHash(tokenHash);
  if (!device) return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  if (device.revoked_at !== null) return { ok: false, response: json({ error: 'device_revoked' }, 403) };
  return { ok: true, device };
}
