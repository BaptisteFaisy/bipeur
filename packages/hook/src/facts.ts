/**
 * From a tool call to the facts the page carries, and to the two hashes that
 * make it safe: the fingerprint the human approves (BIP-F-18) and the dedupe
 * key that keeps one action to one page (BIP-N-02, BIP-P-10).
 *
 * The payload built here is exactly what the Central receives, so a Central
 * that fingerprints its stored payload arrives at the same fingerprint.
 */
import { canonicalize, type ToolPayload } from '@bipeur/core';
import { sha256Hex } from './digest.js';
import type { ToolFacts } from './hook-event.js';

export function toolPayload(facts: ToolFacts): ToolPayload {
  const payload: ToolPayload = { tool_name: facts.tool_name };
  if (facts.command) payload.command = facts.command;
  if (facts.path) payload.path = facts.path;
  if (facts.cwd) payload.cwd = facts.cwd;
  if (facts.branch) payload.branch = facts.branch;
  if (facts.stats) payload.stats = facts.stats;
  if (facts.agent_says) payload.agent_says = facts.agent_says;
  return payload;
}

/** SHA-256 of the canonical payload: the decision binds to this value. */
export function pageFingerprint(payload: ToolPayload): string {
  return sha256Hex(canonicalize(payload));
}

/** `sha256(session_id + fingerprint)` — a reconnecting hook finds its page. */
export function dedupeKey(sessionId: string, fingerprint: string): string {
  return sha256Hex(`${sessionId}:${fingerprint}`);
}

/** Subject of the line, used by `--dry-run` (the Central composes the real one). */
export function subjectOf(payload: ToolPayload): string {
  return payload.command ?? payload.path ?? payload.tool_name;
}
