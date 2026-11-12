/**
 * Automatic pairing by deep-link: the Central's QR opens
 * `/?pair=<id>&code=<code>`. Pure resolution first, then one boot through the
 * real harness — the code is consumed once, the URL is cleaned afterwards, and
 * an already paired device never re-pairs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAutoPair } from '../src/state/auto-pair.js';
import { flush, waitFor } from './support/render.js';
import { mountPager } from './support/setup.js';

/** Put the deep-link in the address bar, the way the Central's QR would. */
function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

describe('resolveAutoPair — the pure reader', () => {
  it('reads the pairing id and the code the QR carries', () => {
    expect(resolveAutoPair('?pair=pr_qr1&code=A1B2C3')).toEqual({
      pairingId: 'pr_qr1',
      code: 'A1B2C3',
    });
  });

  it('normalises a lower-case code', () => {
    expect(resolveAutoPair('?pair=pr_qr1&code=a1b2c3')).toEqual({
      pairingId: 'pr_qr1',
      code: 'A1B2C3',
    });
  });

  it('coexists with ?screen= and any other parameter', () => {
    expect(
      resolveAutoPair('?screen=pairing&central=https://x.example&pair=pr_qr1&code=x1y2z3'),
    ).toEqual({ pairingId: 'pr_qr1', code: 'X1Y2Z3' });
  });

  it('returns null when the code is missing or invalid', () => {
    expect(resolveAutoPair('?pair=pr_qr1')).toBeNull();
    expect(resolveAutoPair('?pair=pr_qr1&code=')).toBeNull();
    expect(resolveAutoPair('?pair=pr_qr1&code=abc')).toBeNull();
    expect(resolveAutoPair('?pair=pr_qr1&code=A1B2C3D')).toBeNull();
    expect(resolveAutoPair('?pair=pr_qr1&code=a-b-c-d')).toBeNull();
    expect(resolveAutoPair('')).toBeNull();
  });

  it('returns null when the pairing id is absent', () => {
    expect(resolveAutoPair('?code=A1B2C3')).toBeNull();
    expect(resolveAutoPair('?screen=pairing')).toBeNull();
  });

  it('falls back to the address bar when nothing is injected', () => {
    setSearch('?pair=pr_qr9&code=m4n5o6');
    expect(resolveAutoPair()).toEqual({ pairingId: 'pr_qr9', code: 'M4N5O6' });
    setSearch('');
    expect(resolveAutoPair()).toBeNull();
  });
});

describe('?pair=&code= — the automatic pairing at boot', () => {
  afterEach(() => {
    setSearch('');
  });

  it('pairs once from the URL, keeps the requested screen and cleans up', async () => {
    setSearch('?screen=pairing&pair=pr_qr1&code=a1b2c3');
    const ui = await mountPager({ pages: [], paired: false });
    await waitFor(() => ui.client.pairs.length === 1);
    const sent = ui.client.pairs[0]!;
    expect(sent.code).toBe('A1B2C3');
    expect(sent.pairingId).toBe('pr_qr1');
    expect(sent.publicKeyJwk.kty).toBe('EC');
    // The single-use code never survives the attempt: a reload must not replay it.
    await waitFor(() => window.location.search === '?screen=pairing');
    // Success does not force a navigation: the screen the URL asked for stays.
    const active = ui.container.querySelector('.nav-item.active');
    expect(active?.textContent).toBe('Pair');
    expect(ui.find('pairing-state').textContent).toBe('1 device paired');
    await ui.unmount();
  });

  it('cleans the URL after a failed attempt too', async () => {
    setSearch('?pair=pr_qr2&code=a1b2c3');
    // crypto: null — the pager cannot make a key, the attempt fails, yet the
    // consumed link must not linger in the address bar.
    const ui = await mountPager({ pages: [], paired: false, crypto: null });
    await waitFor(() => !window.location.search.includes('code='));
    expect(window.location.search).toBe('');
    expect(ui.client.pairs).toHaveLength(0);
    await ui.unmount();
  });

  it('ignores the parameters when a device is already registered', async () => {
    setSearch('?pair=pr_qr3&code=a1b2c3');
    const ui = await mountPager({ pages: [] });
    await flush();
    expect(ui.client.pairs).toHaveLength(0);
    await ui.unmount();
  });
});
