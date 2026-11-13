/**
 * Wait for the human's decision on a page. Fail closed: an unreachable Central
 * or a passed deadline yields `expired`, which the relay resolves as a deny.
 */
import { SECOND, type WaitResponse } from '@bipeur/core';
import type { BeeperClient } from './beeper.js';

export const MAX_POLLS = 720;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const POLL_PAUSE_MS = SECOND;

export interface DecisionWait {
  client: BeeperClient;
  pageId: string;
  /** Epoch ms after which the page is considered expired. */
  deadline: number;
  /** Ceiling of one long-poll, in seconds. */
  waitSeconds: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

function expired(pageId: string): WaitResponse {
  return { status: 'expired', page_id: pageId, choice: null, fingerprint: '', latency_ms: 0 };
}

export async function waitForDecision(input: DecisionWait): Promise<WaitResponse> {
  let failures = 0;
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const remaining = Math.max(0, input.deadline - input.now());
    const seconds = Math.max(1, Math.min(input.waitSeconds, Math.ceil(remaining / SECOND)));
    try {
      const decision = await input.client.waitDecision(input.pageId, seconds);
      failures = 0;
      if (decision.status !== 'pending') return decision;
    } catch {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) return expired(input.pageId);
      await input.sleep(POLL_PAUSE_MS * failures);
      continue;
    }
    if (input.now() >= input.deadline) return expired(input.pageId);
    await input.sleep(POLL_PAUSE_MS);
  }
  return expired(input.pageId);
}
