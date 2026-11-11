/**
 * Reminders (BIP-F-08): an unread delivered page comes back at 2, 5 and 15
 * minutes, then stops. Expiry itself is a refusal, handled by `expireDue`.
 * Every reminder is a `beep.requested` event — the log proves the intent.
 */
import { REMINDER_OFFSETS_MS } from '@bipeur/core';
import type { CentralContext } from './context.js';
import { pageView } from './view.js';

export class ReminderSweeper {
  constructor(private readonly ctx: CentralContext) {}

  /** Sends every reminder that is due at `now`; returns how many were sent. */
  sweep(now: number): number {
    let sent = 0;
    for (const page of this.ctx.store.listPages({ state: 'delivered', limit: 200 })) {
      if (page.delivered_at === null || page.read_at !== null) continue;
      const due = REMINDER_OFFSETS_MS.filter((offset) => now - page.delivered_at! >= offset).length;
      while (page.reminders_sent < due) {
        page.reminders_sent += 1;
        this.ctx.store.updatePage(page.id, { reminders_sent: page.reminders_sent });
        this.ctx.audit.append({
          type: 'beep.requested',
          page_id: page.id,
          source_id: page.source_id,
          fingerprint: page.payload_sha256,
          data: { reminder: page.reminders_sent, after_ms: now - page.delivered_at },
        });
        this.ctx.push.notify(page, { reminder: true });
        this.ctx.hub.broadcast(
          { type: 'page.delivered', page: pageView(page) },
          { visitorId: page.visitor_id },
        );
        sent += 1;
      }
    }
    return sent;
  }
}
