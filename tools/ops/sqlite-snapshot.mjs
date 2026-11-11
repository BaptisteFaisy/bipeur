#!/usr/bin/env node
/**
 * Consistent snapshot of a LIVE SQLite database in WAL mode — Node stdlib only.
 *
 * Why not `cp`: measured on the production host on 2026-11-11, the database
 * file `data/bipeur.sqlite` was 4 096 bytes while `data/bipeur.sqlite-wal`
 * held 1 034 152 bytes — every page written since the last checkpoint lives in
 * the WAL. A file copy of the `.sqlite` alone therefore produces an *almost
 * empty* database, and copying the three files while the service writes can
 * produce a torn one. BIP-N-09's "backup = copy the file" is not a backup until
 * the copy has been proven to open and to contain the data.
 *
 * This script uses SQLite's own mechanisms instead:
 *   1. the Online Backup API (`node:sqlite`'s `backup()`), which is the API the
 *      task asks for and is safe against concurrent writers;
 *   2. `VACUUM INTO '<dest>'` as a fallback — a single statement that writes a
 *      consistent, fully checkpointed copy of the database as of its read
 *      transaction, also safe while the service runs.
 *
 * Then it PROVES the copy: reopen it, `PRAGMA integrity_check`, count the pages
 * (the bips) and read the last audit event. The result is printed as one JSON
 * manifest on stdout; any failure exits non-zero.
 *
 * Usage: node tools/ops/sqlite-snapshot.mjs --db <source> --out <snapshot>
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as sqlite from 'node:sqlite';

const INTERESTING_TABLES = ['pages', 'events', 'sources', 'devices', 'visitors', 'decisions'];

function parseArgs(argv) {
  const args = { db: '', out: '', quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--db') args.db = argv[++i];
    else if (key === '--out') args.out = argv[++i];
    else if (key === '--quiet') args.quiet = true;
  }
  if (!args.db || !args.out) throw new Error('--db and --out are required');
  return args;
}

function openSource(path) {
  try {
    return { db: new DatabaseSync(path, { readOnly: true }), mode: 'read-only' };
  } catch (error) {
    // A WAL database whose -shm cannot be mapped read-only still snapshots fine
    // with a read-write connection: nothing below ever writes to the source.
    return { db: new DatabaseSync(path), mode: `read-write (${error.message.slice(0, 80)})` };
  }
}

async function snapshot(source, sourcePath, outPath) {
  if (existsSync(outPath)) unlinkSync(outPath);
  if (typeof sqlite.backup === 'function') {
    await sqlite.backup(source, outPath);
    return 'online-backup-api';
  }
  // VACUUM INTO refuses an existing destination and quotes must be escaped.
  source.exec(`VACUUM INTO '${outPath.replaceAll("'", "''")}'`);
  return 'vacuum-into';
}

function inspect(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
    );
    const counts = {};
    for (const table of INTERESTING_TABLES.filter((t) => tables.has(t))) {
      counts[table] = Number(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n);
    }
    const journal = db.prepare('PRAGMA journal_mode').get();
    return { integrity, counts, journal_mode: journal.journal_mode ?? journal, tables: tables.size };
  } finally {
    db.close();
  }
}

function lastEvent(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const hasEvents = db
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='events'")
      .get().n > 0;
    if (!hasEvents) return null;
    const row = db.prepare('SELECT id, ts, type, page_id FROM events ORDER BY id DESC LIMIT 1').get();
    return row ? { id: Number(row.id), ts: String(row.ts), type: String(row.type) } : null;
  } finally {
    db.close();
  }
}

function dropEmptySidecars(path) {
  // Inspecting a WAL-mode database creates an -shm index (32 768 bytes, pure
  // shared-memory index, always rebuilt) and an empty -wal next to it. The
  // snapshot itself is fully checkpointed, so neither carries data: dropping
  // them keeps the archive to one meaningful file. A non-empty -wal is left
  // alone rather than risk losing pages.
  for (const suffix of ['-shm', '-wal']) {
    const sidecar = `${path}${suffix}`;
    if (!existsSync(sidecar)) continue;
    if (suffix === '-shm' || statSync(sidecar).size === 0) unlinkSync(sidecar);
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.db)) throw new Error(`source database not found: ${args.db}`);
  const wal = `${args.db}-wal`;
  const { db: source, mode } = openSource(args.db);
  let method;
  try {
    method = await snapshot(source, args.db, args.out);
  } finally {
    source.close();
  }
  const check = inspect(args.out);
  const lastAudit = lastEvent(args.out);
  dropEmptySidecars(args.out);
  const manifest = {
    source: args.db,
    source_bytes: statSync(args.db).size,
    source_wal_bytes: existsSync(wal) ? statSync(wal).size : 0,
    source_opened: mode,
    snapshot: args.out,
    snapshot_bytes: statSync(args.out).size,
    sha256: sha256(args.out),
    method,
    integrity_check: check.integrity,
    journal_mode: check.journal_mode,
    tables: check.tables,
    counts: check.counts,
    last_event: lastAudit,
    taken_at: new Date().toISOString(),
  };
  manifest.opens_and_is_consistent =
    check.integrity.length === 1 && check.integrity[0] === 'ok' && manifest.snapshot_bytes > 0;
  if (!args.quiet) process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (!manifest.opens_and_is_consistent) {
    process.stderr.write(`snapshot failed integrity_check: ${JSON.stringify(check.integrity)}\n`);
    process.exitCode = 1;
  }
}

await main();
