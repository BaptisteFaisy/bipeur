/**
 * The gate's client of the Central API (BIP-F-48, A.9).
 *
 * Deliberately dependency-free: a JavaScript action runs straight from the
 * checkout in `$GITHUB_WORKSPACE/../_actions`, where no `node_modules` exist, so
 * it cannot import `@bipeur/core` or `zod`. Each adapter of this repo carries its
 * own thin client (`packages/cli/src/api.ts`, `packages/hook/src/central-client.ts`,
 * `packages/mcp-server/src/client.ts`) — this is the fourth, and it speaks the
 * same three endpoints: `POST /v1/pages`, `GET /v1/pages/:id/decision?wait=N`.
 *
 * The readers of the answers are pure (`pageOf`, `waitOf`) so the shape of the
 * wire is tested without a socket.
 */
import { GateError, messageOf } from './errors.js';
import { redact, secretList, oneLine } from './redact.js';
import { STATUSES } from './verdict.js';

/** Extra grace over a long poll, so the client does not hang up before the server. */
export const LONG_POLL_MARGIN_MS = 10_000;
export const SHORT_CALL_MS = 15_000;

/**
 * `POST /v1/pages` answers the page itself (`page_id`, A.9); older adapters
 * tolerated `{id}` and `{page:{id}}`. All three are accepted, none is invented.
 *
 * @param {unknown} raw
 */
export function pageOf(raw) {
  const record = unwrap(raw);
  const id = stringAt(record, 'page_id') || stringAt(record, 'id');
  if (!id) throw new GateError('the Central did not return a page id');
  return {
    id,
    line: stringAt(record, 'line'),
    fingerprint: stringAt(record, 'fingerprint') || stringAt(record, 'payload_sha256'),
    code: numberAt(record, 'code'),
    risk: stringAt(record, 'risk'),
    expiresAt: numberAt(record, 'expires_at'),
    station: stringAt(record, 'station'),
  };
}

/**
 * `GET /v1/pages/:id/decision` answers a `WaitResponse`. A missing status is a
 * malformed answer, never a pending page: the gate must not keep waiting on a
 * body it cannot read.
 *
 * @param {unknown} raw
 */
export function waitOf(raw) {
  const record = unwrap(raw);
  const status = stringAt(record, 'status');
  if (!status) throw new GateError('the Central answered a decision with no status');
  if (!STATUSES.includes(status)) {
    throw new GateError(`the Central answered an unknown status "${status}"`);
  }
  return {
    status,
    simulated: record['simulated'] === true,
    choice: nullableString(record, 'choice'),
    reason: nullableString(record, 'reason'),
    pageId: stringAt(record, 'page_id'),
    fingerprint: stringAt(record, 'fingerprint'),
    latencyMs: numberAt(record, 'latency_ms'),
  };
}

/** @param {string|number} path @param {RequestInit} init */
export function requestOf(baseUrl, path, init) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  return { url: `${base}${path}`, init };
}

/**
 * @param {{url: string, token: string, fetchImpl?: typeof fetch,
 *   setTimeoutImpl?: typeof setTimeout, clearTimeoutImpl?: typeof clearTimeout,
 *   secrets?: (string|null|undefined)[]}} options
 */
export function createCentral(options) {
  const base = options.url.replace(/\/+$/, '');
  const secrets = secretList([options.token, ...(options.secrets ?? [])]);
  const send = (method, path, init, timeoutMs) =>
    sendOnce({ options, base, secrets, token: options.token }, method, path, init, timeoutMs);

  return {
    /** @param {Record<string, unknown>} body */
    async createPage(body) {
      const answer = await send('POST', '/v1/pages', { body: JSON.stringify(body) }, SHORT_CALL_MS);
      return pageOf(answer);
    },
    /** @param {string} pageId @param {number} seconds */
    async waitDecision(pageId, seconds) {
      const path = `/v1/pages/${encodeURIComponent(pageId)}/decision?wait=${seconds}`;
      const answer = await send('GET', path, undefined, seconds * 1000 + LONG_POLL_MARGIN_MS);
      return waitOf(answer);
    },
    /** Best effort: leaving a page open is not the gate's job to fail on. */
    async cancelPage(pageId) {
      return send('DELETE', `/v1/pages/${encodeURIComponent(pageId)}`, undefined, SHORT_CALL_MS);
    },
  };
}

/**
 * One call to the Central, with its own abort timer.
 *
 * Extracted from `createCentral` on 2026-11-14: nesting it made the factory a
 * 51-line function, and the rule is a function under 50 lines. The behaviour is
 * identical — same headers, same timer, same redaction of the token on every
 * path, including the one where the network echoes it back.
 *
 * @param {{options: {fetchImpl?: typeof fetch, setTimeoutImpl?: typeof setTimeout,
 *   clearTimeoutImpl?: typeof clearTimeout, token: string},
 *   base: string, secrets: (string|null|undefined)[], token: string}} ctx
 */
async function sendOnce(ctx, method, path, init, timeoutMs) {
  const fetchImpl = ctx.options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = (ctx.options.setTimeoutImpl ?? setTimeout)(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${ctx.base}${path}`, {
      method,
      ...init,
      headers: {
        authorization: `Bearer ${ctx.token}`,
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new GateError(`the Central answered ${response.status}${suffixOf(text)}`);
    }
    return parseJson(text, path);
  } catch (error) {
    // The token is stripped from anything the network may have echoed back.
    throw new GateError(redact(oneLine(messageOf(error)), ctx.secrets));
  } finally {
    (ctx.options.clearTimeoutImpl ?? clearTimeout)(timer);
  }
}

function unwrap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const record = /** @type {Record<string, unknown>} */ (raw);
  const nested = record['page'];
  return nested && typeof nested === 'object' ? /** @type {Record<string, unknown>} */ (nested) : record;
}

function stringAt(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function nullableString(record, key) {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

function numberAt(record, key) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function suffixOf(text) {
  const flat = oneLine(text ?? '', 120);
  return flat ? `: ${flat}` : '';
}

function parseJson(text, path) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new GateError(`the Central answered a non-JSON body on ${path}`);
  }
}
