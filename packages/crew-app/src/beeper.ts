/**
 * The Beeper Central, seen from the Crew app. Payloads go through the shared
 * zod schemas of `@bipeur/core`, so the app cannot drift from the contract.
 *
 * The HTTP plumbing repeats the CLI's, on purpose: each package of the
 * workspace owns its transport, and a helper shared by both belongs in
 * `packages/core`, which is not this lot's to edit.
 */
import {
  createPageRequestSchema,
  noticeRequestSchema,
  waitResponseSchema,
  type CreatePageRequest,
  type WaitResponse,
} from '@bipeur/core';
import { z } from 'zod';

export interface PageSummary {
  id: string;
  line: string;
}

export interface BeeperClient {
  createPage(request: CreatePageRequest): Promise<PageSummary>;
  waitDecision(pageId: string, waitSeconds: number): Promise<WaitResponse>;
  postNotice(line: string, station?: string): Promise<void>;
}

export interface BeeperClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class BeeperError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'status' | 'invalid' = 'network',
  ) {
    super(message);
    this.name = 'BeeperError';
  }
}

type Caller = (path: string, init: RequestInit) => Promise<unknown>;

const pageResponseSchema = z.object({ id: z.string().min(1), line: z.string() });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createCaller(options: BeeperClientOptions): Caller {
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
      throw new BeeperError(`beeper central unreachable at ${base} (${reason})`, 'network');
    }
    if (!response.ok) {
      throw new BeeperError(`beeper central answered ${response.status} on ${path}`, 'status');
    }
    try {
      return await response.json();
    } catch {
      throw new BeeperError(`beeper central answered a non-JSON body on ${path}`, 'invalid');
    }
  };
}

export function createBeeperClient(options: BeeperClientOptions): BeeperClient {
  const call = createCaller(options);

  return {
    async createPage(request) {
      const body = createPageRequestSchema.parse(request);
      const raw = await call('/v1/pages', { method: 'POST', body: JSON.stringify(body) });
      const candidate = isRecord(raw) && isRecord(raw['page']) ? raw['page'] : raw;
      const parsed = pageResponseSchema.safeParse(candidate);
      if (!parsed.success) throw new BeeperError('unexpected page shape', 'invalid');
      return parsed.data;
    },

    async waitDecision(pageId, waitSeconds) {
      const path = `/v1/pages/${encodeURIComponent(pageId)}/decision?wait=${waitSeconds}`;
      const parsed = waitResponseSchema.safeParse(await call(path, { method: 'GET' }));
      if (!parsed.success) throw new BeeperError('unexpected decision shape', 'invalid');
      return parsed.data;
    },

    async postNotice(line, station) {
      const body = noticeRequestSchema.parse(station === undefined ? { line } : { line, station });
      await call('/v1/notices', { method: 'POST', body: JSON.stringify(body) });
    },
  };
}
