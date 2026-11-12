import { describe, expect, it } from 'vitest';
import type { DecisionClaims, SignedDecision } from '@bipeur/core';
import { verifyDecisionSignature } from '@bipeur/core/node';
import type { CentralApi, DecisionAck, PendingPage } from '../src/central.js';
import { generateDeviceKey } from '../src/device.js';
import { PagerSession, verdictFor } from '../src/session.js';

const NOW = 1_700_000_000_000;

const PAGE: PendingPage = {
  pageId: 'pg_1',
  fingerprint: 'f'.repeat(64),
  line: '310 fw PUSH deploy the site',
  code: 310,
  risk: 'red',
  station: 'fw',
  options: [],
};

interface Fake {
  api: CentralApi;
  posted: SignedDecision[];
  rows: string[][];
}

function fake(page: PendingPage): Fake {
  const posted: SignedDecision[] = [];
  const rows: string[][] = [];
  const api: CentralApi = {
    async pair(_code, _jwk, deviceName) {
      return { deviceId: 'dev_central_1', token: 'tok_1', name: deviceName };
    },
    async pendingPages(_deviceId, _token) {
      return [page];
    },
    async postDecision(_pageId, decision) {
      posted.push(decision);
      const ack: DecisionAck = { accepted: true, reason: null };
      return ack;
    },
  };
  return { api, posted, rows };
}

function claimsOf(decision: SignedDecision): DecisionClaims {
  return {
    page_id: decision.page_id,
    fingerprint: decision.fingerprint,
    verdict: decision.verdict,
    choice: decision.choice ?? null,
    nonce: decision.nonce,
    expires_at: decision.expires_at,
    device_id: decision.device_id,
  };
}

describe('pager-hardware session — pairing → page → signed decision', () => {
  it('pairs as a device, reads its page and approves with a signed decision', async () => {
    const key = await generateDeviceKey();
    const { api, posted } = fake(PAGE);
    const session = new PagerSession({
      api,
      display: { write: () => undefined },
      code: 'ABC123',
      key,
      now: () => NOW,
    });

    await session.start();
    expect(session.view.state).toBe('paired');
    expect(session.view.deviceId).toBe('dev_central_1');

    expect(await session.poll()).toBe(true);
    expect(session.view.state).toBe('paged');
    expect(session.view.page?.pageId).toBe('pg_1');

    await session.press('A');
    expect(session.view.state).toBe('decided');
    expect(session.view.ack?.accepted).toBe(true);

    const decision = posted[0]!;
    expect(decision.verdict).toBe('approve');
    expect(decision.choice).toBeNull();
    expect(decision.device_id).toBe('dev_central_1');

    const verified = verifyDecisionSignature({
      claims: claimsOf(decision),
      signature: decision.signature,
      publicKeyJwk: key.publicKeyJwk,
    });
    expect(verified).toBe(true);
  });

  it('signs a choice with the letter of the pressed button', async () => {
    const key = await generateDeviceKey();
    const { api, posted } = fake({
      ...PAGE,
      options: [
        { code: 'A', label: 'merge' },
        { code: 'B', label: 'rebase' },
      ],
    });
    const session = new PagerSession({
      api,
      display: { write: () => undefined },
      code: 'ABC123',
      key,
      now: () => NOW,
    });

    await session.start();
    await session.poll();
    await session.press('B');

    const decision = posted[0]!;
    expect(decision.verdict).toBe('choice');
    expect(decision.choice).toBe('B');
    expect(decision.fingerprint).toBe(PAGE.fingerprint);
  });

  it('refuses to answer a letter that is not on the page', async () => {
    const key = await generateDeviceKey();
    const { api, posted } = fake({
      ...PAGE,
      options: [
        { code: 'A', label: 'merge' },
        { code: 'B', label: 'rebase' },
      ],
    });
    const session = new PagerSession({
      api,
      display: { write: () => undefined },
      code: 'ABC123',
      key,
      now: () => NOW,
    });

    await session.start();
    await session.poll();
    await session.press('C');

    expect(session.view.state).toBe('paged');
    expect(posted).toHaveLength(0);
  });
});

describe('verdictFor', () => {
  it('maps a letter to approve/deny when the page has no options', () => {
    expect(verdictFor('A', [])).toEqual({ kind: 'approve' });
    expect(verdictFor('B', [])).toEqual({ kind: 'deny' });
    expect(verdictFor('C', [])).toBeNull();
  });

  it('maps a letter to a choice when the page carries options', () => {
    expect(verdictFor('A', ['A', 'B'])).toEqual({ kind: 'choice', choice: 'A' });
    expect(verdictFor('C', ['A', 'B'])).toBeNull();
  });
});