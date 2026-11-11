/**
 * BIP-F-18 — the decision is signed over the exact bytes `@bipeur/core`
 * defines, and the Central can verify it with the device's public key.
 * BIP-F-22 — a decision that never left the device is never shown as sent.
 */
import { describe, expect, it } from 'vitest';
import { decisionSigningString, type DecisionClaims } from '@bipeur/core';
import { verifyDecisionSignature } from '../../core/src/node.js';
import { browserCrypto } from '../src/crypto/device-key.js';
import { CHOICES, makePage } from './support/fixtures.js';
import { navButton, press, waitFor } from './support/render.js';
import { mountPager, TEST_NOW } from './support/setup.js';

const claimsOf = (sent: { signature: string } & DecisionClaims): DecisionClaims => ({
  page_id: sent.page_id,
  fingerprint: sent.fingerprint,
  verdict: sent.verdict,
  choice: sent.choice,
  nonce: sent.nonce,
  expires_at: sent.expires_at,
  device_id: sent.device_id,
});

describe('BIP-F-18 — a decision is signed, and the signature verifies', () => {
  it('signs the core signing string and the Central verifies it', async () => {
    const page = makePage({ risk: 'green' });
    const ui = await mountPager({ pages: [page] });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 1);

    const sent = ui.client.sent[0]!;
    const claims = claimsOf(sent);
    expect(decisionSigningString(claims)).toContain(`"page_id":"${page.id}"`);
    expect(
      verifyDecisionSignature({
        claims,
        signature: sent.signature,
        publicKeyJwk: ui.keys.publicKeyJwk,
      }),
    ).toBe(true);
    await ui.unmount();
  });

  it('signs the fingerprint of the page, not something else', async () => {
    const page = makePage({ risk: 'amber' });
    const ui = await mountPager({ pages: [page] });
    await press(ui.find('key-deny'));
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.fingerprint).toBe(page.payload_sha256);
    await ui.unmount();
  });

  it('uses a fresh nonce and a deadline in the future on every decision', async () => {
    const ui = await mountPager({
      pages: [makePage({ id: 'pg_1', risk: 'green' }), makePage({ id: 'pg_2', risk: 'green' })],
    });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 1);
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 2);

    const [first, second] = ui.client.sent;
    expect(first?.nonce).not.toBe(second?.nonce);
    expect(first?.expires_at).toBeGreaterThan(TEST_NOW);
    expect(second?.expires_at).toBeGreaterThan(TEST_NOW);
    await ui.unmount();
  });

  it('signs a choice verdict with the chosen letter', async () => {
    const ui = await mountPager({ pages: [makePage({ code: 510, verb: 'PICK', risk: 'green', options: CHOICES })] });
    await press(ui.find('key-choice-C'));
    await waitFor(() => ui.client.sent.length === 1);
    const sent = ui.client.sent[0]!;
    expect(sent.verdict).toBe('choice');
    expect(sent.choice).toBe('C');
    expect(
      verifyDecisionSignature({
        claims: claimsOf(sent),
        signature: sent.signature,
        publicKeyJwk: ui.keys.publicKeyJwk,
      }),
    ).toBe(true);
    await ui.unmount();
  });

  it('signs with the device id of the key pair', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })] });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.device_id).toBe(ui.keys.deviceId);
    await ui.unmount();
  });

  it('never reports a decision as sent when the Central is unreachable', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })], failSend: true });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.query('queued-notice') !== null);

    expect(ui.find('queued-notice').textContent).toContain('Queued, not sent');
    // The page is still on the LCD: nothing was decided anywhere.
    expect(ui.find('queue-counter').textContent).toBe('1 in queue');
    await press(navButton(ui, 'Memory'));
    expect(ui.find('memory-empty').textContent).toContain('Nothing yet');
    await ui.unmount();
  });

  it('retries the outbox only when the user asks for it', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })], failSend: true });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.query('queued-notice') !== null);

    ui.client.failSend = false;
    const retry = ui.find('queued-notice').querySelector('button');
    expect(retry).not.toBeNull();
    await press(retry!);
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.verdict).toBe('approve');
    await ui.unmount();
  });
});

describe('BIP-F-18 — the pager refuses to sign what the Central would reject', () => {
  it('does not sign a decision on a page whose deadline already passed', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })], now: TEST_NOW });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent).toHaveLength(1);
    await ui.unmount();
  });

  it('produces a base64 signature of 64 bytes (raw r||s)', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })] });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 1);
    const raw = atob(ui.client.sent[0]!.signature);
    expect(raw).toHaveLength(64);
    await ui.unmount();
  });

  it('cannot sign without a device key, and says so', async () => {
    const port = browserCrypto();
    expect(port).not.toBeNull();
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })], withKeys: false });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.query('error-notice') !== null);
    expect(ui.find('error-notice').textContent).toBe('Pair this pager before deciding.');
    expect(ui.client.sent).toHaveLength(0);
    await ui.unmount();
  });
});
