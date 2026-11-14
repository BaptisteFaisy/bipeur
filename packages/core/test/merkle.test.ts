/**
 * BIP-F-45 — the Merkle tree over the audit log.
 *
 * The journal is append-only inside our SQLite file. That stops accidents, not
 * a root. A root folded into a Merkle root and published outside turns the
 * journal into something a third party can check *without* access to the
 * database — and can catch lying to.
 *
 * The properties that matter are the ones a tamper would break: the root moves
 * when anything moves (an event added, edited, deleted, reordered), and a proof
 * only verifies for the log it was built from.
 */
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.js';
import type { AuditEvent, AuditEventType } from '../src/types.js';
import {
  logLeaf,
  merkleProof,
  merkleRoot,
  MERKLE_ALGORITHM,
  verifyMerkleProof,
} from '../src/index.js';

/** A stand-in for `sha256Hex` that needs no Node API: the shape is what counts. */
const hash = (value: string): string => {
  let a = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    a ^= value.charCodeAt(i);
    a = Math.imul(a, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0');
};

function event(id: number, type: AuditEventType = 'page.created'): AuditEvent {
  return { ts: 1_760_000_000_000 + id, type, page_id: `pg_${id}`, fingerprint: `f${id}` };
}

const leaves = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => logLeaf(i + 1, event(i + 1)));

describe('the root of a log', () => {
  it('is stable for the same log, whatever the order of computation', () => {
    const a = merkleRoot(leaves(7), hash);
    const b = merkleRoot(leaves(7), hash);
    expect(a).toBe(b);
    expect(a).toHaveLength(8);
  });

  it('has its own root when the log is empty, so "no events" is provable', () => {
    expect(merkleRoot([], hash)).toBe(hash(`${MERKLE_ALGORITHM}:empty`));
    expect(merkleRoot([], hash)).not.toBe(merkleRoot(leaves(1), hash));
  });

  it('moves when one event is added', () => {
    expect(merkleRoot(leaves(4), hash)).not.toBe(merkleRoot(leaves(5), hash));
  });

  it('moves when one event is edited, deep in the log', () => {
    const built = leaves(9);
    const tampered = [...built];
    tampered[4] = logLeaf(5, { ...event(5), type: 'page.decided' });
    expect(merkleRoot(built, hash)).not.toBe(merkleRoot(tampered, hash));
  });

  it('moves when an event is deleted, even if the rest is untouched', () => {
    const built = leaves(8);
    const shorter = [...built.slice(0, 3), ...built.slice(4)];
    expect(merkleRoot(built, hash)).not.toBe(merkleRoot(shorter, hash));
  });

  it('moves when two events are swapped', () => {
    const built = leaves(6);
    const swapped = [...built];
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    expect(merkleRoot(built, hash)).not.toBe(merkleRoot(swapped, hash));
  });

  it('does not collapse two different logs that share a leaf', () => {
    // An unpaired node is promoted, never duplicated: duplicating would let a
    // one-event log and a two-event log of the same event share a root.
    const one = leaves(1);
    const two = [...one, ...one];
    expect(merkleRoot(one, hash)).not.toBe(merkleRoot(two, hash));
  });
});

describe('the inclusion proof', () => {
  it('verifies against the root for every position of a nine-event log', () => {
    const built = leaves(9);
    const root = merkleRoot(built, hash);
    for (let index = 0; index < built.length; index += 1) {
      const proof = merkleProof(built, index, hash);
      expect(proof).not.toBeNull();
      expect(verifyMerkleProof(proof!, root, hash)).toBe(true);
      expect(proof!.index).toBe(index);
      expect(proof!.total).toBe(built.length);
    }
  });

  it('refuses an index outside the log', () => {
    expect(merkleProof(leaves(3), 3, hash)).toBeNull();
    expect(merkleProof(leaves(3), -1, hash)).toBeNull();
    expect(merkleProof([], 0, hash)).toBeNull();
  });

  it('does not verify a leaf that belongs to another log', () => {
    const built = leaves(5);
    const root = merkleRoot(built, hash);
    const proof = merkleProof(built, 2, hash)!;
    const forged: typeof proof = { ...proof, leaf: logLeaf(2, event(2, 'page.cancelled')) };
    expect(verifyMerkleProof(forged, root, hash)).toBe(false);
  });

  it('does not verify against another root', () => {
    const built = leaves(5);
    const proof = merkleProof(built, 1, hash)!;
    expect(verifyMerkleProof(proof, merkleRoot(leaves(6), hash), hash)).toBe(false);
  });

  it('does not verify an event invented after the root was published', () => {
    const built = leaves(4);
    const root = merkleRoot(built, hash);
    const late = logLeaf(99, event(99));
    const proof = merkleProof([...built, late], 4, hash)!;
    expect(verifyMerkleProof(proof, root, hash)).toBe(false);
  });

  it('names the algorithm, so a verifier knows which layout to reproduce', () => {
    const proof = merkleProof(leaves(3), 0, hash)!;
    expect(proof.algorithm).toBe(MERKLE_ALGORITHM);
    expect(proof.algorithm).toBe('bipeur-merkle-v1');
  });
});

describe('the leaf of an event', () => {
  it('commits to the position, not only the content', () => {
    const same = event(1);
    expect(logLeaf(1, same)).not.toBe(logLeaf(2, same));
  });

  it('is canonical: the same facts, the same bytes', () => {
    const a = logLeaf(1, { ts: 5, type: 'page.created', page_id: null, source_id: 'src' });
    const b = logLeaf(1, { source_id: 'src', type: 'page.created', ts: 5 });
    expect(a).toBe(canonicalize(JSON.parse(b)));
    expect(a).toBe(logLeaf(1, { ts: 5, type: 'page.created', source_id: 'src' }));
  });
});
