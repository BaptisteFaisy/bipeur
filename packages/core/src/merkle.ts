/**
 * Merkle tree over the audit log (BIP-F-45). The journal is append-only only
 * *inside* our SQLite file: a root that can rewrite it leaves nobody the worse.
 * A root computed over the ordered events, published outside, turns the journal
 * into something an outsider can check — and can catch being lied to.
 *
 * The hash is injected rather than imported: this module stays browser-safe
 * (no `node:crypto`), and the Central supplies `sha256Hex` from
 * `@bipeur/core/node`. An external verifier supplies the same function.
 *
 * Shape, fixed by `MERKLE_ALGORITHM`:
 * - a leaf is `H("L" + canonical(event-with-id))`;
 * - a node is `H("N" + left + right)`;
 * - an unpaired node at the top of a layer is promoted, never duplicated
 *   (duplication makes two different logs share a root);
 * - an empty log has its own root, so "no events" is provable too.
 */
import { canonicalize } from './canonical.js';
import type { AuditEvent } from './types.js';

export type MerkleHash = (value: string) => string;

/** Name of the layout above. A verifier must know it to reproduce a root. */
export const MERKLE_ALGORITHM = 'bipeur-merkle-v1';

const LEAF_PREFIX = 'L';
const NODE_PREFIX = 'N';

/** One step of an inclusion path: a sibling hash and which side it sits on. */
export interface MerkleStep {
  position: 'left' | 'right';
  hash: string;
}

/** Proof that one leaf belongs to one root. */
export interface MerkleProof {
  algorithm: string;
  /** Canonical leaf value — what the auditor hashes to start the fold. */
  leaf: string;
  /** 0-based position of the leaf in the log. */
  index: number;
  /** Number of leaves the root was computed over. */
  total: number;
  path: MerkleStep[];
}

export function merkleLeafHash(hash: MerkleHash, leaf: string): string {
  return hash(`${LEAF_PREFIX}${leaf}`);
}

export function merkleNodeHash(hash: MerkleHash, left: string, right: string): string {
  return hash(`${NODE_PREFIX}${left}${right}`);
}

export function merkleEmptyRoot(hash: MerkleHash): string {
  return hash(`${MERKLE_ALGORITHM}:empty`);
}

/** The leaf value of one audit event: its id first, because position is a fact. */
export function logLeaf(id: number, event: AuditEvent): string {
  return canonicalize({
    id,
    ts: event.ts,
    type: event.type,
    page_id: event.page_id ?? null,
    source_id: event.source_id ?? null,
    device_id: event.device_id ?? null,
    fingerprint: event.fingerprint ?? null,
    data: event.data ?? null,
  });
}

/** Layers of the tree, bottom first: layer 0 is the hashed leaves. */
function layers(leaves: string[], hash: MerkleHash): string[][] {
  const built: string[][] = [leaves.map((leaf) => merkleLeafHash(hash, leaf))];
  while (built[built.length - 1]!.length > 1) {
    const below = built[built.length - 1]!;
    const above: string[] = [];
    for (let i = 0; i < below.length; i += 2) {
      const left = below[i]!;
      const right = below[i + 1];
      above.push(right === undefined ? left : merkleNodeHash(hash, left, right));
    }
    built.push(above);
  }
  return built;
}

export function merkleRoot(leaves: string[], hash: MerkleHash): string {
  if (leaves.length === 0) return merkleEmptyRoot(hash);
  const all = layers(leaves, hash);
  return all[all.length - 1]![0]!;
}

/** Inclusion path of one leaf; null when the index is not in the log. */
export function merkleProof(leaves: string[], index: number, hash: MerkleHash): MerkleProof | null {
  if (leaves.length === 0) return null;
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) return null;
  const all = layers(leaves, hash);
  const path: MerkleStep[] = [];
  let at = index;
  for (const below of all.slice(0, -1)) {
    const sibling = at % 2 === 0 ? below[at + 1] : below[at - 1];
    if (sibling !== undefined) {
      path.push({ position: at % 2 === 0 ? 'right' : 'left', hash: sibling });
    }
    at = Math.floor(at / 2);
  }
  return { algorithm: MERKLE_ALGORITHM, leaf: leaves[index]!, index, total: leaves.length, path };
}

/** Folds a proof back onto a root. False means: not this log, or tampered. */
export function verifyMerkleProof(proof: MerkleProof, root: string, hash: MerkleHash): boolean {
  if (proof.algorithm !== MERKLE_ALGORITHM) return false;
  if (!Number.isInteger(proof.total) || proof.total < 1) return false;
  if (!Number.isInteger(proof.index) || proof.index < 0 || proof.index >= proof.total) return false;
  let current = merkleLeafHash(hash, proof.leaf);
  for (const step of proof.path) {
    current = step.position === 'left' ? merkleNodeHash(hash, step.hash, current) : merkleNodeHash(hash, current, step.hash);
  }
  return current === root;
}
