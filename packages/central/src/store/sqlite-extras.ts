/**
 * The store blocks that arrived after the core one: the transparency reads
 * (BIP-F-45) and the closures (BIP-F-41).
 *
 * They live in their own file so `sqlite.ts` stays the assembly of the store
 * rather than the place where every feature appends three methods — the rule
 * is a file under 500 lines, and the file has to be SPLIT, not squeezed.
 */
import type { DatabaseSync } from 'node:sqlite';
import * as closureSql from './closure-sql.js';
import * as eventSql from './event-sql.js';
import type { ClosureRow, EventCount, EventRecord } from './types.js';

export class SqliteExtras {
  constructor(protected readonly db: DatabaseSync) {}

  // --- transparency reads (BIP-F-45) --------------------------------------

  eventCount(): EventCount {
    return eventSql.eventCount(this.db);
  }

  eventById(id: number): EventRecord | null {
    return eventSql.eventById(this.db, id);
  }

  eventRange(afterId: number, limit: number): EventRecord[] {
    return eventSql.eventRange(this.db, afterId, limit);
  }

  eventIndex(id: number): number | null {
    return eventSql.eventIndex(this.db, id);
  }

  insertClosure(closure: ClosureRow): boolean {
    return closureSql.insertClosure(this.db, closure);
  }

  closureByPage(pageId: string): ClosureRow | null {
    return closureSql.closureByPage(this.db, pageId);
  }

  listClosures(sourceId: string | null, limit: number): ClosureRow[] {
    return closureSql.listClosures(this.db, sourceId, limit);
  }
}
