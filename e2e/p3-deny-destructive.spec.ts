/**
 * P3 — refuser une commande destructrice (A.5).
 *
 * A red page needs the pager open and one second of press-and-hold: a quick
 * tap does nothing at all. The source then receives the refusal, and the
 * trace of a legitimate refusal is `page.decided` — never `decision.rejected`.
 */
import { expect, test } from '@playwright/test';
import { pairPager } from './helpers/flows.js';
import { expectFingerprintInLine, expectValidLine } from './helpers/line.js';
import { startDedicatedCentral } from './helpers/server.js';

const RED = {
  kind: 'tool',
  tool_name: 'shell',
  command: 'rm -rf packages/',
  cwd: '/home/lea/bipeur',
  agent_says: 'the build output must go before the release',
};

test('P3 — a red page refuses a quick tap and accepts one second of hold', async ({ page }) => {
  const dedicated = await startDedicatedCentral('p3HoldToRefuse');
  try {
    const central = dedicated.central;
    const session = await pairPager(page, central);
    await page.getByRole('button', { name: 'Open pager' }).click();

    const created = await central.createPage(RED);
    expect(created.risk).toBe('red');
    expect(created.code).toBe(110);
    expectValidLine(created.line);
    expectFingerprintInLine(created.line, created.fingerprint);

    await expect(page.getByTestId('lcd-text')).toHaveText(created.line);
    await expect(page.getByTestId('risk-lamp')).toHaveAttribute('data-risk', 'red');
    await expect(page.getByTestId('hold-hint')).toContainText('one second');

    // Screen 4 holds the agent's own words, labelled AGENT SAYS:.
    await page.getByTestId('key-next').click();
    await page.getByTestId('key-next').click();
    await page.getByTestId('key-next').click();
    await expect(page.getByTestId('lcd-text')).toContainText('AGENT SAYS:');

    // A quick tap does nothing on a red page.
    await page.getByTestId('key-deny').click({ force: true });
    await page.waitForTimeout(300);
    expect(session.decisions).toHaveLength(0);

    // One second of press-and-hold sends the refusal.
    const deny = page.getByTestId('key-deny');
    const box = await deny.boundingBox();
    if (box === null) throw new Error('the refuse key has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1300);
    await page.mouse.up();

    await expect.poll(() => session.decisions.length).toBe(1);
    expect(session.decisions[0].status).toBe(200);
    expect(session.decisions[0].body.verdict).toBe('deny');

    const settled = await central.waitDecision(created.page_id, 2);
    expect(settled.status).toBe('denied');
    expect(settled.fingerprint).toBe(created.fingerprint);

    const decided = await central.audit(50, 'page.decided');
    expect(decided.events.some((event) => event.page_id === created.page_id)).toBe(true);
    const rejected = await central.audit(50, 'decision.rejected');
    expect(rejected.events.some((event) => event.page_id === created.page_id)).toBe(false);
  } finally {
    await dedicated.stop();
  }
});
