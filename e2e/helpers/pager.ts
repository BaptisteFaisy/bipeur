/**
 * Browser side of the scenarios: the pager UI and the bridge between the
 * pager prototype and the Central.
 */
import type { Page } from '@playwright/test';

export interface BridgeOptions {
  centralUrl: string;
  /** The pairing the user reads on the Central dashboard. */
  pairing?: { pairing_id: string; code: string };
  /** The device token of an already paired device (the demo, for instance). */
  deviceToken?: string;
  deviceId?: string;
}

export interface BridgeSession {
  deviceId: string | null;
  deviceToken: string | null;
  decisions: { pageId: string; status: number; body: Record<string, unknown> }[];
}

export function toPagerWire(page: Record<string, unknown>): Record<string, unknown> {
  return {
    id: page.page_id,
    source_id: 'unknown',
    source_alias: page.station,
    kind: page.kind,
    code: page.code,
    risk: page.risk,
    line: page.line,
    detail: page.detail,
    payload: {},
    payload_sha256: page.fingerprint,
    options: page.options,
    state: page.state,
    created_at: page.created_at,
    delivered_at: page.delivered_at,
    read_at: page.read_at,
    expires_at: page.expires_at,
    dedupe_key: '',
    callback_url: page.callback_url,
  };
}

export async function openPager(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.getByTestId('lcd').waitFor({ state: 'attached' });
}

export async function installBridge(page: Page, options: BridgeOptions): Promise<BridgeSession> {
  const session: BridgeSession = {
    deviceId: options.deviceId ?? null,
    deviceToken: options.deviceToken ?? null,
    decisions: [],
  };

  await installSigner(page);
  await installPairing(page, options, session);
  await installPages(page, options, session);
  await installDecision(page, options, session);
  await installRead(page, options, session);
  return session;
}

async function installSigner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const subtle = window.crypto.subtle;
    const original = subtle.sign.bind(subtle);
    const patched = async (
      algorithm: AlgorithmIdentifier,
      key: CryptoKey,
      data: BufferSource,
    ): Promise<ArrayBuffer> => {
      const target = (window as unknown as { __bipeurDeviceId?: string }).__bipeurDeviceId;
      if (!target) return original(algorithm, key, data);
      const text = new TextDecoder().decode(data as ArrayBuffer);
      const bound = text.replace(/"device_id":"[^"]*"/, `"device_id":"${target}"`);
      return original(algorithm, key, new TextEncoder().encode(bound));
    };
    Object.defineProperty(subtle, 'sign', { configurable: true, value: patched });
  });
}

async function installPairing(
  page: Page,
  options: BridgeOptions,
  session: BridgeSession,
): Promise<void> {
  await page.route('**/v1/pairings', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const pairing = options.pairing;
    if (!pairing) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no_pairing"}' });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ pairing_id: pairing.pairing_id, device_id: 'pending' }),
    });
  });

  await page.route('**/v1/devices', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    const pairing = options.pairing;
    if (!pairing) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no_pairing"}' });
      return;
    }
    const answer = await fetch(`${options.centralUrl}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairing_id: pairing.pairing_id,
        code: pairing.code,
        device_name: body.device_name,
        public_key_jwk: body.public_key_jwk,
      }),
    });
    const payload = (await answer.json()) as { device_id: string; device_token: string };
    session.deviceId = payload.device_id ?? null;
    session.deviceToken = payload.device_token ?? null;
    await page.evaluate((id) => {
      (window as unknown as { __bipeurDeviceId?: string }).__bipeurDeviceId = id;
    }, session.deviceId);
    // The REAL answer of the Central, unchanged: the pager keeps the token and
    // sends it on every later call and on the WebSocket. Answering the old
    // `{id, name, paired_at}` shape is exactly what kept the pager offline.
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      body: JSON.stringify({
        device_id: payload.device_id,
        device_token: payload.device_token,
        name: body.device_name ?? 'Beeper',
        paired_at: Date.now(),
      }),
    });
  });
}

async function installPages(
  page: Page,
  options: BridgeOptions,
  session: BridgeSession,
): Promise<void> {
  await page.route('**/v1/devices/*/pages*', async (route) => {
    const token = session.deviceToken;
    if (!token) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' });
      return;
    }
    const url = new URL(route.request().url());
    const answer = await fetch(`${options.centralUrl}${url.pathname}${url.search}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = (await answer.json()) as { pages: Record<string, unknown>[] };
    const pages = (payload.pages ?? []).map(toPagerWire);
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      body: JSON.stringify({ pages }),
    });
  });
}

async function installDecision(
  page: Page,
  options: BridgeOptions,
  session: BridgeSession,
): Promise<void> {
  await page.route('**/v1/pages/*/decision', async (route) => {
    // The id is the segment between /pages/ and /decision, not the last one.
    const pageId = new URL(route.request().url()).pathname.split('/')[3] ?? '';
    if (!session.deviceToken || !session.deviceId) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"status":"rejected","reason":"not_paired"}',
      });
      return;
    }
    const signed = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    const body = JSON.stringify({ ...signed, device_id: session.deviceId });
    const answer = await fetch(`${options.centralUrl}/v1/pages/${pageId}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.deviceToken}`,
      },
      body,
    });
    const payload = (await answer.json()) as Record<string, unknown>;
    session.decisions.push({ pageId, status: answer.status, body: payload });
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

async function installRead(
  page: Page,
  options: BridgeOptions,
  session: BridgeSession,
): Promise<void> {
  await page.route('**/v1/pages/*/read', async (route) => {
    const pageId = route.request().url().split('/').pop() ?? '';
    if (!session.deviceToken) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' });
      return;
    }
    const answer = await fetch(`${options.centralUrl}/v1/pages/${pageId}/read`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.deviceToken}` },
    });
    const payload = await answer.text();
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      body: payload || '{}',
    });
  });
}
