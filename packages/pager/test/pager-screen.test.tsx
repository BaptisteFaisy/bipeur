/**
 * BIP-F-16 — the screen itself: four rows of twenty columns, the queue counter,
 * the risk lamp and the "no pages" state.
 */
import { describe, expect, it } from 'vitest';
import { LINE_COLS, LINE_ROWS, splitScreen } from '@bipeur/core';
import { makePage } from './support/fixtures.js';
import { mountPager } from './support/setup.js';

describe('BIP-F-16 — the pager screen is 4 rows of 20 columns', () => {
  it('renders the page line on exactly four rows of twenty columns', async () => {
    const page = makePage();
    const ui = await mountPager({ pages: [page] });
    const rows = ui.findAll('lcd-row');
    expect(rows).toHaveLength(LINE_ROWS);
    for (const row of rows) expect(row.textContent).toHaveLength(LINE_COLS);
    const expected = splitScreen(page.line).map((row) => row.padEnd(LINE_COLS, ' '));
    expect(rows.map((row) => row.textContent)).toEqual(expected);
    await ui.unmount();
  });

  it('shows the page line as readable text for a screen reader', async () => {
    const page = makePage();
    const ui = await mountPager({ pages: [page] });
    expect(ui.find('lcd-text').textContent).toBe(page.line);
    await ui.unmount();
  });

  it('counts the pages waiting behind the current one', async () => {
    const ui = await mountPager({
      pages: [makePage({ id: 'pg_1' }), makePage({ id: 'pg_2' }), makePage({ id: 'pg_3' })],
    });
    expect(ui.find('queue-counter').textContent).toBe('3 in queue');
    await ui.unmount();
  });

  it('says no pages when the queue is empty', async () => {
    const ui = await mountPager({ pages: [] });
    expect(ui.find('no-pages').textContent).toBe('No pages. Your agents are fine.');
    expect(ui.find('queue-counter').textContent).toBe('Queue empty');
    await ui.unmount();
  });

  it('shows the risk as a colour, a shape and a word', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'red' })] });
    const lamp = ui.find('risk-lamp');
    expect(lamp.dataset.risk).toBe('red');
    expect(lamp.querySelector('polygon')).not.toBeNull();
    expect(lamp.querySelector('circle')).toBeNull();
    expect(lamp.getAttribute('aria-label')).toContain('Red');
    await ui.unmount();
  });

  it('shows a circle for green and a diamond for amber', async () => {
    const green = await mountPager({ pages: [makePage({ risk: 'green' })] });
    expect(green.find('risk-lamp').querySelector('circle')).not.toBeNull();
    await green.unmount();

    const amber = await mountPager({ pages: [makePage({ risk: 'amber' })] });
    expect(amber.find('risk-lamp').querySelector('polygon')).not.toBeNull();
    await amber.unmount();
  });

  it('shows the time from the injected clock', async () => {
    const ui = await mountPager({ pages: [], now: new Date(2026, 10, 11, 21, 7).getTime() });
    expect(ui.find('clock').textContent).toBe('21:07');
    await ui.unmount();
  });
});
