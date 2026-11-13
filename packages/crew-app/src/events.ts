/**
 * Events emitted by the Crew Gateway over `/api/ws`.
 *
 * Every frame is `{"type": <event>, "data": {...}}` and slot-bound events
 * carry the slot key in `data.slot` (kirocrew-client `ws_client.py`).
 *
 * The `approval` payload is the Gateway's pending-approval record
 * (`dashboard/interaction_coordinator.py ApprovalCoordinator.request`):
 * `{id, instance, source, tool, tool_input, tool_purpose, slot, ts}` plus the
 * optional task-gate fields. `instance` names THIS request — the same `id`
 * can recur — and doubles as the `request_mid` of the native decide form,
 * which is the only form that accepts a rejection `reason`.
 *
 * Parsing stays lenient: a missing field is tolerated, an unknown event is
 * ignored, and nothing throws on bad input.
 */
import { z } from 'zod';

/** The Gateway's approval record, as broadcast in `data`. */
export const approvalDataSchema = z.object({
  id: z.string().min(1).max(200),
  instance: z.string().max(200).optional(),
  source: z.string().max(200).optional(),
  tool: z.string().max(200).optional(),
  tool_input: z.string().max(4000).optional(),
  tool_purpose: z.string().max(2000).optional(),
  slot: z.string().max(200).optional(),
  ts: z.number().optional(),
});

/** Schema-v2 notification note (`notifications/bus.py NotificationPayload`). */
export const notificationDataSchema = z
  .object({
    source: z.string().max(200).optional(),
    channel: z.string().max(200).optional(),
    title: z.string().max(500).optional(),
    body: z.string().max(4000).optional(),
    priority: z.string().max(20).optional(),
  })
  .passthrough();

export const approvalResolvedDataSchema = z
  .object({
    id: z.string().min(1).max(200),
    instance: z.string().max(200).optional(),
    approved: z.boolean().optional(),
    decision: z.string().max(40).optional(),
    slot: z.string().max(200).optional(),
  })
  .passthrough();

/** Listed by the SDK docs; no emitter found in the open-source Gateway tree. */
export const taskEventDataSchema = z
  .object({
    task_id: z.string().max(200).optional(),
    summary: z.string().max(2000).optional(),
    slot: z.string().max(200).optional(),
  })
  .passthrough();

export const crewFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approval'), data: approvalDataSchema }),
  z.object({ type: z.literal('approval_resolved'), data: approvalResolvedDataSchema }),
  z.object({ type: z.literal('notification'), data: notificationDataSchema }),
  z.object({ type: z.literal('task_complete'), data: taskEventDataSchema }),
  z.object({ type: z.literal('task_update'), data: taskEventDataSchema }),
]);

export type CrewFrame = z.infer<typeof crewFrameSchema>;
export type ApprovalData = z.infer<typeof approvalDataSchema>;
export type ApprovalFrame = Extract<CrewFrame, { type: 'approval' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Accept the documented `{type, data}` frame, or a bare data record carrying
 * its own `type` (defensive: an older or reshaped Gateway may flatten them).
 */
export function normalizeFrame(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  if (typeof raw['type'] === 'string' && isRecord(raw['data'])) return raw;
  if (typeof raw['type'] === 'string' && raw['data'] === undefined) return { type: raw['type'], data: raw };
  return raw;
}

/** `null` for anything that is not a known frame: never a throw, never a beep. */
export function parseFrame(raw: unknown): CrewFrame | null {
  const parsed = crewFrameSchema.safeParse(normalizeFrame(raw));
  return parsed.success ? parsed.data : null;
}

export function approvalDedupeKey(approvalId: string, instance?: string): string {
  return instance === undefined || instance.length === 0
    ? `crew:approval:${approvalId}`
    : `crew:approval:${approvalId}:${instance}`;
}
