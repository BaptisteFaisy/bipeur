#!/usr/bin/env node
/**
 * `bip-hook` — the executable Kiro calls from `.kiro/hooks/bipeur-approve.json`.
 * All the logic lives in `runHook`; this file only wires stdin, stderr and the
 * exit code, so the flow itself stays testable without a process.
 */
import { HOOK_USAGE, parseHookArgs } from './args.js';
import { runHook } from './run-hook.js';
import { readStdin } from './stdin.js';

const cli = parseHookArgs(process.argv.slice(2), process.env);

if (cli.help) {
  process.stdout.write(`${HOOK_USAGE}\n`);
  process.exitCode = 0;
} else {
  const result = await runHook(await readStdin(), cli);
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
