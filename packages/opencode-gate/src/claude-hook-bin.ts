#!/usr/bin/env node
/**
 * `bipeur-claude-gate` — the Claude Code `PreToolUse` hook.
 *
 * Claude Code runs this file on every tool call: the event JSON arrives on
 * stdin, the answer JSON leaves on stdout, and every diagnostic goes to
 * stderr so the JSON answer stays clean.
 *
 * The same hook is reachable by path — `node …/dist/claude-hook.js` — which is
 * what `claude/settings.hook.json` points at.
 */
import { main } from './claude-hook.js';

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`bipeur: the hook failed — ${message}\n`);
    process.exitCode = 2;
  });
