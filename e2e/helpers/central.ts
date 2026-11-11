/**
 * Typed client of the Central API, used by every E2E scenario.
 *
 * The client speaks the real API of the Central (A.9): it authenticates as a
 * post with the station token, and it signs a decision with the ECDSA P-256
 * key of a paired device — exactly what the pager does in the browser.
 */
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { decisionSigningString, type DecisionClaims } from '@bipeur/core';
import { fingerprint } from '@bipeur/core/node';
import { portFor } from './ports.js';

export interface PageView {
  page_id: string;
  state: string;
  line: string;
  code: number;
  risk: 'green' | 'amber' | 'red';
  fingerprint: string;
  expires_at: number;
  detail: string[];
  options: { code: string; label: string }[];
  kind: 'tool' | 'question';
  station: string;
  created_at: number;
  delivered_at: number | null;
  read_at: number | null;
  callback_url: string | null;
}

export interface AuditEvent {
  ts: number;
  type: string;
  page_id: string | null;
  source_id: string | null;
  device_id: string | null;
  fingerprint: string | null;
  data: Record<string, unknown>;
}

export interface WaitResponse {
  status: 'approved' | 'denied' | 'choice' | 'expired' | 'cancelled' | 'pending';
  page_id: string;
  choice: string | null;
  reason: string | null;
  fingerprint: string;
  latency_ms: number;
}

export interface DeviceCredentials {
  deviceId: string;
  deviceToken: string;
  publicKeyJwk: JsonWebKey;
  privateKey: KeyObject;
}

export interface PairingWire {
  pairing_id: string;
  code: string;
  expires_at: number;
  qr_url: string;
  pair_url: string;
}

export interface DemoSession {
  visitor_id: string;
  station_token: string;
  device_token: string;
  device_id: string;
  pager_url: string;
  expires_at: number;
}

export interface CentralBase {
  url: string;
  token: string;
}

/** The address of the Central under test; the launcher writes it down. */
export function centralBase(): CentralBase {
  return {
    url: process.env.BIPEUR_E2E_URL ?? `http://127.0.0.1:${portFor('sharedCentral')}`,
    token: process.env.BIPEUR_E2E_TOKEN ?? 'e2e-station-token',
  };
}

/** A client bound to one Central: the shared one, or a dedicated one. */
export class Central {
  constructor(readonly base: CentralBase) {}

  /** The station token of the first post. */
  get token(): string {
    return this.base.token;
  }

  get url(): string {
    return this.base.url;
  }

  async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.base.url}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
    }
    return body as T;
  }

  /** Creates a page as a post; the Central composes the line from the payload. */
  createPage(body: Record<string, unknown>, token = this.base.token): Promise<PageView> {
    return this.call<PageView>('/v1/pages', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  getPage(pageId: string, token = this.base.token): Promise<PageView> {
    return this.call<PageView>(`/v1/pages/${pageId}`, { headers: { authorization: `Bearer ${token}` } });
  }

  /** BIP-F-06: waits for the decision, at most `wait` seconds. */
  waitDecision(pageId: string, wait = 5): Promise<WaitResponse> {
    return this.call<WaitResponse>(`/v1/pages/${pageId}/decision?wait=${wait}`);
  }

  audit(limit = 100, type?: string, token = this.base.token): Promise<{ events: AuditEvent[] }> {
    const query = type ? `?limit=${limit}&type=${type}` : `?limit=${limit}`;
    return this.call<{ events: AuditEvent[] }>(`/v1/audit${query}`, { headers: { authorization: `Bearer ${token}` } });
  }

  devices(token = this.base.token): Promise<{ devices: { device_id: string; name: string }[] }> {
    return this.call('/v1/devices', { headers: { authorization: `Bearer ${token}` } });
  }

  notices(token = this.base.token): Promise<{ notices: { line: string }[] }> {
    return this.call('/v1/notices', { headers: { authorization: `Bearer ${token}` } });
  }

  createPairing(token = this.base.token): Promise<PairingWire> {
    return this.call<PairingWire>('/v1/pairings', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: '{}',
    });
  }

  /** BIP-F-15: the pairing code is the credential of a device registration. */
  async pairDevice(pairing: PairingWire, name = 'E2E pager'): Promise<DeviceCredentials> {
    const keys = generateDeviceKeys();
    const device = await this.call<{ device_id: string; device_token: string }>('/v1/devices', {
      method: 'POST',
      body: JSON.stringify({
        pairing_id: pairing.pairing_id,
        code: pairing.code,
        device_name: name,
        public_key_jwk: keys.publicKeyJwk,
      }),
    });
    return {
      deviceId: device.device_id,
      deviceToken: device.device_token,
      publicKeyJwk: keys.publicKeyJwk,
      privateKey: keys.privateKey,
    };
  }

  /** Sends a signed decision as the paired device. */
  async decide(
    pageId: string,
    credentials: DeviceCredentials,
    decision: DecisionClaims & { signature: string },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${this.base.url}/v1/pages/${pageId}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${credentials.deviceToken}`,
      },
      body: JSON.stringify(decision),
    });
    const body: unknown = await response.json().catch(() => ({}));
    return { status: response.status, body: body as Record<string, unknown> };
  }

  startDemo(): Promise<DemoSession> {
    return this.call<DemoSession>('/v1/demo/start', { method: 'POST', body: '{}' });
  }

  /** The pending pages of a device, as the pager lists them. */
  devicePages(
    deviceId: string,
    deviceToken: string,
  ): Promise<{ pages: PageView[] }> {
    return this.call<{ pages: PageView[] }>(`/v1/devices/${deviceId}/pages?state=pending`, {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
  }
}

/** A fresh ECDSA P-256 key pair, the one a pager generates when it pairs. */
export function generateDeviceKeys(): { publicKeyJwk: JsonWebKey; privateKey: KeyObject } {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicKeyJwk: pair.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    privateKey: pair.privateKey,
  };
}

/** Signs a decision the way the pager does: the exact claims, then the bytes. */
export function signDecision(
  credentials: DeviceCredentials,
  claims: Omit<DecisionClaims, 'device_id' | 'expires_at'> & { expires_at?: number },
): DecisionClaims & { signature: string } {
  const full: DecisionClaims = {
    ...claims,
    device_id: credentials.deviceId,
    expires_at: claims.expires_at ?? Date.now() + 60_000,
  };
  const signature = cryptoSign(
    'sha256',
    Buffer.from(decisionSigningString(full), 'utf8'),
    { key: credentials.privateKey, dsaEncoding: 'ieee-p1363' },
  );
  return { ...full, signature: signature.toString('base64') };
}

/** The fingerprint of a tool request, recomputed from the facts alone. */
export function expectedFingerprint(request: Record<string, unknown>): string {
  return fingerprint({
    kind: request.kind,
    tool_name: request.tool_name,
    command: request.command,
    path: request.path,
    cwd: request.cwd,
    branch: request.branch,
    stats: request.stats,
  });
}

/** The shared Central of the run. */
export function sharedCentral(): Central {
  return new Central(centralBase());
}
