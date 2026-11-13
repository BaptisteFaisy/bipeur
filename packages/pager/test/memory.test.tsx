/**
 * BIP-F-20 — the memory keeps the last fifty pages with their decision and
 * delay. BIP-F-23 — a page carrying a callback address offers "Call back".
 */
import { describe, expect, it } from 'vitest';
import { makePage } from './support/fixtures.js';
import { navButton, press, waitFor } from './support/render.js';
import { mountPager, TEST_NOW } from './support/setup.js';

const page = (id: string, deliveredAt = TEST_NOW - 500) =>
  makePage({ id, risk: 'green', deliveredAt });

describe('BIP-F-20 — the last fifty pages are remembered', () => {
  it('records the decision and the delay after a decision', async () => {
    const ui = await mountPager({ pages: [page('pg_1')] });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 1);
    await press(navButton(ui, 'Memory'));

    const row = ui.find('memory-row');
    expect(row.textContent).toContain('Approved');
    expect(row.textContent).toContain('500ms');
    await ui.unmount();
  });

  it('says the memory is empty before any decision', async () => {
    const ui = await mountPager({ pages: [] });
    await press(navButton(ui, 'Memory'));
    expect(ui.find('memory-empty').textContent).toContain('Nothing yet');
    await ui.unmount();
  });

  it('shows the newest decision first', async () => {
    const first = makePage({ id: 'pg_1', subject: 'first page subject', deliveredAt: TEST_NOW - 500 });
    const second = makePage({ id: 'pg_2', subject: 'second page subject', deliveredAt: TEST_NOW - 500 });
    const ui = await mountPager({ pages: [first, second] });

    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 1);
    await waitFor(() => ui.find('queue-counter').textContent === '1 in queue');
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 2);
    await waitFor(() => ui.find('queue-counter').textContent === 'Queue empty');
    await press(navButton(ui, 'Memory'));

    const rows = ui.findAll('memory-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(`#${second.payload_sha256.slice(0, 4)}`);
    expect(rows[1]?.textContent).toContain(`#${first.payload_sha256.slice(0, 4)}`);
    await ui.unmount();
  });
});

describe('BIP-F-23 — call back when the page carries an address', () => {
  it('offers a call back link when the page has a callback url', async () => {
    const ui = await mountPager({
      pages: [makePage({ risk: 'amber', callbackUrl: 'https://agents.example/session/42' })],
    });
    const link = ui.find('callback');
    expect(link.textContent).toBe('Call back');
    expect(link.getAttribute('href')).toBe('https://agents.example/session/42');
    await ui.unmount();
  });

  it('offers no call back when the page carries none', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'amber' })] });
    expect(ui.query('callback')).toBeNull();
    await ui.unmount();
  });
});
