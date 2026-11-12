/**
 * The Claude Code gate: the shell hook, tested through its pure core.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRules } from '@bipeur/core';
import { describe, expect, it, vi } from 'vitest';
import type { Verdict } from '../src/ask.js';
import { claudeToolOf, evaluateClaude } from '../src/claude-hook.js';

const RULES_PATH = fileURLToPath(new URL('../../../.bipeur/rules.yaml', import.meta.url));
const rules = parseRules(readFileSync(RULES_PATH, 'utf8'));

const deps = (
  ask: (question: string) => Promise<Verdict> = async () => 'approved',
  log: (line: string) => void = () => {},
) => ({ rules, ask, log });

describe('claudeToolOf', () => {
  it('maps the PreToolUse payload onto the gate input', () => {
    const payload = { tool_name: 'Bash', tool_input: { command: 'git push origin main' } };
    expect(claudeToolOf(payload)).toEqual({ tool: 'Bash', command: 'git push origin main', path: undefined });
  });
});

describe('evaluateClaude', () => {
  it('allows a command the rules pass, without asking', async () => {
    const ask = vi.fn(async () => 'approved' as const);
    const payload = { tool_name: 'Bash', tool_input: { command: 'pnpm test' } };
    const decision = await evaluateClaude(payload, deps(ask));
    expect(decision.permissionDecision).toBe('allow');
    expect(ask).not.toHaveBeenCalled();
  });

  it('denies outright the unbearable, without asking', async () => {
    const ask = vi.fn(async () => 'approved' as const);
    const payload = { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } };
    const decision = await evaluateClaude(payload, deps(ask));
    expect(decision.permissionDecision).toBe('deny');
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks the human before a push, and lets the answer win', async () => {
    const allow = await evaluateClaude(
      { tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
      deps(async () => 'approved'),
    );
    expect(allow.permissionDecision).toBe('allow');

    const deny = await evaluateClaude(
      { tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
      deps(async () => 'refused'),
    );
    expect(deny.permissionDecision).toBe('deny');
    expect(deny.permissionDecisionReason).toContain('refused');
  });
});