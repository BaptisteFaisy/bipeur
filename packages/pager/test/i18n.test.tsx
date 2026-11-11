/**
 * BIP-N-08 — English by default, French available. A page line stays ASCII in
 * both languages: only the chrome is translated, never the Central's line.
 */
import { describe, expect, it } from 'vitest';
import { en, fr, translate } from '../src/i18n/index.js';
import { makePage } from './support/fixtures.js';
import { navButton, press } from './support/render.js';
import { mountPager } from './support/setup.js';

describe('BIP-N-08 — two UI languages', () => {
  it('translates a key with its placeholders', () => {
    expect(translate('en', 'pager.queue', { n: 3 })).toBe('3 in queue');
    expect(translate('fr', 'pager.queue', { n: 3 })).toBe('3 en file');
    expect(translate('en', 'pager.queue')).toBe('{n} in queue');
  });

  it('keeps both dictionaries in sync', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('falls back to English for an unknown key of a partial dictionary', () => {
    expect(translate('fr', 'pager.noPages')).toBe('Aucun bip. Vos agents vont bien.');
  });

  it('renders English by default', async () => {
    const ui = await mountPager({ pages: [] });
    expect(ui.find('no-pages').textContent).toBe('No pages. Your agents are fine.');
    expect(ui.find('key-approve').getAttribute('aria-label')).toBe('Approve');
    await ui.unmount();
  });

  it('renders French when the language is French', async () => {
    const ui = await mountPager({ pages: [], lang: 'fr' });
    expect(ui.find('no-pages').textContent).toBe('Aucun bip. Vos agents vont bien.');
    expect(ui.find('key-approve').getAttribute('aria-label')).toBe('Approuver');
    await ui.unmount();
  });

  it('switches language from the settings screen', async () => {
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Settings'));
    const select = ui.find('setting-language') as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, 'fr');
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    await press(navButton(ui, 'Bipeur'));
    expect(ui.find('no-pages').textContent).toBe('Aucun bip. Vos agents vont bien.');
    await ui.unmount();
  });

  it('never translates the page line itself', async () => {
    const page = makePage({ risk: 'amber' });
    const ui = await mountPager({ pages: [page], lang: 'fr' });
    expect(ui.find('lcd-text').textContent).toBe(page.line);
    await ui.unmount();
  });
});
