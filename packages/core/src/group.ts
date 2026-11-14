/**
 * Grouped pages (BIP-F-47).
 *
 * Three pages about one event are three interruptions for one decision, and
 * noise is the enemy n°1 of this product. A group is how Beeper says: *these
 * pages are the same question, asked in pieces*.
 *
 * The hard part is not the UI, it is the signature. BIP-F-18 says a decision
 * can never apply to another page — and propagating an approval signed on one
 * payload to the other payloads is exactly the lie the fingerprint exists to
 * prevent. So the group is closed the other way round: the LEADER's fingerprint
 * covers the whole group, every member's fingerprint included. The human reads
 * the list on the leader's screens, signs the list, and one signature covers
 * exactly what was displayed. Nothing is inherited, nothing is implied.
 */
import { canonicalize } from './canonical.js';
import { LINE_MAX } from './ascii.js';
import { truncateSubject } from './line.js';

/** The digest a group leader is signed on: its own facts plus every member. */
export function groupDigest(leaderFingerprint: string, memberFingerprints: readonly string[]): string {
  return canonicalize({
    v: 1,
    leader: leaderFingerprint,
    members: [...memberFingerprints].sort(),
  });
}

/**
 * The note the leader carries: how many pages this block holds. It is composed
 * inside the 80-character budget, and it never hides the count.
 */
export function groupNote(members: number): string {
  if (members <= 0) return '';
  const plural = members === 1 ? 'page' : 'pages';
  return `+${members} linked ${plural} in this block`;
}

/**
 * The projection of the attention budget (BIP-F-47): what this page will cost,
 * out of what is left. A page that costs 4 of the 6 remaining is a different
 * decision from a page that costs 1 of 6, and the human must see it BEFORE
 * tapping.
 */
export interface BudgetProjection {
  /** Slots this page will take: 0 when it is free (a group member, a receipt). */
  cost: number;
  /** Slots already used in the window. */
  in_use: number;
  /** Slots the window allows. */
  per_hour: number;
  /** Slots left after this page, never negative. */
  remaining: number;
  /** True when the page would not fit and would be held instead. */
  would_be_held: boolean;
}

export function projectBudget(inUse: number, perHour: number, cost: number): BudgetProjection {
  const remaining = Math.max(0, perHour - inUse - cost);
  return {
    cost,
    in_use: inUse,
    per_hour: perHour,
    remaining,
    would_be_held: inUse + cost > perHour,
  };
}

/** The projection as the pager reads it, inside one 80-character screen. */
export function projectionNote(projection: BudgetProjection): string {
  const head = `BUDGET: this page costs ${projection.cost} of ${projection.per_hour} per hour`;
  const tail = projection.would_be_held
    ? ` — ${projection.in_use} already spent, it would be HELD`
    : ` — ${projection.remaining} left after it`;
  return truncateSubject(`${head}${tail}`, LINE_MAX);
}

/** Is this page a member of a group (it rings only through its leader)? */
export function isGroupMember(leaderId: string | null): boolean {
  return leaderId !== null;
}
