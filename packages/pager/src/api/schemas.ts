/**
 * Wire schemas of the pager side (A.9). Core owns the shared shapes; these add
 * the two payloads the pager reads and the ack it gets back. Zod validates
 * every inbound payload, exactly like the Central does.
 */
import { optionSchema, riskSchema, type PageRecord } from '@bipeur/core';
import { z } from 'zod';

const nullableNumber = z.number().nullable().default(null);

/** A `PageRecord` as the Central stores it, tolerant of extra fields. */
export const pageRecordSchema = z.object({
  id: z.string().min(1),
  source_id: z.string().default('unknown'),
  source_alias: z.string().default('agent'),
  kind: z.enum(['tool', 'question']).default('tool'),
  code: z.number().int().default(100),
  risk: riskSchema.default('amber'),
  line: z.string().min(1),
  detail: z.array(z.string()).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
  payload_sha256: z.string().min(1),
  options: z.array(optionSchema).default([]),
  state: z.string().default('delivered'),
  created_at: z.number().default(0),
  delivered_at: nullableNumber,
  read_at: nullableNumber,
  expires_at: z.number().default(0),
  dedupe_key: z.string().default(''),
  callback_url: z.string().nullable().default(null),
});

export const pageListSchema = z.union([
  z.array(pageRecordSchema),
  z.object({ pages: z.array(pageRecordSchema) }),
]);

export const decisionAckSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'duplicate']).default('accepted'),
  reason: z.string().nullable().default(null),
});

export const pairingResponseSchema = z.object({
  pairing_id: z.string().min(1),
  device_id: z.string().min(1),
});

export const deviceResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Beeper'),
  paired_at: z.number().default(0),
});

export type PageRecordWire = z.infer<typeof pageRecordSchema>;

/**
 * Wire shape → domain record. Every field is present after parsing; only
 * `payload` and `state` stay wide on the wire, hence the single cast.
 */
export function toPageRecord(wire: PageRecordWire): PageRecord {
  return wire as unknown as PageRecord;
}
