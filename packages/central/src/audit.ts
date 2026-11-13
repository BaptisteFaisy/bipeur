/**
 * The audit log (BIP-F-12): append-only, and payload-free by construction.
 * Only the fingerprint, the ids, the state and the durations travel here
 * (BIP-N-03) — any free text a caller tries to attach is dropped.
 */
import type { AuditEvent, AuditEventType } from '@bipeur/core';
import type { Store } from './store/types.js';

/** Keys that would leak a payload or agent prose into the log. */
const FORBIDDEN_KEYS = new Set(['payload', 'command', 'question', 'path', 'text', 'agent_says', 'line']);

export function sanitizeData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (typeof value === 'string' && value.length > 200) continue;
    clean[key] = value;
  }
  return clean;
}

export class AuditLog {
  constructor(
    private readonly store: Store,
    private readonly clock: () => number,
  ) {}

  /** Appends one event. The timestamp defaults to the injected clock. */
  append(event: Omit<AuditEvent, 'ts'> & { ts?: number }): void {
    this.store.appendEvent({
      ts: event.ts ?? this.clock(),
      type: event.type,
      page_id: event.page_id ?? null,
      source_id: event.source_id ?? null,
      device_id: event.device_id ?? null,
      fingerprint: event.fingerprint ?? null,
      data: sanitizeData(event.data),
    });
  }

  list(options: { limit?: number; type?: AuditEventType | null; sourceId?: string | null; offset?: number } = {}): AuditEvent[] {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const offset = Math.min(10_000, Math.max(0, options.offset ?? 0));
    return this.store.listEvents({ limit, type: options.type ?? null, sourceId: options.sourceId ?? null, offset });
  }

  count(type: AuditEventType): number {
    return this.store.countEvents(type);
  }
}
