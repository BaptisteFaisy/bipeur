/**
 * The Claude Code gate: the shell hook, tested through its pure core.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRules } from '@bipeur/core';
import { describe, expect, it, vi } from 'vitest';
import type { Verdict } from '../src/ask.js';
import { claudeRequestOf, evaluateClaude } from '../src/claude-hook.js';

const RULES_PATH = fileURLToPath(new URL('../../../.bipeur/rules.yaml', import.meta.url));
const rules = parseRules(readFileSync(RULES_PATH, 'utf8'));

const deps = (
  ask: (question: string) => Promise<Verdict> = async () => 'approved',
  log: (line: string) => void = () => {},
) => ({ rules, ask, log });

describe('claudeRequestOf', () => {
  it('maps the PreToolUse payload onto the gate input', () => {
    const payload = { tool_name: 'Bash', tool_input: { command: 'git push origin main' } };
    expect(claudeRequestOf(payload)).toEqual({ tool: 'Bash', command: 'git push origin main' });
  });

  it('reads the path of a file tool', () => {
    const payload = { tool_name: 'Write', tool_input: { file_path: '/tmp/x.txt' } };
    expect(claudeRequestOf(payload)).toEqual({ tool: 'Write', path: '/tmp/x.txt' });
  });

  it('names an MCP call the way the rules know it', () => {
    const payload = { tool_name: 'mcp__github__create_issue', tool_input: {} };
    expect(claudeRequestOf(payload)).toEqual({ tool: '@mcp' });
  });

  it('has no opinion when the event carries nothing to classify', () => {
    expect(claudeRequestOf({ tool_name: 'Read', tool_input: {} })).toBeUndefined();
    expect(claudeRequestOf({})).toBeUndefined();
  });
});

describe('evaluateClaude', () => {
  it('allows a command the rules pass, without asking', async () => {
    const ask = vi.fn(async () => 'approved' as const);
    const payload = { tool_name: 'Bash', tool_input: { command: 'pnpm test' } };
    const decision = await evaluateClaude(payload, deps(ask));
    expect(decision?.permissionDecision).toBe('allow');
    expect(ask).not.toHaveBeenCalled();
  });

  it('denies outright the unbearable, without asking', async () => {
    const ask = vi.fn(async () => 'approved' as const);
    const payload = { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } };
    const decision = await evaluateClaude(payload, deps(ask));
    expect(decision?.permissionDecision).toBe('deny');
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks the human before a push, and lets the answer win', async () => {
    const allow = await evaluateClaude(
      { tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
      deps(async () => 'approved'),
    );
    expect(allow?.permissionDecision).toBe('allow');

    const deny = await evaluateClaude(
      { tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
      deps(async () => 'refused'),
    );
    expect(deny?.permissionDecision).toBe('deny');
    expect(deny?.permissionDecisionReason).toContain('refused');
  });

  it('says nothing when the event carries nothing to classify', async () => {
    const ask = vi.fn(async () => 'approved' as const);
    const decision = await evaluateClaude({ tool_name: 'Read', tool_input: {} }, deps(ask));
    expect(decision).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});
