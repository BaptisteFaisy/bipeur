/**
 * The line of a page is the contract of A.6: at most 80 printable ASCII
 * characters, `CODE POSTE VERBE objet #hhhh`. Every scenario checks it.
 */
import { expect } from '@playwright/test';

export const LINE_MAX = 80;

/** The four hex characters of the fingerprint, at the end of the line. */
export function shortHash(line: string): string {
  return line.slice(-4);
}

/** Asserts the format of A.6 on a composed line. */
export function expectValidLine(line: string): void {
  expect(line.length).toBeLessThanOrEqual(LINE_MAX);
  expect(line).toMatch(/^[\x20-\x7e]+$/);
  expect(line).toMatch(/^[0-9]{3} /);
  expect(line).toMatch(/#[0-9a-f]{4}$/);
}

/** Asserts that the short hash of the line is the short hash of the fingerprint. */
export function expectFingerprintInLine(line: string, fingerprint: string): void {
  expect(shortHash(line)).toBe(fingerprint.slice(0, 4));
}
