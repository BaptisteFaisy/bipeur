/**
 * Client of the Central API used by the hook (A.9):
 * `POST /v1/pages`, `GET /v1/pages/:id/decision?wait=N`, `POST /v1/notices`.
 *
 * Every method returns a `Result`: an unreachable Central is a value the caller
 * turns into a refusal, never an exception that escapes and never an approval.
 */
import {
  waitResponseSchema,
  type CreatePageRequest,
  type WaitResponse,
} from '@bipeur/core';
import type { FetchLike, Result } from './types.js';

export interface CentralClientOptions {
  url: string;
  token: string;
  fetchImpl?: FetchLike;
  /** HTTP timeout of the short calls (create, cancel, notice). */
  timeoutMs?: number;
}

/** Extra time granted to a long poll over the `wait` it asked for. */
const LONG_POLL_MARGIN_MS = 10_000;

export class CentralClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: CentralClientOptions) {
    this.base = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Creates the page; returns its id. The fingerprint comes back from the wait. */
  async createPage(request: CreatePageRequest): Promise<Result<{ id: string }>> {
    const sent = await this.send('POST', '/v1/pages', request, this.timeoutMs);
    if (!sent.ok) return sent;
    const id = pageIdOf(sent.value);
    if (!id) return { ok: false, reason: 'the Central did not return a page id' };
    return { ok: true, value: { id } };
  }

  /** One long poll. `pending` means "ask again", not "no". */
  async waitDecision(pageId: string, waitSeconds: number): Promise<Result<WaitResponse>> {
    const path = `/v1/pages/${encodeURIComponent(pageId)}/decision?wait=${waitSeconds}`;
    const timeout = waitSeconds * 1000 + LONG_POLL_MARGIN_MS;
    const sent = await this.send('GET', path, undefined, timeout);
    if (!sent.ok) return sent;
    const parsed = waitResponseSchema.safeParse(sent.value);
    if (!parsed.success) {
      return { ok: false, reason: 'the Central answered with an unexpected decision payload' };
    }
    return { ok: true, value: parsed.data };
  }

  async cancelPage(pageId: string, reason?: string): Promise<Result<unknown>> {
    const path = `/v1/pages/${encodeURIComponent(pageId)}`;
    return this.send('DELETE', path, reason ? { reason } : undefined, this.timeoutMs);
  }

  /** A notice is best effort: the caller never fails the turn on it (BIP-F-25). */
  async postNotice(line: string): Promise<Result<unknown>> {
    return this.send('POST', '/v1/notices', { line }, this.timeoutMs);
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
      // The token never appears in a message: only the host and the error name.
      return { ok: false, reason: `cannot reach the Central at ${this.base} (${errorName(error)})` };
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

/** `{id}`, `{page_id}` and `{page:{id}}` are all accepted: the Central is young. */
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
  if (flat.length === 0) return '';
  return `: ${flat.slice(0, 120)}`;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name || 'error';
  return 'error';
}
