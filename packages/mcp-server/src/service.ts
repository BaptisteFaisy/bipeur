/**
 * BIP-F-26 — the tool logic, without the MCP plumbing: create a page, wait for
 * its decision inside the client budget, cancel it.
 *
 * The wait never exceeds 50 seconds: an MCP client gives up around there, and
 * an agent that is still waiting must be told `pending` with the page id so it
 * can call `page_wait` instead of paging a second time.
 */
import type { BipeurClient } from './client.js';

/** Long poll asked of the Central: 45 s leaves room for the round trip. */
export const HUMAN_WAIT_SECONDS = 45;
/** BIP-F-26: the tool answers within 50 seconds, always. */
export const MCP_BUDGET_MS = 50_000;

export type PageStatus = 'approved' | 'denied' | 'choice' | 'expired' | 'cancelled' | 'pending';

export interface PageResult {
  status: PageStatus;
  page_id: string;
  choice?: string | null;
  latency_ms: number;
}

export interface PageHumanInput {
  question: string;
  options?: { code: string; label: string }[];
  detail?: string;
  callback_url?: string;
  ttl_seconds?: number;
}

export class BipeurError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BipeurError';
  }
}

export interface ServiceOptions {
  now?: () => number;
  budgetMs?: number;
}

export class BipeurService {
  private readonly client: BipeurClient;
  private readonly now: () => number;
  private readonly budgetMs: number;

  constructor(client: BipeurClient, options: ServiceOptions = {}) {
    this.client = client;
    this.now = options.now ?? Date.now;
    this.budgetMs = options.budgetMs ?? MCP_BUDGET_MS;
  }

  async pageHuman(input: PageHumanInput): Promise<PageResult> {
    const started = this.now();
    const created = await this.client.createQuestion({
      kind: 'question',
      question: input.question,
      options: input.options,
      detail: input.detail,
      callback_url: input.callback_url,
      ttl_seconds: input.ttl_seconds,
    });
    if (!created.ok) {
      throw new BipeurError(`the Central could not create the page: ${created.reason}`);
    }
    return this.awaitPage(created.value.id, started, HUMAN_WAIT_SECONDS);
  }

  async pageWait(input: { page_id: string; wait_seconds: number }): Promise<PageResult> {
    const wait = Math.min(input.wait_seconds, HUMAN_WAIT_SECONDS);
    return this.awaitPage(input.page_id, this.now(), wait);
  }

  async pageCancel(input: { page_id: string; reason?: string }): Promise<{ cancelled: true }> {
    const cancelled = await this.client.cancelPage(input.page_id, input.reason);
    if (cancelled.ok || isAlreadyGone(cancelled.reason)) return { cancelled: true };
    throw new BipeurError(`the page could not be cancelled: ${cancelled.reason}`);
  }

  private async awaitPage(pageId: string, started: number, waitSeconds: number): Promise<PageResult> {
    const timeout = Math.min(this.budgetMs, waitSeconds * 1000 + 5000);
    const decision = await this.client.waitDecision(pageId, waitSeconds, timeout);
    if (!decision.ok) {
      if (decision.timedOut) {
        return { status: 'pending', page_id: pageId, latency_ms: this.now() - started };
      }
      throw new BipeurError(`the Central is unreachable: ${decision.reason}`);
    }
    const value = decision.value;
    return {
      status: value.status,
      page_id: pageId,
      choice: value.choice ?? null,
      latency_ms: value.status === 'pending' ? this.now() - started : value.latency_ms,
    };
  }
}

/** A page that is already gone is cancelled as far as the caller is concerned. */
function isAlreadyGone(reason: string): boolean {
  return reason.includes(' 404') || reason.includes(' 409');
}
