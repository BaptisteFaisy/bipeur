/**
 * The only place where `bip` speaks HTTP to the Central.
 * Payloads are validated with the shared zod schemas of `@bipeur/core`, so the
 * CLI can never drift from the contract (A.9).
 */
import {
  createPageRequestSchema,
  noticeRequestSchema,
  waitResponseSchema,
  type CreatePageRequest,
  type WaitResponse,
} from '@bipeur/core';
import { z } from 'zod';
import { CliError } from './errors.js';

export interface PageSummary {
  id: string;
  /** The line as the Central composed it: `CODE STATION VERB subject #hhhh`. */
  line: string;
  expiresAt: number | null;
}

export interface CentralClient {
  createPage(request: CreatePageRequest): Promise<PageSummary>;
  waitDecision(pageId: string, waitSeconds: number): Promise<WaitResponse>;
  postNotice(line: string, station?: string): Promise<void>;
}

export interface ClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Per-request ceiling; a wait of 50 s needs more than the default. */
  timeoutMs?: number;
}

type Caller = (path: string, init: RequestInit) => Promise<unknown>;

const pageResponseSchema = z.object({
  id: z.string().min(1),
  line: z.string(),
  expires_at: z.number().optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The Central may answer the page itself or `{ page: … }`; accept both. */
function readPage(raw: unknown): PageSummary {
  const candidate = isRecord(raw) && isRecord(raw['page']) ? raw['page'] : raw;
  const parsed = pageResponseSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new CliError('the Central answered with an unexpected page shape', 'invalid');
  }
  return { id: parsed.data.id, line: parsed.data.line, expiresAt: parsed.data.expires_at ?? null };
}

/** One authenticated JSON round trip. A network failure is never a decision. */
function createCaller(options: ClientOptions): Caller {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const base = options.baseUrl.replace(/\/+$/, '');

  return async (path, init) => {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CliError(`central unreachable at ${base} (${reason})`, 'network');
    }
    if (!response.ok) {
      throw new CliError(`central answered ${response.status} on ${init.method ?? 'GET'} ${path}`, 'status');
    }
    try {
      return await response.json();
    } catch {
      throw new CliError(`central answered with a non-JSON body on ${path}`, 'invalid');
    }
  };
}

export function createCentralClient(options: ClientOptions): CentralClient {
  const call = createCaller(options);

  return {
    async createPage(request) {
      const body = createPageRequestSchema.parse(request);
      return readPage(await call('/v1/pages', { method: 'POST', body: JSON.stringify(body) }));
    },

    async waitDecision(pageId, waitSeconds) {
      const path = `/v1/pages/${encodeURIComponent(pageId)}/decision?wait=${waitSeconds}`;
      const parsed = waitResponseSchema.safeParse(await call(path, { method: 'GET' }));
      if (!parsed.success) {
        throw new CliError('the Central answered with an unexpected decision shape', 'invalid');
      }
      return parsed.data;
    },

    async postNotice(line, station) {
      const body = noticeRequestSchema.parse(station === undefined ? { line } : { line, station });
      await call('/v1/notices', { method: 'POST', body: JSON.stringify(body) });
    },
  };
}
