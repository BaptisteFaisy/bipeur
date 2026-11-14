/**
 * BIP-F-47 — the arithmetic of a block: one interruption for one decision, and
 * a budget projection a human can read before tapping.
 *
 * The digest is the security part: it covers the leader's own facts AND every
 * member's, so one signature is the answer to the whole block and nothing is
 * inherited silently. The projection is the attention part: a page that costs
 * 4 of the 6 remaining is a different decision from a page that costs 1 of 6.
 */
import { describe, expect, it } from 'vitest';
import {
  groupDigest,
  groupNote,
  isGroupMember,
  projectBudget,
  projectionNote,
} from '../src/group.js';
import { LINE_MAX } from '../src/ascii.js';

describe('the digest of a block', () => {
  it('covers the leader and every member', () => {
    const digest = groupDigest('aaa', ['bbb', 'ccc']);
    expect(digest).toContain('aaa');
    expect(digest).toContain('bbb');
    expect(digest).toContain('ccc');
  });

  it('does not depend on the order members arrived in', () => {
    // The block is a set of facts: the same members must produce the same
    // digest, or two identical blocks would carry two fingerprints.
    expect(groupDigest('aaa', ['bbb', 'ccc'])).toBe(groupDigest('aaa', ['ccc', 'bbb']));
  });

  it('changes when a member joins or leaves', () => {
    const two = groupDigest('aaa', ['bbb']);
    expect(two).not.toBe(groupDigest('aaa', ['bbb', 'ccc']));
    expect(two).not.toBe(groupDigest('aaa', []));
  });

  it('changes when the leader changes', () => {
    expect(groupDigest('aaa', ['bbb'])).not.toBe(groupDigest('zzz', ['bbb']));
  });

  it('is canonical: the same block, the same bytes', () => {
    expect(groupDigest('aaa', ['bbb'])).toBe(groupDigest('aaa', ['bbb']));
  });
});

describe('the note of a block', () => {
  it('says how many pages hang on the leader', () => {
    expect(groupNote(0)).toBe('');
    expect(groupNote(1)).toBe('+1 linked page in this block');
    expect(groupNote(3)).toBe('+3 linked pages in this block');
  });
});

describe('the projection of the budget', () => {
  it('says what is left after the page', () => {
    const projection = projectBudget(2, 6, 1);
    expect(projection.remaining).toBe(3);
    expect(projection.would_be_held).toBe(false);
  });

  it('says when the page would be held', () => {
    const projection = projectBudget(6, 6, 1);
    expect(projection.remaining).toBe(0);
    expect(projection.would_be_held).toBe(true);
  });

  it('never goes negative on a free page', () => {
    // A receipt, a group member, a red page: cost 0, whatever the window.
    expect(projectBudget(6, 6, 0).remaining).toBe(0);
    expect(projectBudget(6, 6, 0).would_be_held).toBe(false);
  });

  it('fits one 80-character screen, and says the right thing', () => {
    const note = projectionNote(projectBudget(2, 6, 1));
    expect(note.length).toBeLessThanOrEqual(LINE_MAX);
    expect(note).toContain('BUDGET:');
    expect(note).toContain('3 left after it');
    const held = projectionNote(projectBudget(6, 6, 1));
    expect(held).toContain('HELD');
    expect(held.length).toBeLessThanOrEqual(LINE_MAX);
  });

  it('marks a member as belonging to a block', () => {
    expect(isGroupMember(null)).toBe(false);
    expect(isGroupMember('pg_leader')).toBe(true);
  });
});
