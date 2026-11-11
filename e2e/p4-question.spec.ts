/**
 * P4 — répondre à une question (A.5).
 *
 * The question arrives with pre-seeded replies (SNPP level 3): the pager shows
 * the three keys, the human taps B, and the source receives `choice: "B"`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { sharedCentral, signDecision } from './helpers/central.js';
import { pairPager } from './helpers/flows.js';
import { expectFingerprintInLine, expectValidLine } from './helpers/line.js';
import { startDedicatedCentral } from './helpers/server.js';

const QUESTION = {
  kind: 'question',
  question: 'date lib?',
  options: [
    { code: 'A', label: 'dayjs' },
    { code: 'B', label: 'luxon' },
    { code: 'C', label: 'temporal' },
  ],
};

test('P4 — tap B on the pager and the source receives choice B', async ({ page }) => {
  const dedicated = await startDedicatedCentral('p4Choice');
  try {
    const central = dedicated.central;
    const created = await central.createPage(QUESTION);

    expect(created.kind).toBe('question');
    expect(created.code).toBe(510);
    expectValidLine(created.line);
    expectFingerprintInLine(created.line, created.fingerprint);
    expect(created.line).toContain('PICK date lib? A dayjs B luxon C temporal');

    const session = await pairPager(page, central);
    await page.getByRole('button', { name: 'Open pager' }).click();
    await expect(page.getByTestId('lcd-text')).toHaveText(created.line);
    await expect(page.getByTestId('key-choice-A')).toBeVisible();
    await expect(page.getByTestId('key-choice-B')).toBeVisible();
    await expect(page.getByTestId('key-choice-C')).toBeVisible();

    await page.getByTestId('key-choice-B').click();
    await expect.poll(() => session.decisions.length).toBe(1);
    expect(session.decisions[0].status).toBe(200);
    expect(session.decisions[0].body.choice).toBe('B');

    const settled = await central.waitDecision(created.page_id, 2);
    expect(settled.status).toBe('choice');
    expect(settled.choice).toBe('B');
    expect(settled.fingerprint).toBe(created.fingerprint);
  } finally {
    await dedicated.stop();
  }
});

test('P4 — a choice outside the seeded replies is refused', async () => {
  const central = sharedCentral();
  const pairing = await central.createPairing();
  const device = await central.pairDevice(pairing);
  const created = await central.createPage({ ...QUESTION, question: 'which logging library?' });

  const decision = signDecision(device, {
    page_id: created.page_id,
    fingerprint: created.fingerprint,
    verdict: 'choice',
    choice: 'D',
    nonce: randomUUID(),
  });
  const outcome = await central.decide(created.page_id, device, decision);
  expect(outcome.status).toBe(422);
  expect(outcome.body.reason).toBe('unknown_choice');
});
