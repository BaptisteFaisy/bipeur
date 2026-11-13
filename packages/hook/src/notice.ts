/**
 * BIP-F-25 — the end-of-turn notice. One line in the Central journal, never a
 * block: the turn has already happened, and a notice is not a decision.
 */
import { LINE_MAX, toLineText } from '@bipeur/core';
import { CentralClient } from './central-client.js';
import type { FetchLike } from './types.js';

const NOTICE_TIMEOUT_MS = 2000;

export interface NoticeOptions {
  url?: string;
  token?: string;
  station: string;
  line?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Always `0`: a notice never fails the turn it reports on. */
export interface NoticeRunResult {
  code: 0;
  stderr: string;
}

export async function runNotice(
  rawInput: string,
  options: NoticeOptions,
): Promise<NoticeRunResult> {
  const line = composeNoticeLine(options.line ?? noticeTextFrom(rawInput), options.station);
  if (!options.url || !options.token || line.length === 0) return { code: 0, stderr: '' };

  const client = new CentralClient({
    url: options.url,
    token: options.token,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? NOTICE_TIMEOUT_MS,
  });
  const sent = await client.postNotice(line);
  if (sent.ok) return { code: 0, stderr: '' };
  return { code: 0, stderr: `bip-notice: notice not delivered (${sent.reason})\n` };
}

/** One printable ASCII line of at most 80 characters, never the payload. */
export function composeNoticeLine(text: string, station: string): string {
  return toLineText(`${station} ${text}`).slice(0, LINE_MAX).trim();
}

const TEXT_KEYS = ['message', 'summary', 'reason', 'text', 'last_message'] as const;

/** The end-of-turn event has no stable shape yet: take what reads well. */
export function noticeTextFrom(rawInput: string): string {
  const text = rawInput.trim();
  if (text.length === 0) return 'turn finished';
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return text;
    event = parsed as Record<string, unknown>;
  } catch {
    return text;
  }
  for (const key of TEXT_KEYS) {
    const value = event[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  const name = typeof event['hook_event_name'] === 'string' ? event['hook_event_name'] : 'turn';
  const cwd = typeof event['cwd'] === 'string' ? lastSegment(event['cwd']) : '';
  return cwd.length > 0 ? `${name} ${cwd}` : `${name} finished`;
}

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}
