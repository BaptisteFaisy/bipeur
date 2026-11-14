/**
 * External transparency (BIP-F-45).
 *
 * The audit log is append-only *inside* our SQLite file, with a trigger that
 * refuses UPDATE. That stops accidents; it does not stop a root. A root with
 * shell access can rewrite a file, and nobody outside could tell.
 *
 * So the log is folded into a Merkle root, and the root is published. Once the
 * root leaves this machine — in the anchor file, in a git commit, on a page an
 * outsider can fetch — a rewritten event changes the root, and the lie is
 * visible without any access to the database.
 *
 * What is committed is the *position* of every event as much as its content:
 * the leaf carries the row id, so deleting an event, inserting one, or moving
 * one is caught too.
 */
import {
  logLeaf,
  merkleProof,
  merkleRoot,
  MERKLE_ALGORITHM,
  type AuditEvent,
  type MerkleProof,
} from '@bipeur/core';
import { sha256Hex } from '@bipeur/core/node';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CentralContext } from './context.js';
import type { EventCount, EventRecord, Store } from './store/types.js';

/** One published root: enough for a third party to check a claim later. */
export interface TransparencyRoot {
  algorithm: string;
  root: string;
  /** Events the root was computed over. */
  events: number;
  /** Row id of the last event, so a gap at the end is visible. */
  last_id: number;
}

export interface TransparencyProof {
  algorithm: string;
  root: string;
  proof: MerkleProof;
  event: AuditEvent;
}

/** How often a root is folded and anchored, in events. */
export const CHECKPOINT_EVERY = 100;

/**
 * Folds the log into a root. The store is read in append order with the row
 * ids, because the position of an event is one of the facts a proof commits
 * to (BIP-F-12: the log is a sequence, not a set).
 */
export function transparencyRoot(store: Store): TransparencyRoot {
  const size = store.eventCount();
  const leaves = leavesOf(store, size);
  return {
    algorithm: MERKLE_ALGORITHM,
    root: merkleRoot(leaves, sha256Hex),
    events: size.count,
    last_id: size.lastId,
  };
}

/** The canonical leaf of every event, oldest first. */
function leavesOf(store: Store, size: EventCount): string[] {
  if (size.count === 0) return [];
  const leaves: string[] = [];
  let after = 0;
  for (;;) {
    const batch = store.eventRange(after, 500);
    if (batch.length === 0) break;
    for (const record of batch) leaves.push(logLeaf(record.id, record.event));
    after = batch[batch.length -1 ]!.id;
  }
  return leaves;
}

/**
 * The inclusion path of one event, plus the root it proves against. An
 * outsider recomputes the leaf, folds the path, and compares with the
 * published root: no database access needed (that is the whole point).
 */
export function transparencyProof(ctx: CentralContext, eventId: number): TransparencyProof | null {
  const record = ctx.store.eventById(eventId);
  if (!record) return null;
  const index = ctx.store.eventIndex(eventId);
  if (index === null) return null;
  const leaves = leavesOf(ctx.store, ctx.store.eventCount());
  const proof = merkleProof(leaves, index, sha256Hex);
  if (!proof) return null;
  return { algorithm: MERKLE_ALGORITHM, root: merkleRoot(leaves, sha256Hex), proof, event: record.event };
}

/**
 * Appends a checkpoint event and writes the anchor. The checkpoint is itself
 * part of the log, so it commits to the log *as it was before* it: an anchor
 * can never hide the fact that it was written.
 */
export function checkpoint(ctx: CentralContext, anchorPath: string | null): TransparencyRoot {
  const before = transparencyRoot(ctx.store);
  ctx.audit.append({
    type: 'transparency.checkpoint',
    data: { algorithm: before.algorithm, events: before.events, last_id: before.last_id },
  });
  const after = transparencyRoot(ctx.store);
  writeAnchor(anchorPath, after, ctx.clock());
  return after;
}

/**
 * The anchor: one line per published root, append-only, outside the database.
 * `ts root events last_id` — enough to verify a proof, nothing that leaks a
 * payload (BIP-N-03).
 */
export function writeAnchor(path: string | null, root: TransparencyRoot, ts: number): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${ts} ${root.root} ${root.events} ${root.last_id}\n`, 'utf8');
}

/**
 * Whether a checkpoint is due: called by the sweeper, never on a read path.
 *
 * The baseline is the journal size the LAST published root committed to, read
 * back from the log itself. Sizing it on `count % N` would fire on a multiple
 * and miss every other growth, and a log that grows between two sweeps would
 * never be anchored at all.
 */
export function checkpointDue(ctx: CentralContext, every: number = CHECKPOINT_EVERY): boolean {
  const size = ctx.store.eventCount();
  if (size.count === 0) return false;
  const last = ctx.store.listEvents({ type: 'transparency.checkpoint', limit: 1 })[0];
  const baseline = committedEvents(last);
  return size.count - baseline >= every;
}

/** How many events a checkpoint committed to, from its own audit record. */
function committedEvents(event: AuditEvent | undefined): number {
  const value = event?.data?.events;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Reads one anchor file back — used by the tests and by an auditor's script. */
export function parseAnchor(text: string): Array<{ ts: number; root: string; events: number; lastId: number }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [ts, root, events, lastId] = line.split(' ');
      return { ts: Number(ts), root: root ?? '', events: Number(events), lastId: Number(lastId) };
    });
}

/** The shape a record has once it leaves the store (kept for the routes). */
export type { EventRecord };
