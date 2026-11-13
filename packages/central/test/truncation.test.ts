/**
 * BIP-F-03 / BIP-F-16 — a page whose line did not fit keeps its text.
 *
 * The bug this file pins: the Central cut the question to fit the 80-character
 * line, and the cut text existed NOWHERE on the pager. The human was asked to
 * answer a sentence he could not read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bench } from './helpers.js';
import { call, startBench } from './helpers.js';

const QUESTION = 'TEST branchement 4 CLI: le rebase vers le depot distant est-il fini ?';
const OPTIONS = [
  { code: 'A', label: 'oui c est bon' },
  { code: 'B', label: 'non pas encore' },
];

describe('BIP-F-03 — a cut question is still readable', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('marks the cut on the line and carries the whole question on the screens', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: QUESTION,
      options: OPTIONS,
    });
    expect(created.status).toBe(201);
    // The line fits the LCD and says it was cut.
    expect(created.body.line.length).toBeLessThanOrEqual(80);
    expect(created.body.line).toContain('~');
    // The whole question is on the detail screens, in order.
    const screens: string[] = created.body.detail;
    expect(screens.length).toBeGreaterThan(0);
    expect(screens.join(' ').replace(/\s+/g, ' ')).toContain(QUESTION);
    for (const screen of screens) expect(screen.length).toBeLessThanOrEqual(80);
  });

  it('says so in the audit log', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: QUESTION,
      options: OPTIONS,
    });
    const audit = await call(bench.central, 'GET', '/v1/audit?type=page.created', bench.stationToken);
    const event = audit.body.events.find((item: { page_id: string }) => item.page_id === created.body.page_id);
    expect(event).toBeTruthy();
    expect(event.data.truncated).toBe(true);
  });

  it('keeps a short question on one line, with no cut and no extra screen', async () => {
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'deploy now?',
    });
    expect(created.status).toBe(201);
    expect(created.body.line).not.toContain('~');
    expect(created.body.detail).toHaveLength(0);
  });
});
