/**
 * `bip ask` — create a question page, wait for the decision, translate it into
 * an exit code (BIP-F-29). A timeout is never an approval: an expired page
 * exits 3, whatever the script hoped for.
 */
import { SECOND, type CreatePageRequest, type WaitResponse } from '@bipeur/core';
import type { CentralClient, PageSummary } from './api.js';
import type { AskCommand } from './args.js';
import { EXIT, type ExitCode } from './exit-codes.js';

/** Ceiling of one wait, kept under the 50 s MCP client budget (BIP-F-26). */
export const MAX_WAIT_SECONDS = 50;
/** Hard bound on the loop, so a clock that never moves cannot spin forever. */
export const MAX_POLLS = 720;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const POLL_PAUSE_MS = SECOND;

export interface AskResult {
  exitCode: ExitCode;
  status: WaitResponse['status'];
  choice: string | null;
  page_id: string;
  latency_ms: number;
  /** The line as the Central composed it; never recomposed locally. */
  line: string;
}

export interface AskDeps {
  client: CentralClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called as soon as the page exists, so the human sees the line immediately. */
  onLine?: (line: string) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function buildRequest(cmd: AskCommand): CreatePageRequest {
  const ttlSeconds = Math.max(30, Math.round(cmd.ttlMs / SECOND));
  return {
    kind: 'question',
    question: cmd.question,
    ttl_seconds: ttlSeconds,
    ...(cmd.options.length > 0 ? { options: cmd.options } : {}),
    ...(cmd.detail !== null ? { detail: cmd.detail } : {}),
    ...(cmd.station !== null ? { station: cmd.station } : {}),
  };
}

/** Map a decision to the shell contract. Cancelled is a no, pending is an expiry. */
export function exitCodeFor(decision: WaitResponse, yesNo: boolean): ExitCode {
  switch (decision.status) {
    case 'approved':
      return EXIT.YES;
    case 'choice':
      return yesNo && decision.choice === 'B' ? EXIT.NO : EXIT.YES;
    case 'denied':
    case 'cancelled':
      return EXIT.NO;
    case 'expired':
    case 'pending':
      return EXIT.EXPIRED;
  }
}

function expired(page: PageSummary): WaitResponse {
  return {
    status: 'expired',
    page_id: page.id,
    choice: null,
    fingerprint: '',
    latency_ms: 0,
  };
}

interface LoopDeps {
  client: CentralClient;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

async function waitForDecision(page: PageSummary, ttlMs: number, deps: LoopDeps): Promise<WaitResponse> {
  const deadline = deps.now() + ttlMs;
  let failures = 0;
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const remaining = Math.max(0, deadline - deps.now());
    const waitSeconds = Math.max(1, Math.min(MAX_WAIT_SECONDS, Math.ceil(remaining / SECOND)));
    try {
      const decision = await deps.client.waitDecision(page.id, waitSeconds);
      failures = 0;
      if (decision.status !== 'pending') return decision;
    } catch (error) {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) throw error;
      await deps.sleep(POLL_PAUSE_MS * failures);
      continue;
    }
    if (deps.now() >= deadline) return expired(page);
    await deps.sleep(POLL_PAUSE_MS);
  }
  return expired(page);
}

export async function ask(cmd: AskCommand, deps: AskDeps): Promise<AskResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const startedAt = now();
  const page = await deps.client.createPage(buildRequest(cmd));
  deps.onLine?.(page.line);

  const decision = await waitForDecision(page, cmd.ttlMs, { client: deps.client, now, sleep });
  const latency = decision.latency_ms > 0 ? decision.latency_ms : Math.max(0, now() - startedAt);

  return {
    exitCode: exitCodeFor(decision, cmd.yesNo),
    status: decision.status,
    choice: decision.choice ?? null,
    page_id: page.id,
    latency_ms: latency,
    line: page.line,
  };
}
