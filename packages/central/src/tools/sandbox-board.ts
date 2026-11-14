/**
 * The sandbox board generator (BIP-F-49): it runs the ten challenge attempts
 * through the real simulator and writes what the static site publishes.
 *
 *   pnpm --filter @bipeur/central sandbox:board
 *
 * The site is a GitHub Pages tree with no build-time network and no dependency
 * on the Central, so it cannot call the simulator itself. It ships the
 * simulator's output instead, and `packages/central/test/sandbox.test.ts`
 * fails the moment that committed output stops matching a fresh run — a
 * published line that is not the real one would be worse than no line at all.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseRules, type RulesFile } from '@bipeur/core';
import { sandboxBoard, type SandboxRow } from '../sandbox.js';

/** The shipped rules, as the artifact names them — a repo path, never a machine path. */
export const RULES_LABEL = '.bipeur/rules.yaml';

export const RULES_PATH = fileURLToPath(new URL(`../../../../${RULES_LABEL}`, import.meta.url));

/** The committed artifact the site renders from. */
export const OUTPUT_PATH = fileURLToPath(
  new URL('../../../../packages/site/src/sandbox-board.ts', import.meta.url),
);

/** What the site needs per row: the attempt, the verdict, never the request object. */
function artifactRows(rows: readonly SandboxRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    trick: row.trick,
    guard: row.guard,
    input: row.input,
    outcome: row.outcome,
    code: row.code,
    risk: row.risk,
    verb: row.verb,
    matched_by: row.matched_by,
    line: row.line,
    detail: row.detail,
    fingerprint: row.fingerprint,
    truncated: row.truncated,
  }));
}

/** The whole file, byte for byte — the test compares this text with what is on disk. */
export function boardSource(rows: readonly SandboxRow[], rulesLabel: string = RULES_LABEL): string {
  const body = artifactRows(rows)
    .map((row) => JSON.stringify(row, null, 2).split('\n').join('\n  '))
    .join(',\n  ');
  return `/**
 * GENERATED FILE — do not edit by hand (BIP-F-49).
 *
 * The ten "jailbreak the pager" attempts, evaluated by the Central simulator
 * (\`packages/central/src/sandbox.ts\`) against the shipped rules file
 * \`${rulesLabel}\`. Regenerate with: pnpm --filter @bipeur/central sandbox:board
 * A test fails as soon as this file stops matching a fresh run, so every line
 * the public sandbox shows is the real output of the real rules.
 */
export type SandboxOutcome = 'blocked' | 'paged' | 'silent';

export interface SandboxRow {
  readonly id: number;
  readonly name: string;
  readonly trick: string;
  readonly guard: string;
  readonly input: string;
  readonly outcome: SandboxOutcome;
  readonly code: number;
  readonly risk: 'green' | 'amber' | 'red';
  readonly verb: string;
  readonly matched_by: string;
  readonly line: string;
  readonly detail: readonly string[];
  readonly fingerprint: string;
  readonly truncated: boolean;
}

export const SANDBOX_RULES = '${rulesLabel}';

export const SANDBOX_ROWS: readonly SandboxRow[] = [
  ${body}
];
`;
}

/**
 * Read the shipped rules. A missing or broken file is a hard error here: a
 * sandbox built on the default rules would show amber for everything, and a
 * page that lies is worse than a page that is missing.
 */
export function loadRules(path: string = RULES_PATH): RulesFile {
  return parseRules(readFileSync(path, 'utf8'));
}

export function writeBoard(outputPath: string = OUTPUT_PATH, rulesPath: string = RULES_PATH): string {
  const source = boardSource(sandboxBoard(loadRules(rulesPath)));
  writeFileSync(outputPath, source, 'utf8');
  return outputPath;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  console.log(`sandbox board written: ${writeBoard()}`);
}
