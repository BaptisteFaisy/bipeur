#!/usr/bin/env node
/**
 * `bipeur-claude-gate` — the Claude Code `PreToolUse` hook.
 *
 * Configure it once in `.claude/settings.json`:
 *
 *   "hooks": { "PreToolUse": [
 *     { "matcher": "Bash|Edit|Write", "hooks": [
 *         { "type": "command", "command": "node /…/packages/opencode-gate/dist/claude-hook.js" }
 *     ]}
 *   ]}
 *
 * The hook reads the tool event from stdin and answers on stdout — logs go to
 * stderr so the JSON stays clean.
 */
import { DEFAULT_RULES, parseRules } from '@bipeur/core';
import { readFileSync } from 'node:fs';
import { askHuman } from './ask.js';
import { evaluateClaude } from './claude-hook.js';

function loadRules(): ReturnType<typeof parseRules> {
  const explicit = process.env.BIPEUR_RULES;
  if (explicit) {
    try {
      return parseRules(readFileSync(explicit, 'utf8'));
    } catch {
      // a broken rules file must not open the gate
    }
  }
  return DEFAULT_RULES;
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const decision = await evaluateClaude(payload, {
    rules: loadRules(),
    ask: (question) => askHuman({ question }),
    log: (line) => process.stderr.write(`${line}\n`),
  });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } }));
}

main().catch((error: unknown) => {
  process.stderr.write(`bipeur-claude-gate: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    }),
  );
  process.exitCode = 1;
});