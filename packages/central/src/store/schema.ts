/**
 * Schema of A.9 and the SQLite settings that make a restart harmless
 * (BIP-N-02 / BIP-P-12): WAL so a committed page survives a crash, foreign keys
 * so a demo visitor can be wiped in one go, and an append-only audit log.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_at INTEGER NOT NULL,
  visitor_id TEXT,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  public_key_jwk TEXT NOT NULL,
  push_subscription TEXT,
  paired_at INTEGER NOT NULL,
  revoked_at INTEGER,
  visitor_id TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
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
  escalated_at INTEGER,
  -- BIP-F-47: the group key, and the leader this page hangs on. A member page
  -- never rings: the leader carries the list and the group digest.
  group_key TEXT,
  group_leader_id TEXT

  -- BIP-F-42: when shadow mode resolved this page without a human. It is NOT
  -- a decision: no row goes into the decisions table, so the metrics of A.3
  -- never count a simulated approval as a real one.
  shadow_resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS pages_group ON pages(group_key, state);
CREATE INDEX IF NOT EXISTS pages_dedupe ON pages(source_id, dedupe_key, state);
CREATE INDEX IF NOT EXISTS pages_state ON pages(state, expires_at);
CREATE INDEX IF NOT EXISTS pages_visitor ON pages(visitor_id);

CREATE TABLE IF NOT EXISTS decisions (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  choice_code TEXT,
  nonce TEXT NOT NULL UNIQUE,
  signature TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  page_id TEXT,
  source_id TEXT,
  device_id TEXT,
  fingerprint TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_type ON events(type);
CREATE TRIGGER IF NOT EXISTS events_append_only
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is an append-only log');
END;

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_alias TEXT NOT NULL,
  ts INTEGER NOT NULL,
  line TEXT NOT NULL,
  visitor_id TEXT
);
CREATE INDEX IF NOT EXISTS notices_ts ON notices(ts);

CREATE TABLE IF NOT EXISTS pairings (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  visitor_id TEXT
);

CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  kind TEXT NOT NULL,
  remaining INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS delegations_source ON delegations(source_id);

-- The on-call rota (BIP-F-37): who answers, in which order, and for how long
-- the first one has before the page moves to the next.
CREATE TABLE IF NOT EXISTS rotas (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  escalate_after_ms INTEGER NOT NULL,
  rotation_ms INTEGER,
  created_at INTEGER NOT NULL
);

-- One shift of a rota: the human, the pager that receives the page, and the
-- window during which the shift holds. A null window means "always on call".
CREATE TABLE IF NOT EXISTS oncall_shifts (
  id TEXT PRIMARY KEY,
  rota_id TEXT NOT NULL REFERENCES rotas(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  target TEXT NOT NULL,
  priority INTEGER NOT NULL,
  starts_at INTEGER,
  ends_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oncall_shifts_rota ON oncall_shifts(rota_id, priority);

-- The closure of a page (BIP-F-41): what the agent did with the decision.
-- One page, one closure — the primary key is the proof, and a retry lands on
-- the row that already exists instead of writing a second one.
CREATE TABLE IF NOT EXISTS closures (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  closure_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  evidence TEXT,
  origin_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS closures_source ON closures(source_id, created_at);

-- The pagers a page is addressed to. A rota page is addressed to the on-call
-- member; an escalation adds the next one. A page with no target keeps the
-- historical delivery: the visitor scope of the station.
CREATE TABLE IF NOT EXISTS page_targets (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, device_id)
);
CREATE INDEX IF NOT EXISTS page_targets_device ON page_targets(device_id);
`;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}

/** Additive migrations for databases created before a column existed. */
function migrate(db: DatabaseSync): void {
  ensureColumn(db, 'sources', 'revoked_at', 'INTEGER');
  ensureColumn(db, 'pages', 'rota_id', 'TEXT');
  ensureColumn(db, 'pages', 'escalation_level', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'pages', 'escalated_at', 'INTEGER');
  ensureColumn(db, 'pages', 'group_key', 'TEXT');
  ensureColumn(db, 'pages', 'group_leader_id', 'TEXT');

  ensureColumn(db, 'pages', 'shadow_resolved_at', 'INTEGER');
}

function ensureColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>;
  if (rows.some((row) => row['name'] === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
