/**
 * The Beeper side of the gateway: one page created on the Central, then one
 * decision waited for. The client is an interface so the gateway can be tested
 * in memory, with no HTTP and no network (`.kiro/steering/testing.md` §4).
 *
 *   POST /v1/pages                        → { page_id, fingerprint, line }
 *   GET  /v1/pages/:id/decision?wait=N    → { status, choice?, latency_ms }
 */
import { createPageRequestSchema, isValidCode, isKnownVerb, type CreatePageRequest } from '@bipeur/core';
import type { Choice } from './transaction.js';

export type DecisionStatus =
  | 'approved'
  | 'denied'
  | 'choice'
  | 'expired'
  | 'cancelled'
  | 'pending';

export interface Decision {
  status: DecisionStatus;
  choice: string | null;
  latencyMs: number;
}

export interface CreatedPage {
  pageId: string;
  fingerprint: string;
  line: string;
}

/** Everything SEND collected, handed to the Central. */
export interface PageDraft {
  pager: string;
  message: string;
  choices: readonly Choice[];
  ackRead: boolean;
  ttlSeconds: number;
}

export interface BeeperClient {
  createPage(draft: PageDraft): Promise<CreatedPage>;
  waitDecision(pageId: string, waitSeconds: number): Promise<Decision>;
  /** Page state (`read`, `decided`…), used to report a read acknowledgement. */
  getPageState?(pageId: string): Promise<string | null>;
  /** Is the pager online? A health probe on the Central. */
  isOnline(): Promise<boolean>;
}

/** The smallest slice of `fetch` the client needs; keeps DOM types out. */
export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export class CentralError extends Error {}

/** `310 fw PUSH main>origin 3 commits +120-14 #07c2` → code, station, verb, subject. */
const PAGE_LINE = /^(\d{3})\s+(\S+)\s+([A-Za-z]+)\s+(.+)$/;

export interface ParsedPageLine {
  code?: number;
  station: string;
  verb?: string;
  subject: string;
}

/**
 * A SNPP message already is a page line (A.6), so its fields are forwarded to
 * the Central; anything else becomes a plain question, composed by the Central.
 */
export function parsePageLine(message: string): ParsedPageLine {
  const match = PAGE_LINE.exec(message.trim());
  if (!match) return { station: 'snpp', subject: message.trim() };
  const [, digits, station, word, subject] = match as unknown as string[];
  const code = Number(digits);
  if (!isValidCode(code)) return { station: 'snpp', subject: message.trim() };
  const verb = word!.toUpperCase();
  return { code, station: station!, verb: isKnownVerb(verb) ? verb : undefined, subject: subject! };
}

/** Letter the pager shows for the n-th seeded reply: A, B, C, D. */
const LETTERS = 'ABCD';

/**
 * Wire payload of `POST /v1/pages`. The Central composes the line from these
 * fields (the honesty rule), so the SNPP text is split, never forwarded raw.
 */
export function buildPageRequest(draft: PageDraft): CreatePageRequest {
  const parsed = parsePageLine(draft.message);
  const options =
    draft.choices.length >= 2 && draft.choices.length <= LETTERS.length
      ? draft.choices.map((choice, index) => ({
          code: LETTERS[index] ?? 'A',
          label: (choice.text || choice.code).slice(0, 20),
        }))
      : undefined;
  const candidate = {
    kind: 'question' as const,
    question: parsed.subject.slice(0, 4000),
    station: parsed.station,
    code: parsed.code,
    verb: parsed.verb,
    options,
    ttl_seconds: Math.min(86_400, Math.max(30, Math.round(draft.ttlSeconds))),
  };
  const validated = createPageRequestSchema.safeParse(candidate);
  if (!validated.success) {
    throw new CentralError(`page payload refused: ${validated.error.issues[0]?.message ?? 'invalid'}`);
  }
  return validated.data;
}

export interface HttpClientOptions {
  /** Central base URL, e.g. `http://127.0.0.1:8787`. */
  url: string;
  /** Station token sent as `Authorization: Bearer`. */
  token: string;
  fetchImpl?: FetchLike;
  /** Hard ceiling of a single HTTP call, in milliseconds. */
  timeoutMs?: number;
}

/** One call to the Central, with the station token. */
export type CentralCaller = (
  path: string,
  init: Parameters<FetchLike>[1],
  ms?: number,
) => Promise<unknown>;

/** The call helper shared by every endpoint of the Central. */
function centralCaller(options: HttpClientOptions): CentralCaller {
  const base = options.url.replace(/\/+$/, '');
  const doFetch: FetchLike = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? 10_000;

  return async (
    path: string,
    init: Parameters<FetchLike>[1],
    ms = timeoutMs,
  ): Promise<unknown> => {
    const headers = { authorization: `Bearer ${options.token}`, ...(init.headers ?? {}) };
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(ms),
    });
    if (!response.ok) throw new CentralError(`Central answered ${response.status} on ${path}`);
    return response.json();
  };
}

async function postPage(call: CentralCaller, draft: PageDraft): Promise<CreatedPage> {
  const body = JSON.stringify(buildPageRequest(draft));
  const raw = (await call('/v1/pages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })) as Record<string, unknown>;
  const pageId = String(raw.page_id ?? raw.id ?? '');
  if (!pageId) throw new CentralError('Central returned no page id');
  return {
    pageId,
    fingerprint: String(raw.fingerprint ?? ''),
    line: String(raw.line ?? ''),
  };
}

async function getDecision(
  call: CentralCaller,
  pageId: string,
  waitSeconds: number,
): Promise<Decision> {
  const seconds = Math.max(1, Math.round(waitSeconds));
  const path = `/v1/pages/${encodeURIComponent(pageId)}/decision?wait=${seconds}`;
  const raw = (await call(path, { method: 'GET' }, (seconds + 15) * 1000)) as Record<string, unknown>;
  const status = String(raw.status ?? 'pending') as DecisionStatus;
  const choice = raw.choice === undefined || raw.choice === null ? null : String(raw.choice);
  return { status, choice, latencyMs: Number(raw.latency_ms ?? 0) };
}

async function getState(call: CentralCaller, pageId: string): Promise<string | null> {
  const raw = (await call(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' })) as Record<string, unknown>;
  return raw.state === undefined ? null : String(raw.state);
}

async function probeHealth(call: CentralCaller): Promise<boolean> {
  try {
    await call('/healthz', { method: 'GET' }, 2_000);
    return true;
  } catch {
    return false;
  }
}

export function httpBeeperClient(options: HttpClientOptions): BeeperClient {
  const call = centralCaller(options);
  return {
    createPage: (draft) => postPage(call, draft),
    waitDecision: (pageId, waitSeconds) => getDecision(call, pageId, waitSeconds),
    getPageState: (pageId) => getState(call, pageId),
    isOnline: () => probeHealth(call),
  };
}
