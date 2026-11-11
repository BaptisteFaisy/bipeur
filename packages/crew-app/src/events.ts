/**
 * Events emitted by the Crew Gateway. Their exact shape is marked "to verify"
 * in the contest specification (A.9), so parsing is lenient: a missing field is
 * tolerated, an unknown event is ignored, and nothing throws on bad input.
 */
import { z } from 'zod';

export const crewEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('approval'),
    approval_id: z.string().min(1).max(200),
    /** The summary Crew wrote; it goes to `agent_says`, never to the line. */
    summary: z.string().max(2000).optional(),
    tool_name: z.string().max(64).optional(),
    command: z.string().max(4000).optional(),
    path: z.string().max(2048).optional(),
  }),
  z.object({
    type: z.literal('task_complete'),
    task_id: z.string().min(1).max(200),
    summary: z.string().max(2000).optional(),
  }),
  z.object({
    type: z.literal('notification'),
    message: z.string().min(1).max(2000),
    level: z.string().max(20).optional(),
  }),
]);

export type CrewEvent = z.infer<typeof crewEventSchema>;
export type ApprovalEvent = Extract<CrewEvent, { type: 'approval' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Accept the event itself or a `{ payload: … }` / `{ data: … }` envelope, and
 * the common aliases (`id`, `line`) the Gateway reference may use.
 */
export function normalizeRaw(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const envelope = isRecord(raw['payload']) ? raw['payload'] : isRecord(raw['data']) ? raw['data'] : raw;
  if (!isRecord(envelope)) return envelope;
  const event: Record<string, unknown> = { ...envelope };
  if (event['type'] === 'approval' && event['approval_id'] === undefined && typeof event['id'] === 'string') {
    event['approval_id'] = event['id'];
  }
  if (event['type'] === 'notification' && event['message'] === undefined) {
    event['message'] = event['line'] ?? event['summary'];
  }
  if (event['type'] === 'task_complete' && event['task_id'] === undefined && typeof event['id'] === 'string') {
    event['task_id'] = event['id'];
  }
  return event;
}

/** `null` for anything that is not a known event: never a throw, never a beep. */
export function parseEvent(raw: unknown): CrewEvent | null {
  const parsed = crewEventSchema.safeParse(normalizeRaw(raw));
  return parsed.success ? parsed.data : null;
}

export function approvalDedupeKey(approvalId: string): string {
  return `crew:approval:${approvalId}`;
}
