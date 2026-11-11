/**
 * The rules file (A.9), read by the hook *before* any network call so the fast
 * path stays under 50 ms (BIP-N-01).
 *
 * A missing or unreadable file is not an error: the defaults allow nothing, so
 * every tool becomes a page. That is the fail-closed direction.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_RULES, parseRules, type RulesFile } from '@bipeur/core';

export interface LoadedRules {
  rules: RulesFile;
  from: 'file' | 'defaults';
}

export function loadRules(path: string, log?: (line: string) => void): LoadedRules {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    log?.(`bip-hook: no rules file at ${path}, using the fail-closed defaults`);
    return { rules: DEFAULT_RULES, from: 'defaults' };
  }
  return { rules: parseRules(text), from: 'file' };
}
