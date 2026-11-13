#!/usr/bin/env node
/**
 * The Claude Code adapter: one hook, the same gate.
 *
 * Claude Code runs a `PreToolUse` hook before every tool call. The event arrives as
 * JSON on stdin (`{hook_event_name, tool_name, tool_input, cwd, …}`), and the
 * hook answers on stdout with a JSON object — nothing else, because stdout is
 * the channel Claude Code parses, and any stray byte there makes the answer ignored.
 * Diagnostics therefore go to stderr, always.
 *
 * The decision is not Claude Code-specific: `decide()` from `gate.ts` classifies the
 * command with the shared rules of the Central, exactly like the opencode
 * plugin. Only the transport differs, so only the transport lives here.
 *
 * Answer format, from the Claude Code hooks reference (`PreToolUse decision control`):
 *
 *   allow → {"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *             "permissionDecision":"allow","permissionDecisionReason":"…"}}
 *   deny  → {"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *             "permissionDecision":"deny","permissionDecisionReason":"…"}}
 *
 * The older top-level form — `{"decision":"approve"}` / `{"decision":"block",
 * "reason":"…"}` — still works for this event and maps to `allow` / `deny`,
 * but it is deprecated for PreToolUse; we emit the documented current form.
 *
 * Silence (exit 0, no output) is not an approval: Claude Code then runs its own
 * permission flow, which is the honest answer when the gate has no opinion.
 *
 * The decision is factored out (`evaluateClaude`) and every side of it is
 * injected — the rules, the pager — so the whole gate is testable without a
 * live stdin/stdout.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RulesFile } from '@bipeur/core';
import type { Verdict } from './ask.js';
import { askHuman } from './ask.js';
import { decide, questionFor, type GateInput } from './gate.js';
import { loadRules, pickCommand, pickPath, pickTool } from './plugin.js';

/** The gate's answer to one tool call, in Claude Code's vocabulary. */
export interface ClaudeDecision {
  permissionDecision: 'allow' | 'deny';
  permissionDecisionReason?: string;
}

/** Everything `evaluateClaude` needs from the outside world, injected. */
export interface ClaudeHookDeps {
  /** The rules of the project (`.bipeur/rules.yaml`), already parsed. */
  rules: RulesFile;
  /** The pager. In production `askHuman`; in tests a recorded function. */
  ask: (question: string) => Promise<Verdict>;
  /** Diagnostics, on stderr only. */
  log: (line: string) => void;
}

/** The JSON object Claude Code reads on stdout: the whole answer, and nothing else. */
export interface ClaudeHookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason: string;
  };
}

/** The tool name the rules know an MCP call by. */
const MCP_TOOL = '@mcp';

/**
 * The tool call of Claude Code, read defensively: the event JSON changes shape
 * between versions, so the command and the path are looked for where they may
 * sit, and an event that carries neither leaves the gate with no opinion.
 */
export function claudeRequestOf(payload: unknown): GateInput | undefined {
  const tool = pickTool(payload);
  if (tool !== undefined && tool.startsWith('mcp__')) return { tool: MCP_TOOL };
  const command = pickCommand(payload);
  if (command !== undefined) return { tool, command };
  const path = pickPath(payload);
  if (path !== undefined) return { tool, path };
  return undefined;
}

/**
 * The gate's answer to a tool call: `allow` when the rules pass, `deny` when
 * the rules refuse or the human refused. `null` when the gate has no opinion
 * (nothing to classify) — it then says nothing, and Claude Code runs its own
 * permission flow.
 */
export async function evaluateClaude(
  payload: unknown,
  deps: ClaudeHookDeps,
): Promise<ClaudeDecision | null> {
  const input = claudeRequestOf(payload);
  if (input === undefined) {
    deps.log('bipeur: nothing to classify in this event — no decision');
    return null;
  }
  const decision = decide(input, deps.rules);
  if (decision.outcome === 'allow') return { permissionDecision: 'allow' };
  if (decision.outcome === 'deny') {
    return {
      permissionDecision: 'deny',
      permissionDecisionReason: `Beeper refused this action (${decision.reason}): the rules deny it outright.`,
    };
  }
  const question = questionFor(input, decision);
  deps.log(`bipeur: asking the human — ${question} (${decision.risk}, ${decision.reason})`);
  const verdict = await deps.ask(question);
  if (verdict === 'approved') {
    deps.log(`bipeur: the human said yes — ${question}`);
    return { permissionDecision: 'allow' };
  }
  const why = verdict === 'expired' ? 'did not answer in time' : 'refused';
  return {
    permissionDecision: 'deny',
    permissionDecisionReason:
      `Beeper refused this action (${decision.reason}): the human ${why} "${question}". ` +
      'Do not retry it or work around it.',
  };
}

/** The JSON object that goes to stdout: the decision, in Claude Code's shape. */
export function claudeHookOutput(decision: ClaudeDecision): ClaudeHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.permissionDecision,
      permissionDecisionReason: decision.permissionDecisionReason ?? '',
    },
  };
}

/** The bytes for stdout: the JSON answer, or nothing at all. */
export function serializeClaudeOutput(decision: ClaudeDecision | null): string {
  return decision === null ? '' : `${JSON.stringify(claudeHookOutput(decision))}\n`;
}

/** The rules that apply here: the project of the event, then ours. */
function rulesFor(payload: unknown): RulesFile {
  const cwd = (payload as { cwd?: unknown }).cwd;
  const directories = [cwd, process.cwd()].filter(
    (directory): directory is string => typeof directory === 'string' && directory.length > 0,
  );
  return loadRules(directories);
}

/** Everything the caller piped in. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

/** The event Claude Code sent, read defensively — never a crash on a weird shape. */
function parseEvent(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Read the event, ask the gate, write the answer. The hook itself. */
export async function main(): Promise<number> {
  const payload = parseEvent(await readStdin());
  const log = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };
  const decision = await evaluateClaude(payload, {
    rules: rulesFor(payload),
    ask: (question: string) =>
      askHuman({
        question,
        url: process.env.BIPEUR_URL,
        token: process.env.BIPEUR_TOKEN,
        onOutput: (line: string) => log(`bipeur: ${line}`),
      }),
    log,
  });
  const answer = serializeClaudeOutput(decision);
  if (answer.length > 0) process.stdout.write(answer);
  return 0;
}

/** True when this file is the program that was started, not a library. */
export function isMainModule(moduleUrl: string, argv: readonly string[]): boolean {
  const entry = argv[1];
  if (entry === undefined) return false;
  if (pathToFileURL(entry).href === moduleUrl) return true;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// Started as the program (`node dist/claude-hook.js`): run the hook. Imported
// as a library — by the tests, or by another adapter — nothing happens here.
if (isMainModule(import.meta.url, process.argv)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`bipeur: the hook failed — ${message}\n`);
      process.exitCode = 2;
    });
}
