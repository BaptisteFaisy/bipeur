/**
 * The Central side of the hardware pager: the pager is a device of the
 * Central, exactly like the PWA (BIP-F-15).
 *
 *   POST /v1/devices                      → { device_id, device_token, name }
 *   GET  /v1/devices/:id/pages?state=…    → { pages: [ … ] }
 *   POST /v1/pages/:id/decision           → { accepted, reason }
 *
 * Every answer is validated before it is used: a Central that answers
 * something else must not look like a pairing that worked.
 */
import type { SignedDecision } from '@bipeur/core';

export interface CentralOptions {
  /** Base URL of the Central, e.g. `https://central.example.net`. */
  baseUrl: string;
  /** Injected in the tests: no network, no port, no timer. */
  fetchImpl?: typeof fetch;
  /** Ceiling of a single call, in milliseconds. */
  timeoutMs?: number;
}

/** What the Central answers when the pager pairs itself. */
export interface Pairing {
  deviceId: string;
  token: string;
  name: string;
}

/** One choice the pager can press, as the Central seeded it. */
export interface PendingOption {
  code: string;
  label: string;
}

/** A page the Central has pending for the device. */
export interface PendingPage {
  pageId: string;
  fingerprint: string;
  line: string;
  code: number;
  risk: 'green' | 'amber' | 'red';
  station: string;
  options: PendingOption[];
}

/** What the Central answers when the pager posts a decision. */
export interface DecisionAck {
  accepted: boolean;
  reason: string | null;
}

/** The Central side of the pager, injectable in the tests. */
export interface CentralApi {
  /** Register the public key against a six-character pairing code. */
  pair(code: string, publicKeyJwk: JsonWebKey, deviceName: string): Promise<Pairing>;
  /** The pending pages of the device, oldest first. */
  pendingPages(deviceId: string, token: string): Promise<PendingPage[]>;
  /** Send a signed decision; the Central verifies it (BIP-F-18). */
  postDecision(pageId: string, decision: SignedDecision, token: string): Promise<DecisionAck>;
}

/** The Central is unreachable or answered something else: never a decision. */
export class CentralError extends Error {
  override name = 'CentralError';
}

type Caller = (path: string, init: RequestInit) => Promise<unknown>;

/** One authenticated JSON round trip. A network failure is never a decision. */
function createCaller(options: CentralOptions): Caller {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const base = options.baseUrl.replace(/\/+$/, '');

  return async (path, init) => {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CentralError(`central unreachable at ${base} (${reason})`);
    }
    if (!response.ok) {
      throw new CentralError(`central answered ${response.status} on ${init.method ?? 'GET'} ${path}`);
    }
    try {
      return await response.json();
    } catch {
      throw new CentralError(`central answered with a non-JSON body on ${path}`);
    }
  };
}

/** `Authorization: Bearer <token>` — the device token of the pairing. */
function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Is this a plain JSON object? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a non-empty string field, or throw: a wrong shape never deceives. */
function readString(value: unknown, path: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new CentralError(`the central answered with a malformed ${path}`);
}

function readRisk(value: unknown): PendingPage['risk'] {
  if (value === 'green' || value === 'amber' || value === 'red') return value;
  return 'amber';
}

function readOptions(value: unknown): PendingOption[] {
  if (!Array.isArray(value)) return [];
  const options: PendingOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const code = item.code;
    const label = item.label;
    if (typeof code !== 'string' || typeof label !== 'string') continue;
    options.push({ code, label });
  }
  return options;
}

function readPage(value: unknown): PendingPage {
  if (!isRecord(value)) throw new CentralError('the central answered with a non-object page');
  return {
    pageId: readString(value.page_id, 'page_id'),
    fingerprint: readString(value.fingerprint, 'fingerprint'),
    line: readString(value.line, 'line'),
    code: typeof value.code === 'number' ? value.code : 100,
    risk: readRisk(value.risk),
    station: typeof value.station === 'string' ? value.station : 'agent',
    options: readOptions(value.options),
  };
}

/** The HTTP client of the Central, as the hardware pager uses it. */
export function createCentralApi(options: CentralOptions): CentralApi {
  const call = createCaller(options);

  return {
    async pair(code, publicKeyJwk, deviceName) {
      const body = JSON.stringify({
        code,
        device_name: deviceName,
        public_key_jwk: publicKeyJwk,
        push_subscription: null,
      });
      const raw = await call('/v1/devices', { method: 'POST', body });
      if (!isRecord(raw)) throw new CentralError('the central answered with a non-object device');
      return {
        deviceId: readString(raw.device_id, 'device_id'),
        token: readString(raw.device_token, 'device_token'),
        name: typeof raw.name === 'string' ? raw.name : deviceName,
      };
    },

    async pendingPages(deviceId, token) {
      const path = `/v1/devices/${encodeURIComponent(deviceId)}/pages?state=pending`;
      const raw = await call(path, { method: 'GET', headers: bearer(token) });
      const list = isRecord(raw) && raw.pages !== undefined ? raw.pages : raw;
      if (!Array.isArray(list)) throw new CentralError('the central answered with a non-list of pages');
      return list.map(readPage);
    },

    async postDecision(pageId, decision, token) {
      const body = JSON.stringify(decision);
      const raw = (await call(`/v1/pages/${encodeURIComponent(pageId)}/decision`, {
        method: 'POST',
        body,
        headers: bearer(token),
      })) as unknown;
      if (!isRecord(raw)) throw new CentralError('the central answered with a non-object ack');
      const status = raw.accepted ?? raw.status === 'accepted';
      return {
        accepted: status === true,
        reason: typeof raw.reason === 'string' ? raw.reason : null,
      };
    },
  };
}