/**
 * The opencode plugin: every tool call the agent makes passes through the
 * gate before it runs.
 *
 * opencode calls the plugin with the tool and its arguments; the plugin
 * classifies them with the shared rules (`.bipeur/rules.yaml`) and, when the
 * rules say `page`, opens a real page on the pager and waits for the human.
 * The agent only continues if the human says yes — otherwise the tool call
 * fails and the agent has to adapt.
 *
 * The plugin is deliberately shape-tolerant: opencode has changed the exact
 * payload of `tool.execute.before` between versions, so the command and the
 * path are looked for in every place they may sit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RULES, parseRules, type RulesFile } from '@bipeur/core';
import { askHuman, type Verdict } from './ask.js';
import { decide, questionFor, type GateInput } from './gate.js';

/** The rules of the project: `BIPEUR_RULES`, then `.bipeur/rules.yaml`. */
export function loadRules(directories: readonly string[]): RulesFile {
  const explicit = process.env.BIPEUR_RULES;
  if (explicit) {
    try {
      return parseRules(readFileSync(explicit, 'utf8'));
    } catch {
      // A broken rules file must not open the gate: fall back to the defaults.
    }
  }
  for (const directory of directories) {
    try {
      return parseRules(readFileSync(join(directory, '.bipeur', 'rules.yaml'), 'utf8'));
    } catch {
      // Not this directory: try the next one.
    }
  }
  return DEFAULT_RULES;
}

/** The command the agent wants to run, wherever opencode carries it. */
export function pickCommand(...payloads: unknown[]): string | undefined {
  for (const payload of payloads) {
    const found = findString(payload, ['command', 'cmd']);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The path the agent wants to write, wherever opencode or Claude carries it. */
export function pickPath(...payloads: unknown[]): string | undefined {
  for (const payload of payloads) {
    const found = findString(payload, ['filePath', 'file_path', 'path', 'file']);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The name of the tool, wherever opencode or Claude Code carries it. */
export function pickTool(...payloads: unknown[]): string | undefined {
  for (const payload of payloads) {
    const found = findString(payload, ['tool', 'tool_name', 'toolName', 'name']);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findString(value: unknown, keys: readonly string[], depth = 0): string | undefined {
  if (depth > 4 || typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  for (const nested of Object.values(record)) {
    const found = findString(nested, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** What the plugin needs to know about the world it runs in. */
export interface GateEnvironment {
  location?: { directory?: string; project?: { directory?: string } };
  worktree?: string;
  directory?: string;
  project?: { directory?: string };
}

/** The tool hook of opencode: the one that runs before every tool call. */
export interface ToolHookContext {
  tool: { hook(name: string, callback: (event: unknown) => Promise<void> | void): Promise<unknown> };
}

function directoriesOf(env: GateEnvironment): string[] {
  return [
    env.location?.directory,
    env.location?.project?.directory,
    env.directory,
    env.project?.directory,
    env.worktree,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * The plugin opencode loads.
 *
 * opencode v2 wants a default export with an id and a `setup` function; the
 * setup registers the hook that runs before every tool call.
 */
export const BipeurGate = {
  id: 'bipeur-gate',
  async setup(ctx: GateEnvironment & ToolHookContext): Promise<void> {
    const rules = loadRules(directoriesOf(ctx));
    await ctx.tool.hook('execute.before', async (event: unknown) => {
      const tool = pickTool(event);
      const command = pickCommand(event);
      const path = pickPath(event);
      if (command === undefined && path === undefined) return;

      const request: GateInput = { tool, command, path };
      const decision = decide(request, rules);
      if (decision.outcome === 'allow') return;
      if (decision.outcome === 'deny') {
        throw new Error(
          `Beeper refused this action (${decision.reason}): the rules deny it outright. ` +
            'Do not try to work around it.',
        );
      }

      const question = questionFor(request, decision);
      process.stderr.write(
        `bipeur: asking the human — ${question} (${decision.risk}, ${decision.reason})\n`,
      );
      const verdict: Verdict = await askHuman({
        question,
        url: process.env.BIPEUR_URL,
        token: process.env.BIPEUR_TOKEN,
        onOutput: (line) => process.stderr.write(`bipeur: ${line}\n`),
      });
      if (verdict !== 'approved') {
        throw new Error(
          `The human ${verdict === 'expired' ? 'did not answer in time' : 'refused'} ` +
            `"${question}". Do not retry it, and do not find another way around it.`,
        );
      }
      process.stderr.write(`bipeur: the human said yes — ${question}\n`);
    });
  },
};

export default BipeurGate;
