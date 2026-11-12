/**
 * The Central side of the emulator: the emulator is a device of the Central,
 * exactly like the PWA (BIP-F-15).
 *
 *   POST /v1/devices                      → { device_id, device_token }
 *   POST /v1/pages/:id/decision           → { accepted, reason }
 *   GET  /v1/devices/:id/pages?state=…    → the page and its fingerprint
 *
 * Every answer is validated before it is used: a Central that answers
 * something else must not look like a pairing that worked.
 */
import { signedDecisionSchema, type SignedDecision } from '@bipeur/core';
import { z } from 'zod';

export interface CentralOptions {
  /** Base URL of the Central, e.g. `http://127.0.0.1:8787`. */
  baseUrl: string;
  /** Injected in the tests: no network, no port, no timer. */
  fetchImpl?: typeof fetch;
  /** Ceiling of a single call, in milliseconds. */
  timeoutMs?: number;
}

/** What the Central answers when the emulator pairs itself. */
export interface Pairing {
  deviceId: string;
  token: string;
}

/** What the Central answers when the emulator sends a decision. */
export interface DecisionAck {
  accepted: boolean;
  reason: string | null;
}

/** The Central side of the emulator, injectable in the tests. */
export interface CentralApi {
  /** Register the public key against a six-character pairing code. */
  pair(code: string, publicKeyJwk: JsonWebKey, deviceName: string): Promise<Pairing>;
  /** Send a signed decision; the Central verifies it (BIP-F-18). */
  postDecision(pageId: string, decision: SignedDecision, token: string): Promise<DecisionAck>;
  /**
   * The fingerprint of a page, when the gateway did not push it: the Central
   * computes it, and the claims must carry it (BIP-P-05).
   */
  fingerprintOf(pageId: string, deviceId: string, token: string): Promise<string | null>;
}

/** The Central is unreachable or answered something else: never a decision. */
export class CentralError extends Error {
  override name = 'CentralError';
}

const deviceResponseSchema = z.object({
  device_id: z.string().min(1),
  device_token: z.string().min(1),
});

const decisionAckSchema = z.object({
  accepted: z.boolean().optional(),
  status: z.enum(['accepted', 'rejected', 'duplicate']).optional(),
  reason: z.string().nullable().optional(),
});

const pageSchema = z.object({
  page_id: z.string().min(1),
  fingerprint: z.string().min(1),
});

const pageListSchema = z.union([z.array(pageSchema), z.object({ pages: z.array(pageSchema) })]);

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

/** The HTTP client of the Central, as the emulator uses it. */
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
      const parsed = deviceResponseSchema.safeParse(
        await call('/v1/devices', { method: 'POST', body }),
      );
      if (!parsed.success) {
        throw new CentralError('the central answered with an unexpected device shape');
      }
      return { deviceId: parsed.data.device_id, token: parsed.data.device_token };
    },

    async postDecision(pageId, decision, token) {
      const payload = signedDecisionSchema.parse(decision);
      const body = JSON.stringify(payload);
      const raw = (await call(`/v1/pages/${encodeURIComponent(pageId)}/decision`, {
        method: 'POST',
        body,
        headers: bearer(token),
      })) as Record<string, unknown>;
      const parsed = decisionAckSchema.safeParse(raw);
      if (!parsed.success) {
        throw new CentralError('the central answered with an unexpected decision shape');
      }
      const accepted = parsed.data.accepted ?? parsed.data.status === 'accepted';
      return { accepted, reason: parsed.data.reason ?? null };
    },

    async fingerprintOf(pageId, deviceId, token) {
      const path = `/v1/devices/${encodeURIComponent(deviceId)}/pages?state=pending`;
      const raw = await call(path, { method: 'GET', headers: bearer(token) });
      const parsed = pageListSchema.safeParse(raw);
      if (!parsed.success) return null;
      const pages = Array.isArray(parsed.data) ? parsed.data : parsed.data.pages;
      const page = pages.find((item) => item.page_id === pageId);
      return page?.fingerprint ?? null;
    },
  };
}
