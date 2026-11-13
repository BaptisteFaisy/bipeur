/**
 * BIP-F-21 — the settings screen, every switch starting in its safe position.
 * BIP-N-06 — the sound switch is a setting and nothing else: no audio API, no
 * `play()`, no vibration at install.
 */
import { describe, expect, it, vi } from 'vitest';
import { navButton, press } from './support/render.js';
import { mountPager } from './support/setup.js';

describe('BIP-F-21 — settings start safe', () => {
  it('ships with the sound off, the vibration off and the detail visible', async () => {
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Settings'));
    expect((ui.find('setting-sound') as HTMLInputElement).checked).toBe(false);
    expect((ui.find('setting-vibration') as HTMLInputElement).checked).toBe(false);
    expect((ui.find('setting-hide-detail') as HTMLInputElement).checked).toBe(false);
    expect((ui.find('setting-quiet') as HTMLInputElement).checked).toBe(false);
    expect((ui.find('setting-budget') as HTMLInputElement).value).toBe('6');
    expect((ui.find('setting-language') as HTMLSelectElement).value).toBe('en');
    await ui.unmount();
  });

  it('toggles the sound without ever playing a sound', async () => {
    const audio = vi.fn();
    (globalThis as { Audio?: unknown }).Audio = audio;
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Settings'));
    await press(ui.find('setting-sound'));
    expect((ui.find('setting-sound') as HTMLInputElement).checked).toBe(true);
    expect(audio).not.toHaveBeenCalled();
    delete (globalThis as { Audio?: unknown }).Audio;
    await ui.unmount();
  });

  it('keeps the quiet hours and the budget', async () => {
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Settings'));
    expect((ui.find('quiet-from') as HTMLInputElement).value).toBe('22:00');
    expect((ui.find('quiet-to') as HTMLInputElement).value).toBe('07:00');
    expect(ui.find('setting-budget')).not.toBeNull();
    await ui.unmount();
  });

  it('revokes the device and forgets it', async () => {
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Settings'));
    expect(ui.find('device-state').textContent).toContain('Beeper');
    const revoke = Array.from(ui.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Revoke this device',
    );
    expect(revoke).toBeDefined();
    await press(revoke!);
    expect(ui.find('device-state').textContent).toBe('No device paired');
    await ui.unmount();
  });

  it('shows "no device paired" when the pager is not paired', async () => {
    const ui = await mountPager({ pages: [], paired: false });
    await press(navButton(ui, 'Settings'));
    expect(ui.find('device-state').textContent).toBe('No device paired');
    await ui.unmount();
  });
});
