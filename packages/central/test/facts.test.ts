/**
 * The facts of a proposal (BIP-F-40, BIP-F-47).
 *
 * The fingerprint is what the human signs. A proposal that changes the diff it
 * asks to apply, or the group it belongs to, is a DIFFERENT proposal: the
 * fingerprint must change with it, or a decision could be replayed on facts
 * the human never saw.
 */
import type { CreatePageRequest } from '@bipeur/core';
import { describe, expect, it } from 'vitest';
import { fingerprintOf } from '../src/compose.js';

const base: CreatePageRequest = {
  kind: 'tool',
  tool_name: 'Bash',
  command: 'git push origin main',
};

describe('the fingerprint of a proposal', () => {
  it('does not change when nothing changes', () => {
    expect(fingerprintOf(base)).toBe(fingerprintOf({ ...base }));
  });

  it('covers the diff the proposal carries', () => {
    const one = fingerprintOf({ ...base, diff: '+one line' });
    const two = fingerprintOf({ ...base, diff: '+another line' });
    expect(one).not.toBe(two);
    expect(one).toHaveLength(64);
  });

  it('covers the group the proposal belongs to', () => {
    const alone = fingerprintOf({ ...base, group: 'alpha' });
    const grouped = fingerprintOf({ ...base, group: 'beta' });
    expect(alone).not.toBe(grouped);
  });
});
