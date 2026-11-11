/**
 * BIP-F-15 — pairing generates a non-extractable ECDSA P-256 key pair, sends
 * the public JWK and keeps the device id locally. When the browser cannot do
 * it, the pager says so: no silent fallback.
 */
import { describe, expect, it } from 'vitest';
import { normaliseCode } from '../src/components/PairingPanel.js';
import { navButton, press, submit, typeInto, waitFor } from './support/render.js';
import { mountPager } from './support/setup.js';

describe('BIP-F-15 — pairing', () => {
  it('reports the pairing state and asks for a six-character code', async () => {
    const ui = await mountPager({ pages: [], paired: false });
    await press(navButton(ui, 'Pair'));
    expect(ui.find('pairing-state').textContent).toBe('No device paired yet');
    expect(ui.find('pair-code')).not.toBeNull();
    await ui.unmount();
  });

  it('says "1 device paired" once paired', async () => {
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Pair'));
    expect(ui.find('pairing-state').textContent).toBe('1 device paired');
    await ui.unmount();
  });

  it('pairs with a six-character code and sends the public key only', async () => {
    const ui = await mountPager({ pages: [], paired: false });
    await press(navButton(ui, 'Pair'));
    await typeInto(ui.find('pair-code') as HTMLInputElement, 'a1b2c3');
    await submit(ui.container.querySelector('form')!);
    await waitFor(() => ui.client.pairs.length === 1);
    const sent = ui.client.pairs[0]!;
    expect(sent.code).toBe('A1B2C3');
    expect(sent.publicKeyJwk.kty).toBe('EC');
    expect(sent.publicKeyJwk.crv).toBe('P-256');
    expect(sent.publicKeyJwk.d).toBeUndefined();
    expect(ui.client.devices).toHaveLength(1);
    await ui.unmount();
  });

  it('refuses a code that is not six letters or digits', async () => {
    const ui = await mountPager({ pages: [], paired: false });
    await press(navButton(ui, 'Pair'));
    await typeInto(ui.find('pair-code') as HTMLInputElement, 'abc');
    await submit(ui.container.querySelector('form')!);
    await waitFor(() => ui.container.textContent?.includes('six letters or digits') === true);
    expect(ui.client.pairs).toHaveLength(0);
    await ui.unmount();
  });

  it('normalises what a human types: upper case, alphanumeric, six characters', () => {
    expect(normaliseCode('a1b-2c3z')).toBe('A1B2C3');
    expect(normaliseCode('  ab cd ')).toBe('ABCD');
  });

  it('warns instead of silently falling back when WebCrypto cannot make the key', async () => {
    const ui = await mountPager({ pages: [], paired: false, crypto: null });
    await press(navButton(ui, 'Pair'));
    expect(ui.find('pairing-unsupported').textContent).toContain('cannot create a non-extractable');
    await ui.unmount();
  });
});
