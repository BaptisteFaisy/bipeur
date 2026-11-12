/**
 * The Claude Code gate: the same rules as the Central, the same pager.
 *
 * Claude Code runs this through a `PreToolUse` hook: the tool event arrives on
 * stdin as JSON, the hook answers on stdout. The decision is computed from the
 * command itself — never from what the agent says — with the exact rules of
 * `.bipeur/rules.yaml`.
 *
 *   { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *       "permissionDecision": "allow" | "deny", "permissionDecisionReason": "…" } }
 */
import type { RulesFile } from '@bipeur/core';
import type { Verdict } from './ask.js';
import { decide, questionFor, type GateInput } from './gate.js';
import { pickCommand, pickPath, pickTool } from './plugin.js';

export interface ClaudeDecision {
  permissionDecision: 'allow' | 'deny';
  permissionDecisionReason?: string;
}

export interface ClaudeHookDeps {
  rules: RulesFile;
  ask: (question: string) => Promise<Verdict>;
  log: (line: string) => void;
}

/** The tool call of Claude Code mapped onto the gate's one input shape. */
export function claudeToolOf(payload: unknown): GateInput {
  return {
    tool: pickTool(payload),
    command: pickCommand(payload),
    path: pickPath(payload),
  };
}

/**
 * The gate's answer to a tool call, in Claude Code's vocabulary.
 * `allow` when the rules pass or the human said yes; `deny` otherwise.
 */
export async function evaluateClaude(payload: unknown, deps: ClaudeHookDeps): Promise<ClaudeDecision> {
  const input = claudeToolOf(payload);
  if (input.command === undefined && input.path === undefined) {
    return { permissionDecision: 'allow' };
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
  return {
    permissionDecision: 'deny',
    permissionDecisionReason:
      verdict === 'expired'
        ? `The human did not answer "${question}" in time.`
        : `The human refused "${question}". Do not retry it or work around it.`,
  };
}