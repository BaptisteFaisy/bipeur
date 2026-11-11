/**
 * P7 — juger sans rien installer (A.5, BIP-F-31).
 *
 * `POST /v1/demo/start` opens a space of its own: three fictional agents page
 * the human, and the space is wiped after 24 hours. The wipe is proved by the
 * API (the expiry the Central hands out) and by the code of the simulator —
 * never by waiting a day.
 */
import { expect, test } from '@playwright/test';
import { sharedCentral } from './helpers/central.js';
import { expectValidLine } from './helpers/line.js';

/** Length of the Central's demo script (`packages/central/src/simulator.ts`). */
const DEMO_SCRIPT_LENGTH = 5;
import { openPager } from './helpers/pager.js';

test('P7 — the demo opens an isolated space, wiped after 24 hours', async () => {
  const central = sharedCentral();
  const session = await central.startDemo();

  expect(session.visitor_id).toMatch(/^vis_/);
  expect(session.station_token).toMatch(/^bip_/);
  expect(session.device_token).toMatch(/^bip_/);
  expect(session.device_id).toMatch(/^dev_/);
  expect(session.expires_at - Date.now()).toBeGreaterThan(23.5 * 60 * 60 * 1000);
  expect(session.expires_at - Date.now()).toBeLessThan(24.5 * 60 * 60 * 1000);
});

test('P7 — the simulator plays three agents, and the pager shows their pages', async () => {
  const central = sharedCentral();
  const session = await central.startDemo();

  const readPages = async () =>
    (await central.devicePages(session.device_id, session.device_token)).pages;

  // The simulator plays its script one page every four seconds, so the poll
  // waits for the whole script (a push, a destructive rm, three questions)
  // rather than for the first page: asserting on the first one only would make
  // the scenario depend on where the clock happened to be.
  await expect
    .poll(async () => (await readPages()).length, {
      timeout: 40_000,
      intervals: [500, 1000, 2000],
    })
    .toBeGreaterThanOrEqual(DEMO_SCRIPT_LENGTH);

  const pages = await readPages();
  expect(pages.length).toBeGreaterThanOrEqual(DEMO_SCRIPT_LENGTH);
  for (const page of pages) {
    expectValidLine(page.line);
    expect(page.station).toBe('demo');
  }
  expect(pages.some((page) => page.kind === 'question')).toBe(true);
  expect(pages.some((page) => page.risk === 'red')).toBe(true);
});

test('P7 — the demo space stays isolated from the other posts', async () => {
  const central = sharedCentral();
  const session = await central.startDemo();
  const mine = await central.createPage({
    kind: 'tool',
    tool_name: 'shell',
    command: 'curl https://example.com/not-demo',
  });
  const visible = await central.devicePages(session.device_id, session.device_token);
  expect(visible.pages.some((page) => page.page_id === mine.page_id)).toBe(false);
});

test('P7 — the pager starts the demonstration without an account', async ({ page }) => {
  await openPager(page);
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: 'Demo' }).click();
  await page.getByRole('button', { name: 'Start demo' }).click();
  await expect(page.getByTestId('demo-notice')).toContainText('Demo running');
});
