/**
 * Grouped pages (BIP-F-47).
 *
 * Three pages about one event are three interruptions for one decision. Noise
 * is the enemy n°1 of this product, and the shared attention budget is the
 * constraint n°1: grouping is what makes both survivable.
 *
 * The hard part is not the screen, it is the signature. BIP-F-18 says a
 * decision can never apply to another page — so propagating an approval signed
 * on one payload to the other payloads is exactly the lie the fingerprint
 * exists to prevent. The group is therefore closed the other way round: the
 * LEADER's fingerprint covers the whole block, every member's fingerprint
 * included. The human reads the list on the leader's screens, signs the list,
 * and one signature covers exactly what was displayed. Nothing is inherited,
 * nothing is implied.
 *
 * Two rules keep that honest:
 *
 * - a leader is re-signed only while it is **pending and unread**. Once a human
 *   has laid eyes on it, what they saw is fixed: the incoming page opens its
 *   own group and rings. We never change a page someone has already read.
 * - a member never rings and never spends the budget. It is a fact attached to
 *   a question, not a second question.
 */
import { DETAIL_SCREENS_MAX, groupDigest, groupNote, isGroupMember, LINE_MAX } from '@bipeur/core';
import { fingerprint } from '@bipeur/core/node';
import type { CentralContext } from './context.js';
import type { DecisionRow, PageRow } from './store/types.js';
import { streamFilterFor } from './targeting.js';

export interface GroupAttachment {
  /** The page as it should be written: a member, or a new leader. */
  page: PageRow;
  /** The leader this page hangs on; null when the page opens the group. */
  leader: PageRow | null;
  /** The leader after the block was re-signed, when it was. */
  updatedLeader: PageRow | null;
}

/**
 * Attaches a page to its group, or opens a group.
 *
 * Called before the page is written: a member must never be delivered, and the
 * leader must carry the list before the pager rings.
 */
export function attachGroup(ctx: CentralContext, page: PageRow, now: number): GroupAttachment {
  if (!page.group_key) return { page, leader: null, updatedLeader: null };
  const leader = ctx.store.pendingGroupLeader(page.source_id, page.group_key, now);
  if (!leader) return { page, leader: null, updatedLeader: null };
  if (leader.read_at !== null || leader.state !== 'delivered') {
    // The human has seen it, or it is not on a screen yet: the block is closed.
    return { page, leader: null, updatedLeader: null };
  }
  const members = [...ctx.store.groupMembers(leader.id), page];
  const digest = groupDigest(leader.payload_sha256, members.map((member) => member.payload_sha256));
  const signed = { ...leader, payload_sha256: fingerprint(digest) };
  const line = reTag(leader.line, signed.payload_sha256);
  const updated: PageRow = {
    ...signed,
    line,
    detail: leaderDetail(leader, members),
  };
  ctx.store.transaction(() => {
    ctx.store.updatePage(leader.id, {
      payload_sha256: updated.payload_sha256,
      line: updated.line,
      detail: updated.detail,
    });
    ctx.store.updatePage(page.id, { group_leader_id: leader.id });
    ctx.audit.append({
      type: 'page.grouped',
      page_id: page.id,
      source_id: page.source_id,
      fingerprint: page.payload_sha256,
      data: { leader_id: leader.id, members: members.length, group: page.group_key },
    });
  });
  return {
    page: { ...page, group_leader_id: leader.id },
    leader,
    updatedLeader: updated,
  };
}

/**
 * The leader's screens, with the WHOLE block listed: the human signs the list,
 * so no member may be dropped and no line may be cut to fit.
 *
 * The note gets a screen of its own, and every block screen reserves room for
 * its label BEFORE packing: prefixing after would eat the end of the last line
 * of each screen, which is the member a human would never see.
 *
 * A block that cannot fit is refused, not silently truncated: signing an
 * incomplete list is exactly the lie this feature exists to prevent. The page
 * then rings on its own, which is honest noise.
 */
export function leaderDetail(leader: PageRow, members: readonly PageRow[]): string[] {
  const own = leader.detail.filter((screen) => !screen.startsWith('GROUP'));
  const note = groupNote(members.length);
  const packed = packMembers(members.map((member) => member.line), GROUP_SCREENS);
  if (packed === null) return own;
  const total = packed.length + (note.length > 0 ? 1 : 0);
  const screens: string[] = [];
  if (note.length > 0) screens.push(`${groupLabel(1, total)} ${note}`);
  packed.forEach((body, index) => {
    screens.push(`${groupLabel(index + 1 + (note.length > 0 ? 1 : 0), total)} ${body}`);
  });
  return [...screens, ...own].slice(0, DETAIL_SCREENS_MAX);
}

/** How many screens the block lines may take, the note and the leader aside. */
const GROUP_SCREENS = 4;

/** The label of one block screen: `GROUP 2/3:`, so the order is never lost. */
function groupLabel(index: number, total: number): string {
  return total > 1 ? `GROUP ${index}/${total}:` : 'GROUP:';
}

/**
 * Packs whole member lines into at most `screens` screens of the LCD, the
 * label reserved out of the 80 characters. Null when they do not fit.
 */
function packMembers(lines: readonly string[], screens: number): string[] | null {
  const budget = DETAIL_SCREENS_MAX > 0 ? LINE_MAX - LABEL_RESERVE : LINE_MAX;
  const packed: string[] = [];
  let current = '';
  for (const line of lines) {
    const candidate = current.length === 0 ? line : `${current} | ${line}`;
    if (candidate.length <= budget) {
      current = candidate;
      continue;
    }
    if (current.length > 0) packed.push(current);
    if (line.length > budget) return null;
    current = line;
  }
  if (current.length > 0) packed.push(current);
  return packed.length <= screens ? packed : null;
}

/**
 * The widest label a block screen can carry: `GROUP 12/12: ` is 13 characters.
 * Reserving the worst case keeps the packing exact for every block size.
 */
const LABEL_RESERVE = 13;

/**
 * Replaces the fingerprint tag of a line, keeping the 80-character budget and
 * the head intact: the tag is the last five characters by construction (A.6).
 */
function reTag(line: string, fingerprintValue: string): string {
  const tag = `#${fingerprintValue.slice(0, 4)}`;
  if (line.length < 5) return `${line} ${tag}`.slice(0, 80);
  return `${line.slice(0, line.length - 5)}${tag}`.slice(0, 80);
}

/** A member never rings: it is answered through its leader's single decision. */
export function isMember(page: PageRow): boolean {
  return isGroupMember(page.group_leader_id);
}

/**
 * The leader of a block, when a page belongs to one. The decision of a member
 * is never taken alone: it is the leader's decision, and the audit says which.
 */
export function leaderOf(ctx: CentralContext, page: PageRow): PageRow | null {
  if (!page.group_leader_id) return null;
  return ctx.store.pageById(page.group_leader_id);
}

/** How many pages one block holds, leader included: what the budget counts. */
export function blockSize(ctx: CentralContext, leader: PageRow): number {
  return ctx.store.groupMembers(leader.id).length + 1;
}

/**
 * The decision that answers this page: its own when it leads, the leader's when
 * it is a member. This is not an inherited signature — the leader's fingerprint
 * covers the whole block (BIP-F-47), so the one signature it carries *is* the
 * answer to every page of the group, and the audit says which block it came
 * from.
 */
export function effectiveDecision(ctx: CentralContext, page: PageRow): DecisionRow | null {
  const own = ctx.store.decisionByPage(page.id);
  if (own) return own;
  const leader = leaderOf(ctx, page);
  return leader ? ctx.store.decisionByPage(leader.id) : null;
}

/**
 * When a leader is decided, every member of the block settles with it and the
 * fact is journalled per member: an agent waiting on a member page must be
 * woken, and the journal must say that the verdict came from the block.
 */
export function settleMembers(ctx: CentralContext, leader: PageRow, decision: DecisionRow, at: number): void {
  for (const member of ctx.store.groupMembers(leader.id)) {
    if (member.state === 'decided' || member.state === 'expired' || member.state === 'cancelled') continue;
    ctx.store.updatePage(member.id, {
      state: 'decided',
      delivered_at: member.delivered_at ?? at,
    });
    ctx.audit.append({
      type: 'page.decided',
      page_id: member.id,
      source_id: member.source_id,
      device_id: decision.device_id,
      fingerprint: member.payload_sha256,
      data: { verdict: decision.verdict, choice: decision.choice_code, via_group: leader.id },
    });
    ctx.hub.broadcast(
      { type: 'page.decided', page_id: member.id, verdict: decision.verdict },
      streamFilterFor(ctx, member),
    );
  }
}
