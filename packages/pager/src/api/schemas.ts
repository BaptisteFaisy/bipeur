/**
 * Wire schemas of the pager side (A.9). Core owns the shared shapes; these add
 * the two payloads the pager reads and the ack it gets back. Zod validates
 * every inbound payload, exactly like the Central does.
 */
import {
  optionSchema,
  riskSchema,
  type PagePayload,
  type PageRecord,
  type PageState,
} from '@bipeur/core';
import { z } from 'zod';

const nullableNumber = z.number().nullable().default(null);

/**
 * A page as the Central sends it (A.9): `page_id`, `fingerprint`, `station`.
 * The older pager-side names (`id`, `payload_sha256`, `source_alias`) are still
 * accepted, so a pager can talk to a Central of either vintage — but the
 * Central's names win when both are present.
 */
export const pageRecordSchema = z
  .object({
    page_id: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    source_id: z.string().optional(),
    station: z.string().optional(),
    source_alias: z.string().optional(),
    kind: z.enum(['tool', 'question']).default('tool'),
    code: z.number().int().default(100),
    risk: riskSchema.default('amber'),
    line: z.string().min(1),
    detail: z.array(z.string()).default([]),
    payload: z.record(z.string(), z.unknown()).default({}),
    fingerprint: z.string().min(1).optional(),
    payload_sha256: z.string().min(1).optional(),
    options: z.array(optionSchema).default([]),
    state: z.string().default('delivered'),
    created_at: z.number().default(0),
    delivered_at: nullableNumber,
    read_at: nullableNumber,
    expires_at: z.number().default(0),
    dedupe_key: z.string().default(''),
    callback_url: z.string().nullable().default(null),
    /** BIP-F-43: a canary page demands the deliberate gesture. */
    canary: z.boolean().default(false),
  })
  .refine((page) => Boolean(page.page_id ?? page.id), {
    message: 'the page carries neither page_id nor id',
  })
  .refine((page) => Boolean(page.fingerprint ?? page.payload_sha256), {
    message: 'the page carries neither fingerprint nor payload_sha256',
  });

export const pageListSchema = z.union([
  z.array(pageRecordSchema),
  z.object({ pages: z.array(pageRecordSchema) }),
]);

export const decisionAckSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'duplicate']).default('accepted'),
  reason: z.string().nullable().default(null),
});

/**
 * `POST /v1/pairings` — the Central creates the pairing and hands back the code
 * a QR carries (`pair_url` is what the pager is opened from). BIP-F-15.
 */
export const pairingResponseSchema = z.object({
  pairing_id: z.string().min(1),
  code: z.string().regex(/^[A-Z0-9]{6}$/),
  expires_at: z.number().int().optional(),
  qr_url: z.string().optional(),
  pair_url: z.string().optional(),
});

/**
 * `POST /v1/devices` — the pager registers its public key against the code and
 * receives the device token that authenticates every later call, including the
 * WebSocket (`?token=…`, since a browser socket cannot carry a header).
 * Refusing an answer without a token is deliberate: pairing silently "succeeds"
 * otherwise and the pager stays offline for ever.
 */
export const deviceResponseSchema = z.object({
  device_id: z.string().min(1),
  device_token: z.string().min(1),
  name: z.string().default('Beeper'),
  paired_at: z.number().default(0),
});

/**
 * `POST /v1/demo/start` — an isolated visitor space (BIP-F-31). It hands over a
 * station token, a device token and a ready-made key pair, so a judge can page
 * and decide without pairing anything. Wiped after 24 h.
 */
export const demoResponseSchema = z.object({
  visitor_id: z.string().min(1),
  device_id: z.string().min(1),
  device_token: z.string().min(1),
  station_token: z.string().min(1),
  device_private_key_jwk: z.record(z.string(), z.unknown()),
  pager_url: z.string().optional(),
  expires_at: z.number().int().optional(),
});

export type DemoSpace = z.infer<typeof demoResponseSchema>;

export type PageRecordWire = z.infer<typeof pageRecordSchema>;

/**
 * Wire shape → domain record. The Central's names are mapped onto the shared
 * `PageRecord`; the payload itself never travels to the pager (BIP-N-03: the
 * wire carries the fingerprint, not the command).
 */
export function toPageRecord(wire: PageRecordWire): PageRecord {
  return {
    id: wire.page_id ?? wire.id ?? '',
    source_id: wire.source_id ?? 'unknown',
    source_alias: wire.station ?? wire.source_alias ?? 'agent',
    kind: wire.kind,
    code: wire.code,
    risk: wire.risk,
    line: wire.line,
    detail: wire.detail,
    // The wire keeps the payload wide (the Central never sends the command),
    // and the state is a plain string there; the domain types are narrower.
    payload: wire.payload as unknown as PagePayload,
    payload_sha256: wire.fingerprint ?? wire.payload_sha256 ?? '',
    options: wire.options,
    state: wire.state as PageState,
    created_at: wire.created_at,
    delivered_at: wire.delivered_at,
    read_at: wire.read_at,
    expires_at: wire.expires_at,
    dedupe_key: wire.dedupe_key,
    callback_url: wire.callback_url,
    canary: wire.canary,
  };
}
