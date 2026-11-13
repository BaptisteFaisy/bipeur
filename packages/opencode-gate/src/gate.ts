/**
 * The gate: what an agent may do without a human, and what it must ask for.
 *
 * Same rules as the Central (`.bipeur/rules.yaml`, parsed by `@bipeur/core`),
 * same three outcomes:
 *
 *   allow — the agent goes ahead (a `pnpm test`, a `git status`…);
 *   deny  — refused outright, no page (a `rm -rf /`, a `curl … | sh`);
 *   page  — a human is asked on the pager, and the agent waits for the answer.
 *
 * The rule is the point: an agent that cannot page a human simply cannot run
 * the risky command, and an agent that pages gets the human's real answer
 * before it continues. Nothing here trusts the agent's own word about the
 * risk — the risk is computed from the command itself.
 */
import { classifyCommand, classifyTool, type Classified, type RulesFile } from '@bipeur/core';

export type GateOutcome = 'allow' | 'deny' | 'page';

export interface GateInput {
  /** The tool the agent wants to call (`bash`, `edit`, `write`…). */
  tool?: string;
  /** The command line, for a shell tool. */
  command?: string;
  /** The path, for a file tool. */
  path?: string;
}

export interface GateDecision {
  outcome: GateOutcome;
  /** Why the gate decided that — the pattern that matched, or the rule. */
  reason: string;
  /** The risk the rules computed (green, amber, red). */
  risk: string;
  /** The code of the page to open, when the outcome is `page`. */
  code: number;
  /** The verb of the page (PUSH, DELETE, DEPLOY…), when the outcome is `page`. */
  verb: string;
}

export interface GateRules {
  rules: RulesFile;
}

/** Classify one tool call with the shared rules of the Central. */
export function decide(input: GateInput, rules: RulesFile): GateDecision {
  const classified: Classified =
    input.command !== undefined
      ? classifyCommand(input.command, rules)
      : classifyTool({ tool_name: input.tool, path: input.path }, rules);
  return toDecision(classified);
}

/** The decision, in the words of the pager. */
export function toDecision(classified: Classified): GateDecision {
  return {
    outcome: classified.action,
    reason: classified.matched_by,
    risk: classified.risk,
    code: classified.code,
    verb: classified.verb,
  };
}

/**
 * The question the human reads on the pager: what the agent wants to do, in
 * one line, and the page code the Central will compose.
 */
export function questionFor(input: GateInput, decision: GateDecision): string {
  const what = (input.command ?? input.path ?? input.tool ?? 'this action').trim();
  const short = what.length > 60 ? `${what.slice(0, 57)}…` : what;
  return `${decision.verb} ${short}`;
}
