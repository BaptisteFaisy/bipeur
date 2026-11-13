/**
 * P2 — approuver une commande (A.5).
 *
 * The Central composes the line from the payload alone, the pager shows it on
 * its 4 × 20 screen, the human taps ✔, and the source receives the approval of
 * the action that was displayed — signed by the pager's ECDSA key.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectedFingerprint, sharedCentral, signDecision } from './helpers/central.js';
import { pairPager } from './helpers/flows.js';
import { expectFingerprintInLine, expectValidLine } from './helpers/line.js';
import { startDedicatedCentral } from './helpers/server.js';

const PUSH = {
  kind: 'tool',
  tool_name: 'shell',
  command: 'git push origin main',
  branch: 'main',
  stats: '3 commits +120-14',
};

test('P2 — tap approve on the pager and the source receives the approval', async ({ page }) => {
  const dedicated = await startDedicatedCentral('p2Approve');
  try {
    const central = dedicated.central;
    const session = await pairPager(page, central);
    await page.getByRole('button', { name: 'Open pager' }).click();

    const created = await central.createPage(PUSH);
    expect(created.state).toBe('delivered');
    expect(created.risk).toBe('amber');
    expect(created.code).toBe(310);
    expectValidLine(created.line);
    expectFingerprintInLine(created.line, created.fingerprint);
    expect(created.fingerprint).toBe(expectedFingerprint(PUSH));
    expect(created.line).toBe(`310 ${created.station} PUSH main>origin 3 commits +120-14 #${created.fingerprint.slice(0, 4)}`);

    await expect(page.getByTestId('lcd-text')).toHaveText(created.line);
    await expect(page.getByTestId('risk-lamp')).toHaveAttribute('data-risk', 'amber');

    await page.getByTestId('key-approve').click();
    await expect.poll(() => session.decisions.length).toBe(1);
    expect(session.decisions[0].status).toBe(200);
    expect(session.decisions[0].body.accepted).toBe(true);

    const settled = await central.waitDecision(created.page_id, 2);
    expect(settled.status).toBe('approved');
    expect(settled.fingerprint).toBe(created.fingerprint);

    const events = await central.audit(50, 'page.decided');
    const decided = events.events.find((event) => event.page_id === created.page_id);
    expect(decided?.fingerprint).toBe(created.fingerprint);
    expect(decided?.data.verdict).toBe('approve');
  } finally {
    await dedicated.stop();
  }
});

test('P2 — a decision on another action is refused (A.17)', async () => {
  const central = sharedCentral();
  const pairing = await central.createPairing();
  const device = await central.pairDevice(pairing);
  const created = await central.createPage({
    kind: 'tool',
    tool_name: 'shell',
    command: 'curl https://example.com/other',
  });

  const tampered = signDecision(device, {
    page_id: created.page_id,
    fingerprint: 'f'.repeat(64),
    verdict: 'approve',
    choice: null,
    nonce: randomUUID(),
  });
  const outcome = await central.decide(created.page_id, device, tampered);
  expect(outcome.status).toBe(422);
  expect(outcome.body.reason).toBe('fingerprint_mismatch');

  const events = await central.audit(50, 'decision.rejected');
  expect(events.events.some((event) => event.page_id === created.page_id)).toBe(true);
});
