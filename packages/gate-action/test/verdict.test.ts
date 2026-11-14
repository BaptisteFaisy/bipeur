/**
 * BIP-F-48 — the verdict table of the gate. One approval path, everything else
 * fails closed: a deploy that runs on a timeout, a refusal, a cancellation or a
 * shadow-mode simulation is exactly the blind trust the pager exists to remove.
 */
import { describe, expect, it } from 'vitest';
import { OUTCOME, decide, decideTransport, isSettled } from '../src/index.js';

describe('decide — a job runs on one answer only', () => {
  it('passes when a human approved on the pager', () => {
    const verdict = decide({ status: 'approved', simulated: false, page_id: 'pg_1' });
    expect(verdict.outcome).toBe(OUTCOME.PASS);
    expect(verdict.reason).toMatch(/approved on the pager/);
  });

  it('fails when shadow mode answered instead of a human (BIP-F-42)', () => {
    const verdict = decide({ status: 'approved', simulated: true });
    expect(verdict.outcome).toBe(OUTCOME.FAIL);
    expect(verdict.reason).toMatch(/shadow mode/i);
  });

  it('fails on a refusal and carries the reason the human gave', () => {
    const verdict = decide({ status: 'denied', reason: 'not on friday' });
    expect(verdict.outcome).toBe(OUTCOME.FAIL);
    expect(verdict.reason).toContain('not on friday');
  });

  it('fails on an expiry: a timeout is never an approval (BIP-F-29)', () => {
    expect(decide({ status: 'expired' }).outcome).toBe(OUTCOME.FAIL);
    expect(decide({ status: 'expired' }).reason).toMatch(/timeout is never an approval/);
  });

  it('fails on a cancellation and on a page still pending at the deadline', () => {
    expect(decide({ status: 'cancelled' }).outcome).toBe(OUTCOME.FAIL);
    expect(decide({ status: 'pending' }).outcome).toBe(OUTCOME.FAIL);
  });

  it('fails on a shape the contract does not carry, rather than guessing', () => {
    expect(decide(undefined).outcome).toBe(OUTCOME.FAIL);
    expect(decide({ status: 'yes-please' } as never).reason).toMatch(/does not know/);
  });

  it('runs only on the letter the workflow declared', () => {
    expect(decide({ status: 'choice', choice: 'A' }, { allowChoice: 'A' }).outcome).toBe(OUTCOME.PASS);
    expect(decide({ status: 'choice', choice: 'B' }, { allowChoice: 'A' }).outcome).toBe(OUTCOME.FAIL);
    expect(decide({ status: 'choice', choice: 'B' }, { allowChoice: 'B' }).outcome).toBe(OUTCOME.PASS);
    expect(decide({ status: 'choice', choice: null }).outcome).toBe(OUTCOME.FAIL);
  });

  it('treats an unreachable Central as a refusal, never as a maybe', () => {
    const verdict = decideTransport('connection refused');
    expect(verdict.outcome).toBe(OUTCOME.FAIL);
    expect(verdict.reason).toContain('connection refused');
  });
});

describe('isSettled — only pending keeps the job polling', () => {
  it.each(['approved', 'denied', 'choice', 'expired', 'cancelled'])('%s settles', (status) => {
    expect(isSettled({ status })).toBe(true);
  });
  it('pending does not', () => {
    expect(isSettled({ status: 'pending' })).toBe(false);
  });
});
