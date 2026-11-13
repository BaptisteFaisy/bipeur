/**
 * The rules file (A.9): what is allowed silently, what is denied silently and
 * what becomes a page, with its code and its risk level.
 *
 * Property BIP-P-09: the risk of a composite command is the maximum of the
 * risks of its segments, so adding a segment never lowers it.
 */
import { parse as parseYaml } from 'yaml';
import { defaultVerbForCode, isValidCode } from './codes.js';
import { maxRisk, maxRiskOf, riskRank, type Risk, type Verb } from './types.js';

export type RuleAction = 'allow' | 'deny' | 'page';

export interface MatcherSet {
  shell?: string[];
  tool?: string[];
  path?: string[];
}

export interface PageRule {
  match: MatcherSet;
  code: number;
  risk: Risk;
  verb?: Verb;
}

export interface RulesFile {
  version: number;
  defaults: { ttl: string; on_expire: 'deny' | 'approve' };
  allow: MatcherSet[];
  deny: MatcherSet[];
  page: PageRule[];
  fallback: { code: number; risk: Risk };
  budget_per_hour?: number;
  quiet_hours?: { enabled: boolean; start: string; end: string };
}

export const DEFAULT_RULES: RulesFile = {
  version: 1,
  defaults: { ttl: '15m', on_expire: 'deny' },
  allow: [],
  deny: [],
  page: [],
  fallback: { code: 100, risk: 'amber' },
};

export interface RuleOutcome {
  action: RuleAction;
  code: number;
  risk: Risk;
  verb: Verb;
  /** Which rule fired, for the dry-run bench and the audit log. */
  matched_by: string;
}

/** Translate a shell glob (`pnpm test*`, `* | sh`) into an anchored RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function matchesAny(value: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

/** Split on the separators listed, ignoring anything inside quotes. */
function splitOnSeparators(input: string, separators: readonly string[]): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? '';
    if (quote) {
      current += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const matched = separators.find((sep) => input.startsWith(sep, i));
    if (matched) {
      parts.push(current);
      current = '';
      i += matched.length - 1;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Split a command into statements (`&&`, `||`, `;`, newline). A pipeline is
 * ONE statement: `curl x | sh` must stay whole, otherwise the deny pattern
 * `* | sh` could never match (BIP-F-04).
 */
export function splitCommand(command: string): string[] {
  return splitOnSeparators(command, ['&&', '||', ';', '\n']);
}

/** Split a statement into its pipeline elements (`|`). */
export function splitPipeline(statement: string): string[] {
  return splitOnSeparators(statement, ['|']);
}

export function parseRules(yamlText: string): RulesFile {
  const raw = parseYaml(yamlText) as Partial<RulesFile> | null;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RULES };
  return {
    version: raw.version ?? 1,
    defaults: {
      ttl: raw.defaults?.ttl ?? DEFAULT_RULES.defaults.ttl,
      on_expire: raw.defaults?.on_expire === 'approve' ? 'approve' : 'deny',
    },
    allow: raw.allow ?? [],
    deny: raw.deny ?? [],
    page: (raw.page ?? []).filter((rule) => isValidCode(rule.code)),
    fallback: {
      code: isValidCode(raw.fallback?.code ?? 0) ? raw.fallback!.code : 100,
      risk: normalizeRisk(raw.fallback?.risk, 'amber'),
    },
    budget_per_hour: raw.budget_per_hour,
    quiet_hours: raw.quiet_hours,
  };
}

function normalizeRisk(value: unknown, fallback: Risk): Risk {
  return value === 'green' || value === 'amber' || value === 'red' ? value : fallback;
}

export interface ClassifyInput {
  command?: string;
  tool_name?: string;
  path?: string;
}

/** Classify ONE segment (or one tool call). Never splits composites itself. */
export function classifySingle(input: ClassifyInput, rules: RulesFile): RuleOutcome {
  const command = (input.command ?? '').trim();
  const tool = input.tool_name ?? '';
  const path = input.path ?? '';

  if (matchesAny(command, firstShell(rules.deny)) || matchesAny(tool, firstTool(rules.deny))) {
    return { action: 'deny', code: rules.fallback.code, risk: 'red', verb: 'RUN', matched_by: 'deny' };
  }
  if (matchesAny(command, firstShell(rules.allow)) || matchesAny(tool, firstTool(rules.allow))) {
    return { action: 'allow', code: 0, risk: 'green', verb: 'RUN', matched_by: 'allow' };
  }
  for (const rule of rules.page) {
    if (
      matchesAny(command, rule.match.shell) ||
      matchesAny(tool, rule.match.tool) ||
      matchesAny(path, rule.match.path)
    ) {
      return {
        action: 'page',
        code: rule.code,
        risk: rule.risk,
        verb: rule.verb ?? defaultVerbForCode(rule.code),
        matched_by: `page:${rule.code}`,
      };
    }
  }
  if (command.length > 0 || tool.length > 0) {
    return {
      action: 'page',
      code: rules.fallback.code,
      risk: rules.fallback.risk,
      verb: defaultVerbForCode(rules.fallback.code),
      matched_by: 'fallback',
    };
  }
  return { action: 'allow', code: 0, risk: 'green', verb: 'RUN', matched_by: 'empty' };
}

function firstShell(sets: readonly MatcherSet[]): string[] {
  return sets.flatMap((set) => set.shell ?? []);
}

function firstTool(sets: readonly MatcherSet[]): string[] {
  return sets.flatMap((set) => set.tool ?? []);
}

export interface Classified {
  action: RuleAction;
  code: number;
  risk: Risk;
  verb: Verb;
  matched_by: string;
  segments: readonly RuleOutcome[];
}

/**
 * Classify one statement: the pipeline as a whole AND each of its elements,
 * keeping the worst outcome. The whole matters because rules such as `* | sh`
 * only make sense on the complete pipeline.
 */
export function classifyStatement(statement: string, rules: RulesFile): RuleOutcome {
  const outcomes = [classifySingle({ command: statement }, rules)];
  const elements = splitPipeline(statement);
  if (elements.length > 1) {
    for (const element of elements) outcomes.push(classifySingle({ command: element }, rules));
  }
  return worstOutcome(outcomes);
}

export function worstOutcome(outcomes: readonly RuleOutcome[]): RuleOutcome {
  return outcomes.reduce((worst, candidate) => (outcomeRank(candidate) > outcomeRank(worst) ? candidate : worst));
}

function outcomeRank(outcome: RuleOutcome): number {
  if (outcome.action === 'deny') return 100;
  if (outcome.action === 'allow') return 0;
  return 10 + riskRank(outcome.risk);
}

/**
 * Classify a whole command: split it into statements, classify each one, keep
 * the worst. A single denied statement denies the whole command. Adding a
 * statement can therefore never lower the outcome (BIP-P-09).
 */
export function classifyCommand(command: string, rules: RulesFile): Classified {
  const statements = splitCommand(command);
  const segments = statements.length === 0
    ? [classifySingle({ command }, rules)]
    : statements.map((statement) => classifyStatement(statement, rules));
  return foldSegments(segments, rules);
}

export function classifyTool(input: ClassifyInput, rules: RulesFile): Classified {
  const command = input.command?.trim() ?? '';
  if (command.length > 0) {
    const withTool = classifyCommand(command, rules);
    const toolOutcome = classifySingle({ tool_name: input.tool_name, path: input.path }, rules);
    return foldSegments([...withTool.segments, toolOutcome], rules);
  }
  const single = classifySingle(input, rules);
  return foldSegments([single], rules);
}

/** Worst-case fold. Guarantees BIP-P-09: max over segments, monotone. */
export function foldSegments(segments: readonly RuleOutcome[], _rules?: RulesFile): Classified {
  if (segments.length === 0) {
    return {
      action: 'allow',
      code: 0,
      risk: 'green',
      verb: 'RUN',
      matched_by: 'empty',
      segments: [],
    };
  }
  const denied = segments.find((s) => s.action === 'deny');
  if (denied) {
    return { ...denied, action: 'deny', segments };
  }
  const paged = segments.filter((s) => s.action === 'page');
  if (paged.length === 0) {
    return { ...segments[0]!, action: 'allow', code: 0, risk: 'green', segments };
  }
  const risk = maxRiskOf(paged.map((s) => s.risk));
  const worst = paged.reduce((a, b) => (riskRank(b.risk) > riskRank(a.risk) ? b : a));
  return {
    action: 'page',
    code: worst.code,
    risk,
    verb: worst.verb,
    matched_by: worst.matched_by,
    segments,
  };
}

/** A source may raise its own risk, never lower the computed one (BIP-F-04). */
export function resolveRisk(computed: Risk, declared: Risk | undefined): Risk {
  if (!declared) return computed;
  return maxRisk(computed, declared);
}
