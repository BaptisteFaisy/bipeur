/**
 * Three-digit codes of A.6: family + nature, and the verbs each family allows.
 */
import { VERBS, type Risk, type Verb } from './types.js';

export interface CodeFamily {
  family: number;
  name: string;
  verbs: Verb[];
  /** Default risk applied when a rule does not state one. */
  defaultRisk: Risk;
}

export const CODE_FAMILIES: readonly CodeFamily[] = [
  { family: 1, name: 'terminal command', verbs: ['RUN'], defaultRisk: 'amber' },
  { family: 2, name: 'files out of scope', verbs: ['WRITE', 'DELETE'], defaultRisk: 'amber' },
  {
    family: 3,
    name: 'git and deployment',
    verbs: ['PUSH', 'MERGE', 'DEPLOY'],
    defaultRisk: 'amber',
  },
  { family: 4, name: 'external service', verbs: ['CALL', 'SEND'], defaultRisk: 'amber' },
  { family: 5, name: 'design choice', verbs: ['PICK'], defaultRisk: 'green' },
  { family: 6, name: 'budget', verbs: ['SPEND'], defaultRisk: 'amber' },
  { family: 7, name: 'missing access', verbs: ['NEED'], defaultRisk: 'amber' },
  { family: 9, name: 'stuck or incident', verbs: ['STUCK'], defaultRisk: 'red' },
] as const;

/** 911 is the emergency code: it always bypasses the attention budget. */
export const EMERGENCY_CODE = 911;

export function codeFamily(code: number): number {
  return Math.floor(code / 100);
}

export function familyOf(code: number): CodeFamily | undefined {
  return CODE_FAMILIES.find((f) => f.family === codeFamily(code));
}

export function isValidCode(code: number): boolean {
  return Number.isInteger(code) && code >= 100 && code <= 999 && familyOf(code) !== undefined;
}

/** Family 9 (stuck / incident) always gets through, like a red page. */
export function isUrgentCode(code: number): boolean {
  return codeFamily(code) === 9;
}

export function isKnownVerb(verb: string): verb is Verb {
  return (VERBS as readonly string[]).includes(verb);
}

/** True when the verb is allowed for the family of `code`. */
export function verbMatchesCode(verb: Verb, code: number): boolean {
  const family = familyOf(code);
  if (!family) return false;
  return family.verbs.includes(verb);
}

/** Pick the first verb of the family when the caller did not give a valid one. */
export function defaultVerbForCode(code: number): Verb {
  return familyOf(code)?.verbs[0] ?? 'NEED';
}

export function describeCode(code: number): string {
  const family = familyOf(code);
  if (!family) return `unknown code ${code}`;
  return `${code} ${family.name}`;
}
