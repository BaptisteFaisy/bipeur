#!/usr/bin/env node
/* global console, process */
/**
 * state-machine-guard's second half: regenerate the state graph printed in
 * README.md from `packages/core/src/states.ts`, so the diagram can never drift
 * from the transition table that the property test BIP-P-03 proves.
 *
 * Reads the TRANSITIONS literal with a small parser instead of importing the
 * module: no build step, no TypeScript loader, plain `node`. If the literal
 * stops being parseable the script exits 1 and writes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE = join(ROOT, 'packages', 'core', 'src', 'states.ts');
const README = join(ROOT, 'README.md');
const START = '<!-- state-graph:start -->';
const END = '<!-- state-graph:end -->';

/** `queued: ['delivered', 'expired'],` → ['queued', ['delivered', 'expired']] */
function parseRow(line) {
  const row = /^\s*([a-z]+):\s*\[(.*)\],?\s*$/.exec(line);
  if (!row) return null;
  const targets = [...row[2].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  return [row[1], targets];
}

export function parseTransitions(source) {
  const start = source.indexOf('const TRANSITIONS');
  if (start < 0) throw new Error('TRANSITIONS not found in states.ts');
  const end = source.indexOf('};', start);
  if (end < 0) throw new Error('TRANSITIONS literal is not closed');
  const rows = source
    .slice(start, end)
    .split('\n')
    .map(parseRow)
    .filter(Boolean);
  if (rows.length === 0) throw new Error('TRANSITIONS literal parsed to zero states');
  return rows;
}

/** Same output as `stateGraphDot()` in packages/core/src/states.ts. */
export function renderDot(rows) {
  const edges = rows.flatMap(([from, to]) => to.map((t) => `  ${from} -> ${t};`));
  return ['```dot', 'digraph page {', '  rankdir=LR;', ...edges, '}', '```'].join('\n');
}

function main() {
  const rows = parseTransitions(readFileSync(SOURCE, 'utf8'));
  const dot = renderDot(rows);
  const readme = readFileSync(README, 'utf8');
  const from = readme.indexOf(START);
  const to = readme.indexOf(END);
  if (from < 0 || to < from) {
    throw new Error(`README.md is missing the ${START} / ${END} markers`);
  }
  const next = `${readme.slice(0, from + START.length)}\n${dot}\n${readme.slice(to)}`;
  if (next === readme) {
    console.log(`state graph: unchanged (${rows.length} states)`);
    return;
  }
  writeFileSync(README, next);
  console.log(`state graph: rewritten from states.ts (${rows.length} states)`);
}

try {
  main();
} catch (error) {
  console.error(`state graph: ${error.message}`);
  process.exit(1);
}
