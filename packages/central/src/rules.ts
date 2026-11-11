/**
 * The rules file, shared with the hook (A.9). The Central reloads it when its
 * mtime changes, so an operator can retune the classification without a restart.
 * A missing or unreadable file is not fatal: the safe default pages everything
 * amber, never silently.
 */
import { readFileSync, statSync } from 'node:fs';
import { DEFAULT_RULES, parseRules, type RulesFile } from '@bipeur/core';

export interface RulesProvider {
  current(): RulesFile;
  source(): string;
}

export function readRulesFile(path: string): RulesFile {
  try {
    return parseRules(readFileSync(path, 'utf8'));
  } catch {
    return { ...DEFAULT_RULES };
  }
}

export class FileRules implements RulesProvider {
  private cached: RulesFile;
  private mtimeMs = -1;

  constructor(private readonly path: string) {
    this.cached = readRulesFile(path);
  }

  current(): RulesFile {
    const mtime = this.mtimeOf();
    if (mtime !== this.mtimeMs) {
      this.mtimeMs = mtime;
      this.cached = readRulesFile(this.path);
    }
    return this.cached;
  }

  source(): string {
    return this.path;
  }

  private mtimeOf(): number {
    try {
      return statSync(this.path).mtimeMs;
    } catch {
      return -1;
    }
  }
}

/** Used by the tests and the simulator: a fixed rules file, no I/O. */
export class StaticRules implements RulesProvider {
  constructor(private readonly rules: RulesFile) {}

  current(): RulesFile {
    return this.rules;
  }

  source(): string {
    return 'static';
  }
}
