/**
 * The flows the scenarios replay: pair a pager, show a page, decide.
 *
 * They go through the real UI of the pager — the pairing panel, the LCD, the
 * three keys — and through the real Central. The bridge only maps the two
 * contracts that the pager branch and the Central branch wrote apart.
 */
import { expect, type Page } from '@playwright/test';
import type { Central } from './central.js';
import { installBridge, openPager, type BridgeSession } from './pager.js';

/**
 * Pairs a pager through its own pairing panel: the user reads the code on the
 * Central dashboard, types it, and the pager registers its public key. The
 * tab keeps its key pair in memory afterwards, so it can decide.
 */
export async function pairPager(page: Page, central: Central): Promise<BridgeSession> {
  const pairing = await central.createPairing();
  const session = await installBridge(page, {
    centralUrl: central.url,
    pairing: { pairing_id: pairing.pairing_id, code: pairing.code },
  });
  // The pager is served BY the Central it talks to: same origin, so the
  // WebSocket carries the device token to the right server. Opening it on
  // another origin would pair with one Central and stream from another.
  await openPager(page, `${central.url}/`);
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: 'Pair' }).click();
  await expect(page.getByTestId('pairing-qr-note')).toContainText('QR code');
  await page.getByTestId('pair-code').fill(pairing.code);
  await page.locator('form.pairing-form').getByRole('button').click();
  await expect(page.getByTestId('pairing-state')).toContainText('1 device paired');
  await expect(page.getByTestId('connection')).toHaveAttribute('data-connection', 'online');
  return session;
}

/** The text of the LCD: the line of the page on screen. */
export async function lcdText(page: Page): Promise<string> {
  const text = await page.getByTestId('lcd-text').textContent();
  return text ?? '';
}

/** The four rows of the LCD, as they are drawn. */
export async function lcdRows(page: Page): Promise<string[]> {
  const rows = await page.getByTestId('lcd-row').allTextContents();
  return rows.map((row) => row);
}
