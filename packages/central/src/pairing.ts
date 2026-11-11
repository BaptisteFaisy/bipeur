/**
 * Pairing (BIP-F-15): a six-character code, single use, five minutes. The pager
 * registers its ECDSA P-256 public key and receives a device token; only the
 * hash of that token is stored (BIP-N-03).
 */
import { randomInt } from 'node:crypto';
import { MINUTE, pairingRequestSchema } from '@bipeur/core';
import { hashToken, newId, newToken } from '@bipeur/core/node';
import { z } from 'zod';
import type { CentralContext } from './context.js';
import type { DeviceRow, PairingRow } from './store/types.js';

export const PAIRING_TTL_MS = 5 * MINUTE;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const pairDeviceSchema = pairingRequestSchema.extend({
  pairing_id: z.string().min(1).max(64),
  code: z.string().regex(/^[A-Z0-9]{6}$/),
});

export interface PairingWire {
  pairing_id: string;
  code: string;
  expires_at: number;
  /** Deep link a QR code can carry; the pager reads the code from it. */
  qr_url: string;
  pair_url: string;
}

export function createPairing(ctx: CentralContext, visitorId: string | null): PairingWire {
  const now = ctx.clock();
  const code = randomCode();
  const pairing: PairingRow = {
    id: newId('pair'),
    code,
    created_at: now,
    expires_at: now + PAIRING_TTL_MS,
    consumed_at: null,
    visitor_id: visitorId,
  };
  ctx.store.insertPairing(pairing);
  return {
    pairing_id: pairing.id,
    code,
    expires_at: pairing.expires_at,
    qr_url: `bipeur://pair/${pairing.id}/${code}`,
    pair_url: `/?pair=${pairing.id}&code=${code}`,
  };
}

export function pairDevice(
  ctx: CentralContext,
  rawBody: unknown,
): { status: number; body: Record<string, unknown> } {
  const parsed = pairDeviceSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { status: 422, body: { error: 'invalid_request', issues: parsed.error.issues.map((i) => i.path.join('.')) } };
  }
  const request = parsed.data;
  const pairing = ctx.store.pairingById(request.pairing_id);
  if (!pairing) return { status: 404, body: { error: 'unknown_pairing' } };
  const now = ctx.clock();
  if (pairing.consumed_at !== null) return { status: 409, body: { error: 'pairing_used' } };
  if (now >= pairing.expires_at) return { status: 410, body: { error: 'pairing_expired' } };
  if (pairing.code !== request.code) return { status: 422, body: { error: 'wrong_code' } };
  if (!ctx.store.consumePairing(pairing.id, now)) return { status: 409, body: { error: 'pairing_used' } };

  const token = newToken();
  const device: DeviceRow = {
    id: newId('dev'),
    name: request.device_name,
    token_hash: hashToken(token),
    public_key_jwk: request.public_key_jwk as JsonWebKey,
    push_subscription: request.push_subscription ?? null,
    paired_at: now,
    revoked_at: null,
    visitor_id: pairing.visitor_id,
  };
  ctx.store.insertDevice(device);
  ctx.audit.append({ type: 'device.paired', device_id: device.id, data: { name: device.name } });
  return { status: 201, body: { device_id: device.id, device_token: token } };
}

/** BIP-F-15 revocation: the token stops working on the next request. */
export function revokeDevice(ctx: CentralContext, id: string): { status: number; body: Record<string, unknown> } {
  const device = ctx.store.deviceById(id);
  if (!device) return { status: 404, body: { error: 'unknown_device' } };
  const revoked = ctx.store.revokeDevice(id, ctx.clock());
  if (!revoked) return { status: 409, body: { error: 'already_revoked' } };
  ctx.audit.append({ type: 'device.revoked', device_id: id, data: { name: device.name } });
  return { status: 200, body: { revoked: true, device_id: id } };
}

function randomCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
