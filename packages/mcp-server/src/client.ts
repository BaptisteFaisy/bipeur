/**
 * The three Central calls the MCP tools need: create a question page, wait for
 * its decision, cancel it (A.9).
 *
 * The hook has the same plumbing; it cannot be shared here because a workspace
 * dependency on `@bipeur/hook` would change the frozen lockfile, which this lot
 * must not touch. This is the smallest possible copy, and it goes away with
 * that dependency.
 */
import { waitResponseSchema, type CreatePageRequest, type WaitResponse } from '@bipeur/core';
import type { FetchLike, Result } from './types.js';

/** The `question` half of the page contract of A.9. */
type QuestionPageRequest = Extract<CreatePageRequest, { kind: 'question' }>;

export interface BipeurClientOptions {
  url: string;
  token: string;
  fetchImpl?: FetchLike;
}

export class BipeurClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: BipeurClientOptions) {
    this.base = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async createQuestion(request: QuestionPageRequest): Promise<Result<{ id: string }>> {
    const sent = await this.send('POST', '/v1/pages', request, 10_000);
    if (!sent.ok) return sent;
    const id = pageIdOf(sent.value);
    if (!id) return { ok: false, reason: 'the Central did not return a page id' };
    return { ok: true, value: { id } };
  }

  /** One long poll, bounded by `timeoutMs` so the tool answers in time. */
  async waitDecision(
    pageId: string,
    waitSeconds: number,
    timeoutMs: number,
  ): Promise<Result<WaitResponse>> {
    const path = `/v1/pages/${encodeURIComponent(pageId)}/decision?wait=${waitSeconds}`;
    const sent = await this.send('GET', path, undefined, timeoutMs);
    if (!sent.ok) return sent;
    const parsed = waitResponseSchema.safeParse(sent.value);
    if (!parsed.success) {
      return { ok: false, reason: 'the Central answered with an unexpected decision payload' };
    }
    return { ok: true, value: parsed.data };
  }

  async cancelPage(pageId: string, reason?: string): Promise<Result<unknown>> {
    const path = `/v1/pages/${encodeURIComponent(pageId)}`;
    return this.send('DELETE', path, reason ? { reason } : undefined, 10_000);
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<Result<unknown>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: 'application/json',
    };
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, init);
    } catch (error) {
      return { ok: false, reason: `cannot reach the Central at ${this.base} (${errorName(error)})`, timedOut: isTimeout(error) };
    }
    const text = await responseText(response);
    if (!response.ok) {
      return { ok: false, reason: `the Central answered ${response.status}${detailOf(text)}` };
    }
    return { ok: true, value: parseJson(text) };
  }
}

async function responseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseJson(text: string): unknown {
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pageIdOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record['id'] === 'string') return record['id'];
  if (typeof record['page_id'] === 'string') return record['page_id'];
  const page = record['page'];
  if (page && typeof page === 'object') {
    const nested = (page as Record<string, unknown>)['id'];
    if (typeof nested === 'string') return nested;
  }
  return null;
}

function detailOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length === 0 ? '' : `: ${flat.slice(0, 120)}`;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name || 'error' : 'error';
}

function isTimeout(error: unknown): boolean {
  const name = errorName(error);
  return name === 'TimeoutError' || name === 'AbortError';
}
