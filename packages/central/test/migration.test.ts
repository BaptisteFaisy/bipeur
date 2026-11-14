/**
 * The schema migration must open a database written by an OLDER build.
 *
 * Proved on the production host, 2026-11-14: deploying the ten features over
 * the instance that had been running since BIP-F-37 made the Central die on
 * boot with `no such column: group_key`. The `pages` table already existed, so
 * `CREATE TABLE IF NOT EXISTS` was a no-op; the index over the columns a
 * MIGRATION adds (`group_key`, `group_leader_id`) then ran first and aborted —
 * `migrate()` never got its turn.
 *
 * So the order of the DDL is part of the contract, and this file is the
 * regression test: a database built from the old schema must open, gain its
 * columns, keep its rows, and serve.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/store/schema.js';

/** The pages table as it stood before BIP-F-42, 43 and 47 landed. */
const OLD_PAGES = `
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_alias TEXT NOT NULL,
  kind TEXT NOT NULL,
  code INTEGER NOT NULL,
  risk TEXT NOT NULL,
  line TEXT NOT NULL,
  detail TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  options TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  read_at INTEGER,
  expires_at INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL,
  callback_url TEXT,
  reminders_sent INTEGER NOT NULL DEFAULT 0,
  visitor_id TEXT,
  rota_id TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  escalated_at INTEGER
)`;

/** Writes a database the way the previous build did, with one live page in it. */
function seedOldDatabase(path: string): void {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(
    `CREATE TABLE sources (
       id TEXT PRIMARY KEY,
       alias TEXT NOT NULL,
       kind TEXT NOT NULL,
       token_hash TEXT NOT NULL UNIQUE,
       last_seen_at INTEGER NOT NULL,
       visitor_id TEXT,
       revoked_at INTEGER
     )`,
  );
  db.exec(OLD_PAGES);
  db.exec(
    "INSERT INTO sources (id, alias, kind, token_hash, last_seen_at) VALUES ('src_1', 'fw', 'cli', 'tok', 1)",
  );
  db.exec(
    `INSERT INTO pages (id, source_id, source_alias, kind, code, risk, line, detail, payload,
       payload_sha256, options, state, created_at, expires_at, dedupe_key)
     VALUES ('pg_1', 'src_1', 'fw', 'tool', 310, 'amber',
             '310 fw PUSH main>origin #aaaa', '[]', '{}', '${'a'.repeat(64)}', '[]', 'queued', 1, 900000, 'k')`,
  );
  db.close();
}

function withOldDatabase(run: (db: DatabaseSync) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'bipeur-old-'));
  const path = join(dir, 'central.sqlite');
  seedOldDatabase(path);
  const db = openDatabase(path);
  try {
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const columnsOf = (db: DatabaseSync): string[] =>
  (db.prepare('PRAGMA table_info(pages)').all() as Array<Record<string, unknown>>).map((row) => String(row['name']));

const indexesOf = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pages'").all() as Array<Record<string, unknown>>).map((row) => String(row['name']));

describe('the schema migration over an older database', () => {
  it('opens a pre-feature pages table and adds the columns it indexes on', () => {
    withOldDatabase((db) => {
      const columns = columnsOf(db);
      expect(columns).toContain('group_key');
      expect(columns).toContain('group_leader_id');
      expect(columns).toContain('shadow_resolved_at');
      expect(columns).toContain('canary');
    });
  });

  it('keeps the row that was already there, untouched', () => {
    withOldDatabase((db) => {
      const row = db.prepare('SELECT id, line, state, code FROM pages WHERE id = ?').get('pg_1') as Record<string, unknown>;
      expect(String(row['line'])).toContain('PUSH');
      expect(String(row['state'])).toBe('queued');
      expect(Number(row['code'])).toBe(310);
    });
  });

  it('makes the index over the migrated columns usable', () => {
    withOldDatabase((db) => {
      expect(indexesOf(db)).toContain('pages_group');
      const rows = db.prepare('SELECT id FROM pages WHERE group_key = ? AND state IN (\'queued\',\'delivered\',\'read\')').all('nothing');
      expect(rows).toHaveLength(0);
    });
  });

  it('is idempotent: a second open changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bipeur-old-'));
    const path = join(dir, 'central.sqlite');
    seedOldDatabase(path);
    const first = openDatabase(path);
    const afterFirst = columnsOf(first);
    first.close();
    const second = openDatabase(path);
    expect(columnsOf(second)).toEqual(afterFirst);
    second.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('still builds a database from scratch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bipeur-new-'));
    const path = join(dir, 'central.sqlite');
    const db = openDatabase(path);
    expect(columnsOf(db)).toContain('canary');
    expect(indexesOf(db)).toContain('pages_group');
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
