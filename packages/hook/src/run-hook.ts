/**
 * BIP-F-24 — the Kiro `PreToolUse` hook.
 *
 * Order is the contract: local rules first (allow = exit 0, no network; deny =
 * exit 2, no network), then a page, then a wait, then a decision. Any doubt —
 * unreachable Central, malformed answer, fingerprint that moved — refuses the
 * tool: the hook never approves by default (tech.md rule 8, A.10).
 */
import {
  classifyTool,
  composeLine,
  type Classified,
  type CreatePageRequest,
  type RulesFile,
  type ToolPayload,
} from '@bipeur/core';
import { CentralClient } from './central-client.js';
import { dedupeKey, pageFingerprint, subjectOf, toolPayload } from './facts.js';
import { isPreToolUse, parseHookEvent, toolFacts, type ToolFacts } from './hook-event.js';
import { loadRules } from './rules-file.js';
import { OK, type HookOptions, type HookRunResult, type Result } from './types.js';

/** A guard against a Central that answers `pending` without ever waiting. */
const MAX_WAIT_ROUNDS = 1000;

export function refusal(reason: string): HookRunResult {
  return { code: 2, stdout: '', stderr: `bip-hook: ${reason}\n` };
}

export async function runHook(rawInput: string, options: HookOptions): Promise<HookRunResult> {
  const event = parseHookEvent(rawInput);
  if (!event.ok) return refusal(`cannot read the hook event: ${event.reason}`);
  if (!isPreToolUse(event.value)) return OK;

  const facts = toolFacts(event.value);
  const { rules } = loadRules(options.rulesPath, options.log);
  const verdict = classifyFacts(facts, rules);
  if (verdict.action === 'allow') return OK;
  if (verdict.action === 'deny') {
    return refusal(`refused by the local rules (${verdict.matched_by})`);
  }
  return pageAndDecide(facts, verdict, options);
}

/**
 * Kiro's `shell` tool name says nothing the command does not say already, and
 * core classifies an unknown tool name as a page: keeping it would turn every
 * allowed command into a page. Any other tool name (a file write, `@mcp`) is
 * classified on its own, so the `tool: ["@mcp"]` matcher of A.9 still fires.
 */
function classifyFacts(facts: ToolFacts, rules: RulesFile): Classified {
  const tool_name = facts.command && facts.tool_name === 'shell' ? undefined : facts.tool_name;
  return classifyTool({ command: facts.command, tool_name, path: facts.path }, rules);
}

async function pageAndDecide(
  facts: ToolFacts,
  verdict: Classified,
  options: HookOptions,
): Promise<HookRunResult> {
  const payload = toolPayload(facts);
  const fingerprint = pageFingerprint(payload);
  const dedupe = dedupeKey(facts.session_id, fingerprint);
  const request = pageRequest(facts, verdict, dedupe, options);
  if (options.dryRun) return dryRun(verdict, payload, fingerprint, dedupe, options);

  const client = clientFor(options);
  if (!client.ok) return refusal(client.reason);
  const created = await client.value.createPage(request);
  if (!created.ok) return refusal(`no page created: ${created.reason}`);
  options.log?.(`bip-hook: page ${created.value.id} created for #${fingerprint.slice(0, 4)}`);
  return awaitDecision(client.value, created.value.id, fingerprint, options);
}

function pageRequest(
  facts: ToolFacts,
  verdict: Classified,
  dedupe: string,
  options: HookOptions,
): CreatePageRequest {
  const ttl = Math.min(86_400, Math.max(30, Math.round(options.ttlMs / 1000)));
  return {
    kind: 'tool',
    tool_name: facts.tool_name,
    command: facts.command,
    path: facts.path,
    cwd: facts.cwd,
    code: verdict.code,
    risk: verdict.risk,
    verb: verdict.verb,
    ttl_seconds: ttl,
    station: options.station,
    dedupe_key: dedupe,
  };
}

async function awaitDecision(
  client: CentralClient,
  pageId: string,
  fingerprint: string,
  options: HookOptions,
): Promise<HookRunResult> {
  const now = options.now ?? Date.now;
  const start = now();
  const deadline = start + Math.min(options.ttlMs, options.timeoutMs ?? Number.POSITIVE_INFINITY);
  for (let round = 0; round < MAX_WAIT_ROUNDS; round += 1) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const wait = Math.max(1, Math.min(options.waitSeconds, Math.ceil(remaining / 1000)));
    const decision = await client.waitDecision(pageId, wait);
    if (!decision.ok) return refusal(`no decision for page ${pageId}: ${decision.reason}`);
    const outcome = interpret(decision.value.status, decision.value, fingerprint, pageId);
    if (outcome) return outcome;
  }
  return refusal(`no human decision for page ${pageId} before it expired`);
}

/** `null` means "still pending, ask again". */
function interpret(
  status: string,
  decision: { choice?: string | null; reason?: string | null; fingerprint: string },
  fingerprint: string,
  pageId: string,
): HookRunResult | null {
  switch (status) {
    case 'pending':
      return null;
    case 'approved':
      // BIP-F-18: the approval must name this exact action, not a neighbour.
      if (decision.fingerprint !== fingerprint) {
        return refusal(`approval refused: it names another action than the one paged (page ${pageId})`);
      }
      return OK;
    case 'denied':
      return refusal(`refused by the human${decision.reason ? `: ${decision.reason}` : ''} (page ${pageId})`);
    case 'choice':
      return refusal(`the human picked ${decision.choice ?? 'an option'} instead of approving (page ${pageId})`);
    case 'expired':
      return refusal(`no human decision: page ${pageId} expired`);
    case 'cancelled':
      return refusal(`no human decision: page ${pageId} was cancelled`);
    default:
      return refusal(`unexpected decision status "${status}" (page ${pageId})`);
  }
}

function dryRun(
  verdict: Classified,
  payload: ToolPayload,
  fingerprint: string,
  dedupe: string,
  options: HookOptions,
): HookRunResult {
  const line = composeLine({
    code: verdict.code,
    station: options.station,
    verb: verdict.verb,
    subject: subjectOf(payload),
    fingerprint,
  });
  const report = [
    `line: ${line}`,
    `risk: ${verdict.risk}`,
    `code: ${verdict.code}`,
    `matched_by: ${verdict.matched_by}`,
    `dedupe_key: ${dedupe}`,
  ];
  return { code: 0, stdout: `${report.join('\n')}\n`, stderr: '' };
}

function clientFor(options: HookOptions): Result<CentralClient> {
  if (!options.url) {
    return { ok: false, reason: 'BIPEUR_URL is not set: refusing the tool without a Central' };
  }
  if (!options.token) {
    return { ok: false, reason: 'BIPEUR_TOKEN is not set: refusing the tool without a token' };
  }
  return {
    ok: true,
    value: new CentralClient({ url: options.url, token: options.token, fetchImpl: options.fetchImpl }),
  };
}
