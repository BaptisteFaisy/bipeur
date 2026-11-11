/**
 * The Kiro `PreToolUse` event, as described in A.9. It arrives on stdin; it is
 * untrusted input, so it goes through a schema before anything else.
 */
import { z } from 'zod';
import type { Result } from './types.js';

export const hookEventSchema = z.object({
  hook_event_name: z.string().max(64).optional(),
  cwd: z.string().max(2048).optional(),
  session_id: z.string().max(200).optional(),
  tool_name: z.string().min(1).max(64).optional(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
});

export type HookEvent = z.infer<typeof hookEventSchema>;

/** What the classifier and the page payload need, flattened. */
export interface ToolFacts {
  tool_name: string;
  command?: string;
  path?: string;
  cwd?: string;
  /** Git branch the action touches, when the agent says so. */
  branch?: string;
  /** Diff stats the agent reports, when it reports them. */
  stats?: string;
  /** The agent's own words: shown on detail screen 4 only (A.6). */
  agent_says?: string;
  /** Dedupe scope: the same session asking twice gets the same page (BIP-N-02). */
  session_id: string;
}

const COMMAND_KEYS = ['command', 'cmd'] as const;
const PATH_KEYS = ['path', 'file_path', 'target_file', 'filePath'] as const;
const BRANCH_KEYS = ['branch', 'git_branch', 'ref'] as const;
const STATS_KEYS = ['stats', 'diff_stats', 'changes'] as const;
const SAYS_KEYS = ['agent_says', 'description', 'reason', 'message'] as const;

export function parseHookEvent(raw: string): Result<HookEvent> {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: 'nothing on stdin' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'stdin is not JSON' };
  }
  const parsed = hookEventSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `unexpected event shape (${issue?.path.join('.') ?? 'root'})` };
  }
  return { ok: true, value: parsed.data };
}

/** Only a `PreToolUse` event is ours; anything else is a no-op. */
export function isPreToolUse(event: HookEvent): boolean {
  return (event.hook_event_name ?? 'PreToolUse') === 'PreToolUse';
}

export function toolFacts(event: HookEvent): ToolFacts {
  const input = event.tool_input ?? {};
  return {
    tool_name: event.tool_name ?? 'unknown',
    command: firstString(input, COMMAND_KEYS),
    path: firstString(input, PATH_KEYS),
    cwd: event.cwd,
    branch: firstString(input, BRANCH_KEYS),
    stats: firstString(input, STATS_KEYS),
    agent_says: firstString(input, SAYS_KEYS),
    session_id: event.session_id ?? event.cwd ?? 'unknown',
  };
}

function firstString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}
