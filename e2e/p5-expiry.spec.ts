/**
 * P5 — ne pas répondre (A.5).
 *
 * Nobody answers: the page expires, the source receives a refusal by default
 * with the mention "no human decision", and no approval event exists for it.
 * The Central of this scenario is its own, so the page is delivered and the
 * wait is bounded by the shortest TTL the contract allows (30 seconds).
 */
import { expect, test } from '@playwright/test';
import { startDedicatedCentral } from './helpers/server.js';

test('P5 — an unanswered page expires and refuses by default', async () => {
  const dedicated = await startDedicatedCentral('p5Expiry');
  try {
    const central = dedicated.central;
    const created = await central.createPage({
      kind: 'tool',
      tool_name: 'shell',
      command: 'curl https://example.com/never-answered',
      ttl_seconds: 30,
    });
    expect(created.expires_at - created.created_at).toBe(30_000);

    // expect.poll returns void: it asserts, it does not give the value back.
    await expect
      .poll(async () => (await central.waitDecision(created.page_id, 1)).status, {
        timeout: 45_000,
        intervals: [500, 1000, 2000],
      })
      .toBe('expired');

    const answer = await central.waitDecision(created.page_id, 1);
    expect(answer.status).toBe('expired');
    expect(answer.reason).toBe('no human decision');

    const expired = await central.audit(20, 'page.expired');
    const event = expired.events.find((item) => item.page_id === created.page_id);
    expect(event).toBeDefined();
    expect(event?.data.default).toBe('deny');

    const decided = await central.audit(50, 'page.decided');
    expect(decided.events.some((item) => item.page_id === created.page_id)).toBe(false);
  } finally {
    await dedicated.stop();
  }
});
