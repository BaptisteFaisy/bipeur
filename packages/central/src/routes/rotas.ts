/**
 * The rota routes (BIP-F-37): the operator builds an on-call rota — an ordered
 * list of humans and the pager that rings for each — and sends a page to it by
 * passing `rota: <label>` to `POST /v1/pages` or `POST /page`.
 *
 * The same station token that pages also administers the rota. There is no
 * separate admin role: a token is an operator credential (the attention budget
 * is shared, by design).
 */
import { newId } from '@bipeur/core/node';
import type { Hono } from 'hono';
import { authenticateStation } from '../api-auth.js';
import type { CentralContext } from '../context.js';
import { json } from '../http-json.js';
import type { RateLimiter } from '../rate-limit.js';
import { ESCALATE_MAX_MS, ESCALATE_MIN_MS, rotaView } from '../rota.js';
import type { OncallShiftRow, RotaRow } from '../store/types.js';

export interface RotaRouteDeps {
  ctx: CentralContext;
  stationLimiter: RateLimiter;
}

const ROTATION_MIN_MS = 60_000;

export function registerRotaRoutes(app: Hono, deps: RotaRouteDeps): void {
  const { ctx, stationLimiter } = deps;

  app.post('/v1/rotas', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const outcome = createRota(ctx, body);
    return json(outcome.body, outcome.status);
  });

  app.get('/v1/rotas', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    return json({ rotas: listRotas(ctx) });
  });

  app.get('/v1/rotas/:id', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const rota = ctx.store.rotaById(c.req.param('id') ?? '');
    if (!rota) return json({ error: 'unknown_rota' }, 404);
    return json(rotaView(rota, ctx.store.listShifts(rota.id), ctx.clock()));
  });

  app.delete('/v1/rotas/:id', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const id = c.req.param('id') ?? '';
    if (!ctx.store.deleteRota(id)) return json({ error: 'unknown_rota' }, 404);
    ctx.audit.append({ type: 'rota.changed', data: { action: 'deleted', rota_id: id } });
    return json({ ok: true });
  });

  app.post('/v1/rotas/:id/shifts', async (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const rota = ctx.store.rotaById(c.req.param('id') ?? '');
    if (!rota) return json({ error: 'unknown_rota' }, 404);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const outcome = addShift(ctx, rota, body);
    return json(outcome.body, outcome.status);
  });

  app.delete('/v1/rotas/:id/shifts/:shift_id', (c) => {
    const auth = authenticateStation(ctx, stationLimiter, c);
    if (!auth.ok) return auth.response;
    const shiftId = c.req.param('shift_id') ?? '';
    if (!ctx.store.deleteShift(shiftId)) return json({ error: 'unknown_shift' }, 404);
    ctx.audit.append({ type: 'rota.changed', data: { action: 'shift_removed', shift_id: shiftId } });
    return json({ ok: true });
  });
}

function listRotas(ctx: CentralContext): unknown[] {
  const now = ctx.clock();
  return ctx.store.listRotas().map((rota) => rotaView(rota, ctx.store.listShifts(rota.id), now));
}

function createRota(
  ctx: CentralContext,
  body: Record<string, unknown> | null,
): { status: number; body: unknown } {
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  if (label.length === 0 || label.length > 64) {
    return { status: 422, body: { error: 'label is required, at most 64 characters' } };
  }
  const escalateSeconds = Number(body?.escalate_after_seconds ?? 300);
  if (!Number.isFinite(escalateSeconds) || escalateSeconds * 1000 < ESCALATE_MIN_MS || escalateSeconds * 1000 > ESCALATE_MAX_MS) {
    return { status: 422, body: { error: 'escalate_after_seconds must be between 30 and 604800' } };
  }
  const rotationMs = readRotation(body?.rotation_seconds);
  if (rotationMs === 'invalid') return { status: 422, body: { error: 'rotation_seconds must be at least 60' } };

  const existing = ctx.store.rotaByLabel(label);
  if (existing) return { status: 409, body: { error: 'label_taken' } };

  const rota: RotaRow = {
    id: newId('rt'),
    label,
    escalate_after_ms: escalateSeconds * 1000,
    rotation_ms: rotationMs,
    created_at: ctx.clock(),
  };
  ctx.store.insertRota(rota);
  ctx.audit.append({ type: 'rota.changed', data: { action: 'created', rota_id: rota.id, label } });
  return { status: 201, body: rotaView(rota, [], ctx.clock()) };
}

/** null when absent, a number of milliseconds, or a sentinel for a bad value. */
function readRotation(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds * 1000 < ROTATION_MIN_MS) return 'invalid';
  return seconds * 1000;
}

function addShift(
  ctx: CentralContext,
  rota: RotaRow,
  body: Record<string, unknown> | null,
): { status: number; body: unknown } {
  const now = ctx.clock();
  const alias = typeof body?.alias === 'string' ? body.alias.trim() : '';
  if (alias.length === 0 || alias.length > 64) {
    return { status: 422, body: { error: 'alias is required, at most 64 characters' } };
  }
  const target = typeof body?.target === 'string' ? body.target : '';
  const device = ctx.store.deviceById(target);
  if (!device || device.revoked_at !== null) {
    return { status: 422, body: { error: 'target must be an existing, live device' } };
  }
  const existing = ctx.store.listShifts(rota.id);
  const priority = readPriority(body?.priority, existing);
  const startsAt = readTime(body?.starts_at);
  const endsAt = readTime(body?.ends_at);
  if (startsAt === 'invalid' || endsAt === 'invalid') {
    return { status: 422, body: { error: 'starts_at / ends_at must be positive epoch milliseconds' } };
  }

  const shift: OncallShiftRow = {
    id: newId('sh'),
    rota_id: rota.id,
    alias,
    target,
    priority,
    starts_at: startsAt,
    ends_at: endsAt,
    created_at: now,
  };
  ctx.store.insertShift(shift);
  ctx.audit.append({ type: 'rota.changed', data: { action: 'shift_added', rota_id: rota.id, shift_id: shift.id, alias } });
  return { status: 201, body: shiftView(shift) };
}

/** Priority defaults to the end of the list (max priority + 1). */
function readPriority(raw: unknown, existing: OncallShiftRow[]): number {
  if (raw !== undefined && raw !== null && Number.isInteger(Number(raw)) && Number(raw) >= 0) {
    return Number(raw);
  }
  const max = existing.reduce((acc, shift) => Math.max(acc, shift.priority), -1);
  return max + 1;
}

function readTime(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 'invalid';
  return value;
}

function shiftView(shift: OncallShiftRow): Record<string, unknown> {
  return {
    shift_id: shift.id,
    rota_id: shift.rota_id,
    alias: shift.alias,
    target: shift.target,
    priority: shift.priority,
    starts_at: shift.starts_at,
    ends_at: shift.ends_at,
  };
}