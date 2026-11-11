import { z } from 'zod';
import { LINE_MAX } from './ascii.js';
import { VERBS, type Risk } from './types.js';

/** Wire schemas of the Central API (A.9). Every inbound payload goes through them. */

export const riskSchema = z.enum(['green', 'amber', 'red']);

export const optionSchema = z.object({
  code: z.string().regex(/^[A-D]$/),
  label: z.string().min(1).max(20),
});

const urlish = z.string().max(2048).regex(/^(https?|ws{1,2}):\/\//, 'must be an http(s)/ws(s) URL');

const commonPageFields = {
  /** Station alias, 6 characters or less once normalised. */
  station: z.string().min(1).max(32).optional(),
  code: z.number().int().min(100).max(999).optional(),
  verb: z.enum(VERBS as unknown as [string, ...string[]]).optional(),
  /** A source may raise its own risk, never lower the computed one (BIP-F-04). */
  risk: riskSchema.optional(),
  ttl_seconds: z.number().int().min(30).max(86400).optional(),
  callback_url: urlish.optional(),
  agent_says: z.string().max(2000).optional(),
  /** Idempotency key: the same key from the same station reuses the page (BIP-N-02). */
  dedupe_key: z.string().min(1).max(200).optional(),
};

export const toolPageRequestSchema = z.object({
  kind: z.literal('tool'),
  tool_name: z.string().min(1).max(64),
  command: z.string().max(4000).optional(),
  path: z.string().max(2048).optional(),
  cwd: z.string().max(2048).optional(),
  branch: z.string().max(256).optional(),
  stats: z.string().max(160).optional(),
  ...commonPageFields,
});

export const questionPageRequestSchema = z.object({
  kind: z.literal('question'),
  question: z.string().min(1).max(4000),
  options: z.array(optionSchema).min(2).max(4).optional(),
  detail: z.string().max(240).optional(),
  ...commonPageFields,
});

export const createPageRequestSchema = z.discriminatedUnion('kind', [
  toolPageRequestSchema,
  questionPageRequestSchema,
]);

export type CreatePageRequest = z.infer<typeof createPageRequestSchema>;

export const noticeRequestSchema = z.object({
  station: z.string().min(1).max(32).optional(),
  line: z.string().min(1).max(LINE_MAX),
});

export const signedDecisionSchema = z.object({
  page_id: z.string().min(1).max(64),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  verdict: z.enum(['approve', 'deny', 'choice']),
  choice: z.string().regex(/^[A-D]$/).nullable().optional(),
  nonce: z.string().min(8).max(128),
  expires_at: z.number().int().positive(),
  device_id: z.string().min(1).max(64),
  signature: z.string().min(8).max(512),
});

export type SignedDecision = z.infer<typeof signedDecisionSchema>;

export const pairingRequestSchema = z.object({
  device_name: z.string().min(1).max(64),
  public_key_jwk: z.record(z.string(), z.unknown()),
  push_subscription: z.unknown().optional(),
});

export const pairingTokenSchema = z.object({
  pairing_id: z.string().min(1),
  device_id: z.string().min(1),
});

export const dryRunRequestSchema = z.object({
  command: z.string().min(1).max(4000).optional(),
  tool_name: z.string().max(64).optional(),
  path: z.string().max(2048).optional(),
});

export const cancelPageSchema = z.object({
  reason: z.string().max(200).optional(),
});

/** Shape pushed on the WebSocket stream (`GET /v1/stream`). */
export const streamMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page.delivered'), page: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('page.read'), page_id: z.string() }),
  z.object({ type: z.literal('page.decided'), page_id: z.string(), verdict: z.string() }),
  z.object({ type: z.literal('page.expired'), page_id: z.string() }),
  z.object({ type: z.literal('page.cancelled'), page_id: z.string() }),
  z.object({ type: z.literal('notice.logged'), notice: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('hello'), central: z.string(), budget: z.number() }),
]);

export type StreamMessage = z.infer<typeof streamMessageSchema>;

/** What an adapter (hook, MCP, CLI, SNPP) receives when it waits. */
export const decisionStatusSchema = z.enum([
  'approved',
  'denied',
  'choice',
  'expired',
  'cancelled',
  'pending',
]);

export const waitResponseSchema = z.object({
  status: decisionStatusSchema,
  page_id: z.string(),
  choice: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  fingerprint: z.string(),
  latency_ms: z.number().int().nonnegative(),
});

export type WaitResponse = z.infer<typeof waitResponseSchema>;

export function isRisk(value: unknown): value is Risk {
  return value === 'green' || value === 'amber' || value === 'red';
}
