/**
 * BIP-F-17 — the three keys, the pre-seeded A-D replies, the one-second hold
 * on a red page, and the keyboard equivalent of every one of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '../src/state/types.js';
import { CHOICES, THREE_SCREENS, makePage } from './support/fixtures.js';
import { advance, key, pointer, press, waitFor } from './support/render.js';
import { mountPager } from './support/setup.js';

beforeEach(() => {
  // `setImmediate` stays real: the decision signature resolves off it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BIP-F-17 — approve, refuse, next, and A to D', () => {
  it('approves a green page with one tap on ✔', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })] });
    await press(ui.find('key-approve'));
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.verdict).toBe('approve');
    await ui.unmount();
  });

  it('refuses an amber page with one tap on ✖', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'amber' })] });
    await press(ui.find('key-deny'));
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.verdict).toBe('deny');
    await ui.unmount();
  });

  it('sends the chosen letter when A to D are seeded', async () => {
    const ui = await mountPager({ pages: [makePage({ code: 510, verb: 'PICK', risk: 'green', options: CHOICES })] });
    await press(ui.find('key-choice-B'));
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.verdict).toBe('choice');
    expect(ui.client.sent[0]?.choice).toBe('B');
    await ui.unmount();
  });

  it('does not approve a red page on a quick tap', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'red' })] });
    await pointer(ui.find('key-approve'), 'pointerdown');
    await advance(HOLD_MS / 2);
    await pointer(ui.find('key-approve'), 'pointerup');
    expect(ui.client.sent).toHaveLength(0);
    await ui.unmount();
  });

  it('approves a red page only after one second of press-and-hold', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'red' })] });
    await pointer(ui.find('key-approve'), 'pointerdown');
    await advance(HOLD_MS - 100);
    expect(ui.client.sent).toHaveLength(0);
    await advance(200);
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.verdict).toBe('approve');
    await ui.unmount();
  });

  it('refuses a red page only after one second of press-and-hold', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'red' })] });
    await pointer(ui.find('key-deny'), 'pointerdown');
    await advance(HOLD_MS + 100);
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.verdict).toBe('deny');
    await ui.unmount();
  });

  it('scrolls the detail screens with ▼ and never past the third one', async () => {
    const ui = await mountPager({ pages: [makePage({ detail: THREE_SCREENS })] });
    const indicator = (): string | null => ui.find('detail-indicator').textContent;
    expect(indicator()).toBe('Page line');
    await press(ui.find('key-next'));
    expect(indicator()).toBe('Detail 2 of 4');
    await press(ui.find('key-next'));
    expect(indicator()).toBe('Detail 3 of 4');
    await press(ui.find('key-next'));
    expect(indicator()).toBe('Detail 4 of 4');
    await press(ui.find('key-next'));
    expect(indicator()).toBe('Page line');
    await ui.unmount();
  });

  it('maps Enter to approve, Escape to refuse and ArrowDown to next', async () => {
    const ui = await mountPager({
      pages: [
        makePage({ risk: 'green', detail: ['x'.repeat(40), 'y'.repeat(40)] }),
        makePage({ id: 'pg_2', risk: 'green' }),
      ],
    });
    await key('keydown', 'ArrowDown');
    await key('keyup', 'ArrowDown');
    expect(ui.find('detail-indicator').textContent).toBe('Detail 2 of 3');
    await key('keydown', 'Enter');
    await key('keyup', 'Enter');
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.verdict).toBe('approve');
    await key('keydown', 'Escape');
    await key('keyup', 'Escape');
    await waitFor(() => ui.client.sent.length === 2);
    expect(ui.client.sent[1]?.verdict).toBe('deny');
    await ui.unmount();
  });

  it('maps A to D to the seeded choice', async () => {
    const ui = await mountPager({ pages: [makePage({ code: 510, verb: 'PICK', risk: 'green', options: CHOICES })] });
    await key('keydown', 'c');
    await key('keyup', 'c');
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.choice).toBe('C');
    await ui.unmount();
  });

  it('ignores a letter the page does not seed', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'green' })] });
    await key('keydown', 'B');
    await key('keyup', 'B');
    expect(ui.client.sent).toHaveLength(0);
    await ui.unmount();
  });

  it('requires the same hold on the keyboard for a red page', async () => {
    const ui = await mountPager({ pages: [makePage({ risk: 'red' })] });
    await key('keydown', 'Enter');
    await advance(HOLD_MS / 4);
    await key('keyup', 'Enter');
    expect(ui.client.sent).toHaveLength(0);
    await key('keydown', 'Enter');
    await advance(HOLD_MS + 100);
    await waitFor(() => ui.client.sent.length === 1);
    expect(ui.client.sent[0]?.verdict).toBe('approve');
    await ui.unmount();
  });
});
