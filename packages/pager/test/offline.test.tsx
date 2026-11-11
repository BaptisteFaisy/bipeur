/**
 * BIP-F-22 — offline is visible, and a decision is never presented as sent
 * when it is not. The stream is the fake client: no socket, no network.
 */
import { describe, expect, it } from 'vitest';
import { makePage } from './support/fixtures.js';
import { fireWindow, navButton, press, waitFor } from './support/render.js';
import { mountPager } from './support/setup.js';

describe('BIP-F-22 — offline state', () => {
  it('shows no offline banner while the stream is up', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })] });
    expect(ui.find('connection').dataset.connection).toBe('online');
    expect(ui.query('offline-banner')).toBeNull();
    await ui.unmount();
  });

  it('shows the offline banner when the browser goes offline', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })] });
    await fireWindow('offline');
    expect(ui.find('connection').dataset.connection).toBe('offline');
    expect(ui.find('offline-banner').textContent).toContain('Offline');
    await fireWindow('online');
    expect(ui.query('offline-banner')).toBeNull();
    await ui.unmount();
  });

  it('keeps the page on screen and queues the decision while offline', async () => {
    const page = makePage({ risk: 'green' });
    const ui = await mountPager({ pages: [page], failSend: true });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.query('queued-notice') !== null);

    expect(ui.find('queued-notice').textContent).toContain('not sent');
    expect(ui.find('lcd-text').textContent).toBe(page.line);
    expect(ui.find('queue-counter').textContent).toBe('1 in queue');
    await ui.unmount();
  });

  it('resynchronises the queue from the Central on demand', async () => {
    const page = makePage({ id: 'pg_sync', risk: 'green' });
    const ui = await mountPager({ pages: [page] });
    expect(ui.find('lcd-text').textContent).toBe(page.line);
    await press(navButton(ui, 'Pager'));
    expect(ui.find('queue-counter').textContent).toBe('1 in queue');
    await ui.unmount();
  });

  it('never marks a refused decision as sent', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })], ack: { status: 'rejected', reason: 'nonce already seen' } });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.query('error-notice') !== null);
    expect(ui.find('error-notice').textContent).toContain('nonce already seen');
    await press(navButton(ui, 'Memory'));
    expect(ui.find('memory-empty').textContent).toContain('Nothing yet');
    await ui.unmount();
  });
});
