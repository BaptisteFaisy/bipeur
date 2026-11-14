/**
 * The vocabulary the ten ideas share (BIP-F-40 to BIP-F-49).
 *
 * The foundation only declares: the verbs and the code family of the proof of
 * execution, the audit events the new features append, and the two facts a
 * proposal may now carry — the diff and the group key.
 */
import { describe, expect, it } from 'vitest';
import {
  CODE_FAMILIES,
  defaultVerbForCode,
  isKnownVerb,
  isValidCode,
  verbMatchesCode,
} from '../src/codes.js';
import { VERBS, type AuditEventType } from '../src/types.js';

describe('the code family of the proof of execution', () => {
  it('gives the eight hundred its own family, with the verb DONE', () => {
    const family = CODE_FAMILIES.find((f) => f.family === 8);
    expect(family).toBeDefined();
    expect(family?.verbs).toEqual(['DONE']);
    expect(family?.defaultRisk).toBe('green');
  });

  it('accepts a code of that family and gives it the verb DONE', () => {
    expect(isValidCode(810)).toBe(true);
    expect(defaultVerbForCode(810)).toBe('DONE');
    expect(verbMatchesCode('DONE', 810)).toBe(true);
    expect(verbMatchesCode('RUN', 810)).toBe(false);
  });

  it('keeps DONE out of the other families', () => {
    for (const family of CODE_FAMILIES.filter((f) => f.family !== 8)) {
      expect(family.verbs).not.toContain('DONE');
    }
  });

  it('declares the verb DONE once, in the closed list', () => {
    expect(VERBS.filter((v) => v === 'DONE')).toHaveLength(1);
    expect(isKnownVerb('DONE')).toBe(true);
  });
});

describe('the audit events of the ten ideas', () => {
  it('names every event a new feature has to append', () => {
    // The value of this test is at compile time: if a name leaves the union,
    // `tsc` refuses the file.
    const events: AuditEventType[] = [
      'page.closed',
      'closure.rejected',
      'page.shadowed',
      'page.canary',
      'transparency.checkpoint',
    ];
    expect(events).toHaveLength(5);
  });

  it('refuses an event nobody declared', () => {
    // @ts-expect-error — an unknown event type must not compile.
    const bogus: AuditEventType = 'page.teleported';
    expect(bogus).toBe('page.teleported');
  });
});
