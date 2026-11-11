/** P7 / BIP-F-31 — start the demo, then open the pager. */
import { describe, expect, it } from 'vitest';
import { navButton, press, waitFor } from './support/render.js';
import { mountPager } from './support/setup.js';

describe('P7 — the demonstration', () => {
  it('starts the demo and says so', async () => {
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Demo'));
    const start = Array.from(ui.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Start demo',
    );
    expect(start).toBeDefined();
    await press(start!);
    await waitFor(() => ui.client.demos === 1);
    expect(ui.find('demo-notice').textContent).toContain('Demo running');
    await ui.unmount();
  });

  it('opens the pager from the demo screen', async () => {
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Demo'));
    const open = Array.from(ui.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Open pager',
    );
    await press(open!);
    expect(ui.find('no-pages')).not.toBeNull();
    await ui.unmount();
  });
});
