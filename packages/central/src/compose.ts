/**
 * Composition of a page (A.6, BIP-F-02): the line and the detail screens come
 * from the payload alone. The agent's own words only ever reach screen 4.
 * Nothing here reads the clock or the store: it is a pure function of facts.
 */
import {
  buildDetailScreens,
  classifyTool,
  composeLineDetailed,
  defaultVerbForCode,
  familyOf,
  isValidCode,
  maxRisk,
  resolveRisk,
  verbMatchesCode,
  type Classified,
  type CreatePageRequest,
  type Risk,
  type RulesFile,
  type Verb,
} from '@bipeur/core';
import { fingerprint } from '@bipeur/core/node';

/** Design choices land in family 5 by default (A.6). */
export const QUESTION_CODE = 510;

export interface Composed {
  code: number;
  risk: Risk;
  verb: Verb;
  line: string;
  detail: string[];
  /** Which rule fired: `page:310`, `fallback`, `deny`, `allow` (BIP-F-32). */
  matched_by: string;
  /** True when the line had to cut the subject (BIP-F-03). */
  truncated: boolean;
}

/** The facts a page is judged on. Agent prose is deliberately excluded. */
export function factsOf(request: CreatePageRequest): Record<string, unknown> {
  if (request.kind === 'tool') {
    return {
      kind: 'tool',
      tool_name: request.tool_name,
      command: request.command,
      path: request.path,
      cwd: request.cwd,
      branch: request.branch,
      stats: request.stats,
      // The diff and the group are facts, not prose: the fingerprint covers
      // them, so a decision signed on one diff cannot be replayed on another
      // (BIP-F-40, BIP-F-47).
      diff: request.diff,
      group: request.group,
    };
  }
  return { kind: 'question', question: request.question, options: request.options };
}

/** SHA-256 of the canonical facts: the page fingerprint (BIP-F-01). */
export function fingerprintOf(request: CreatePageRequest): string {
  return fingerprint(factsOf(request));
}

export function composeRequest(
  request: CreatePageRequest,
  station: string,
  rules: RulesFile,
  payloadFingerprint: string,
): Composed {
  const base = request.kind === 'tool' ? toolFacts(request, rules) : questionFacts(request);
  const risk = resolveRisk(base.risk, request.risk);
  const subject = request.kind === 'tool' ? toolSubject(request, base.verb) : questionSubject(request);
  const line = composeLineDetailed({
    code: base.code,
    station,
    verb: base.verb,
    subject,
    fingerprint: payloadFingerprint,
  });
  return {
    ...base,
    risk,
    line: line.line,
    detail: detailOf(request, subject, line.truncated),
    truncated: line.truncated,
  };
}

function toolFacts(request: Extract<CreatePageRequest, { kind: 'tool' }>, rules: RulesFile): Omit<Composed, 'line' | 'detail' | 'truncated'> {
  const outcome = classifyTool(
    { tool_name: request.tool_name, command: request.command, path: request.path },
    rules,
  );
  const picked = pickOutcome(outcome, rules);
  return { code: picked.code, risk: picked.risk, verb: picked.verb, matched_by: picked.matched_by };
}

/** A rule may allow or deny; the page still exists, with the safe default. */
function pickOutcome(outcome: Classified, rules: RulesFile): { code: number; risk: Risk; verb: Verb; matched_by: string } {
  if (outcome.action === 'page') {
    return { code: outcome.code, risk: outcome.risk, verb: outcome.verb, matched_by: outcome.matched_by };
  }
  if (outcome.action === 'deny') {
    return { code: rules.fallback.code, risk: maxRisk('red', rules.fallback.risk), verb: 'RUN', matched_by: 'deny' };
  }
  return {
    code: rules.fallback.code,
    risk: rules.fallback.risk,
    verb: defaultVerbForCode(rules.fallback.code),
    matched_by: 'allow',
  };
}

function questionFacts(request: Extract<CreatePageRequest, { kind: 'question' }>): Omit<Composed, 'line' | 'detail' | 'truncated'> {
  const code = request.code !== undefined && isValidCode(request.code) ? request.code : QUESTION_CODE;
  const declared = request.verb as Verb | undefined;
  const verb = declared && verbMatchesCode(declared, code) ? declared : defaultVerbForCode(code);
  return { code, risk: familyOf(code)?.defaultRisk ?? 'green', verb, matched_by: 'question' };
}

function toolSubject(request: Extract<CreatePageRequest, { kind: 'tool' }>, verb: Verb): string {
  const command = request.command?.trim() ?? '';
  if (verb === 'PUSH' && request.branch && /^git push\b/.test(command) && /\borigin\b/.test(command)) {
    return `${request.branch}>origin${request.stats ? ` ${request.stats}` : ''}`;
  }
  if (command.length > 0) return command;
  if (request.path) return `${request.tool_name} ${request.path}`;
  return request.tool_name;
}

/**
 * The subject of a question, with the seeded replies appended so the letters on
 * the keypad mean something: `Deploy now? A Yes B No`.
 *
 * A label the question already spells out is not repeated — the specification's
 * own example (`date lib? A dayjs B luxon C temporal`) is written that way, and
 * echoing it would waste half of the 80 characters for nothing.
 */
function questionSubject(request: Extract<CreatePageRequest, { kind: 'question' }>): string {
  const question = request.question;
  const missing = (request.options ?? [])
    .filter((option) => !question.toLowerCase().includes(option.label.toLowerCase()))
    .map((option) => `${option.code} ${option.label}`);
  return [question, ...missing].join(' ');
}

function detailOf(request: CreatePageRequest, subject: string, truncated: boolean): string[] {
  if (request.kind === 'tool') {
    return buildDetailScreens({
      full: request.command ?? request.path ?? request.tool_name,
      context: contextLine(request),
      agentSays: request.agent_says,
    });
  }
  // The question IS what the human is asked to decide. When the line had to
  // cut it, the whole text follows on the detail screens: it must not vanish.
  return buildDetailScreens({
    full: truncated ? subject : request.detail,
    context: truncated ? request.detail : undefined,
    agentSays: request.agent_says,
  });
}

function contextLine(request: Extract<CreatePageRequest, { kind: 'tool' }>): string | undefined {
  const parts = [request.cwd, request.branch ? `on ${request.branch}` : '', request.stats]
    .filter((part): part is string => Boolean(part && part.length > 0));
  return parts.length > 0 ? parts.join(' ') : undefined;
}
