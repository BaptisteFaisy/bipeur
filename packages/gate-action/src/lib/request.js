/**
 * What the human sees on the pager, built from facts only (A.6, BIP-F-48).
 *
 * The request is shaped by `packages/core/src/schema.ts` — the same contract the
 * hook, the CLI and the MCP server post to — and this module never invents a
 * field: a fact the contract does not carry is a fact the pager cannot show.
 * Limits are enforced here instead of trusting a 422 from the Central, so a bad
 * workflow input fails at the step that owns it, with the input named.
 *
 * The commit SHA is a fact. It enters the page, so it enters the fingerprint, so
 * a decision signed for one commit cannot be replayed on another (BIP-F-01).
 */
import { GateError } from './errors.js';

/** Contract limits of `toolPageRequestSchema` (packages/core/src/schema.ts). */
export const LIMITS = {
  tool_name: 64,
  command: 4000,
  path: 2048,
  cwd: 2048,
  branch: 256,
  stats: 160,
  station: 32,
  agent_says: 2000,
  dedupe_key: 200,
  ttl_seconds: { min: 30, max: 86400 },
};

/** The gate is a deployment: family 3, and the Central still classifies. */
export const DEFAULT_TOOL = 'github-action';

/**
 * @param {string} field Name of the input, for the error message only.
 * @param {string|undefined|null} value
 * @param {number} max
 * @param {boolean} [required]
 */
function bounded(field, value, max, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) {
    if (required) throw new GateError(`input "${field}" is required`);
    return '';
  }
  if (text.length > max) {
    throw new GateError(`input "${field}" is ${text.length} characters, the contract allows ${max}`);
  }
  return text;
}

/** @param {number} seconds */
export function ttlSecondsOf(seconds) {
  if (!Number.isFinite(seconds)) throw new GateError('input "ttl-minutes" must be a number');
  const { min, max } = LIMITS.ttl_seconds;
  if (seconds < min || seconds > max) {
    throw new GateError(`page lifetime must be between ${min} and ${max} seconds (got ${seconds})`);
  }
  return Math.round(seconds);
}

/**
 * The commit is shown to the human as a fact, not hidden in a header: short
 * enough to fit the context line, full enough that two commits cannot collide.
 *
 * @param {string} [sha]
 * @param {string} [extra] Whatever the workflow adds (PR number, run id…).
 */
export function statsOf(sha, extra) {
  const parts = [];
  const hash = bounded('sha', sha, 40);
  if (hash) parts.push(`sha ${hash}`);
  const rest = bounded('stats', extra);
  if (rest) parts.push(rest);
  const joined = parts.join(' ');
  if (joined.length > LIMITS.stats) {
    throw new GateError(`"sha" plus "stats" exceed ${LIMITS.stats} characters`);
  }
  return joined;
}

/**
 * Body of `POST /v1/pages` for the `gate` action.
 *
 * @param {{
 *   tool?: string, command: string, station: string, reason?: string|null,
 *   sha?: string|null, ref?: string|null, cwd?: string|null, path?: string|null,
 *   stats?: string|null, ttlSeconds: number, dedupeKey?: string|null
 * }} facts
 * @returns {Record<string, unknown>} a `CreatePageRequest` shaped object
 */
export function toolPageRequest(facts) {
  const stats = statsOf(facts.sha, facts.stats);
  return dropEmpty({
    kind: 'tool',
    tool_name: bounded('tool', facts.tool, LIMITS.tool_name) || DEFAULT_TOOL,
    command: bounded('command', facts.command, LIMITS.command, true),
    path: bounded('path', facts.path, LIMITS.path),
    cwd: bounded('cwd', facts.cwd, LIMITS.cwd),
    branch: bounded('ref', facts.ref, LIMITS.branch),
    stats,
    station: bounded('station', facts.station, LIMITS.station, true),
    ttl_seconds: ttlSecondsOf(facts.ttlSeconds),
    agent_says: bounded('reason', facts.reason, LIMITS.agent_says),
    dedupe_key: bounded('dedupe-key', facts.dedupeKey, LIMITS.dedupe_key),
  });
}

/**
 * Body of `POST /v1/pages` for the `gate-pr` action: the same tool page, with
 * the head SHA of the pull request carried as a fact and as the idempotency key.
 *
 * A new commit on the PR is a new fingerprint and a new page, so the human signs
 * the code that actually ships — never the code that happened to be approved an
 * hour earlier.
 *
 * @param {{
 *   tool?: string, command?: string|null, station: string, reason?: string|null,
 *   sha: string, prNumber: string|number, headRef?: string|null,
 *   baseRef?: string|null, cwd?: string|null, ttlSeconds: number, repo?: string|null
 * }} facts
 */
export function pullRequestPageRequest(facts) {
  const number = bounded('pr-number', String(facts.prNumber ?? ''), 32, true);
  const sha = bounded('sha', facts.sha, 40, true);
  const base = bounded('base', facts.baseRef, LIMITS.branch);
  const head = bounded('ref', facts.headRef, LIMITS.branch);
  const command = facts.command?.trim()
    ? bounded('command', facts.command, LIMITS.command, true)
    : `merge pull request #${number} into ${base || 'main'}`;
  return toolPageRequest({
    tool: facts.tool,
    command,
    station: facts.station,
    reason: facts.reason,
    sha,
    stats: `pr#${number}`,
    // The branch the human reads on the pager is the head branch: it is what
    // the merge brings in. The base is in the command and in the dedupe key.
    ref: head,
    cwd: facts.cwd,
    ttlSeconds: facts.ttlSeconds,
    dedupeKey: `gate-pr:${bounded('repo', facts.repo, 80) || 'repo'}:${number}:${sha}`,
  });
}

/** @param {Record<string, unknown>} body */
function dropEmpty(body) {
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}
