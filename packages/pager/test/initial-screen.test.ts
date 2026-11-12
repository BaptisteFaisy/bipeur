/**
 * The `?screen=` deep-link: pure resolution, then one render through the real
 * harness. A landing page links to `app/?screen=demo`; the boot state must
 * open that screen and nothing else may leak in from storage.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isScreen, resolveInitialScreen } from '../src/state/initial-screen.js';
import type { Screen } from '../src/state/types.js';
import { mountPager } from './support/setup.js';

describe('resolveInitialScreen — the pure reader', () => {
  it('opens every known screen', () => {
    const screens: Screen[] = ['pager', 'memory', 'settings', 'pairing', 'demo'];
    for (const screen of screens) {
      expect(resolveInitialScreen(`?screen=${screen}`)).toBe(screen);
    }
  });

  it('falls back to the pager when the value is absent or unknown', () => {
    expect(resolveInitialScreen('')).toBe('pager');
    expect(resolveInitialScreen('?central=https://x.example')).toBe('pager');
    expect(resolveInitialScreen('?screen=')).toBe('pager');
    expect(resolveInitialScreen('?screen=dashboard')).toBe('pager');
    expect(resolveInitialScreen('?screen=DEMO')).toBe('pager');
    expect(resolveInitialScreen(null)).toBe('pager');
  });

  it('keeps the other query parameters, and vice versa', () => {
    expect(resolveInitialScreen('?central=https://x.example&screen=memory')).toBe('memory');
  });

  it('guards the Screen type', () => {
    expect(isScreen('demo')).toBe(true);
    expect(isScreen('nope')).toBe(false);
    expect(isScreen(undefined)).toBe(false);
  });
});

/** Put the deep-link in the address bar, the way a landing page would. */
function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

describe('?screen= — the browser branch at boot', () => {
  afterEach(() => {
    setSearch('');
  });

  it('opens the demo screen straight from the URL', async () => {
    setSearch('?screen=demo');
    const ui = await mountPager({ pages: [] });
    const active = ui.container.querySelector('.nav-item.active');
    expect(active?.textContent).toBe('Demo');
    await ui.unmount();
  });

  it('opens the pager on an unknown value', async () => {
    setSearch('?screen=bogus');
    const ui = await mountPager({ pages: [] });
    const active = ui.container.querySelector('.nav-item.active');
    expect(active?.textContent).toBe('Pager');
    await ui.unmount();
  });
});
