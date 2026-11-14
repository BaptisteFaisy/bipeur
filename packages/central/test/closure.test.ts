/**
 * BIP-F-41 — the closing page: the loop the approval used to leave open.
 *
 * An approval used to be the end of the story: the agent got its green light
 * and vanished. These tests pin the other half of the loop — the agent proves
 * what it did, the human who decided learns the outcome, and the proof is
 * composed from the evidence rather than from the agent's own words.
 *
 * The refusals matter as much as the acceptances: a page that was never
 * decided, a page someone else owns, a denied page and a page already closed
 * are four different answers, and each is journalled.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSURE_CODE, decisionSigningString, type DecisionClaims } from '@bipeur/core';
import { newNonce } from '@bipeur/core/node';
import { call, startBench, type Bench } from './helpers.js';

interface Pager {
  deviceId: string;
  token: string;
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
}

let bench: Bench | null = null;

async function pairPager(bench: Bench): Promise<Pager> {
  const pairing = await call(bench.central, 'POST', '/v1/pairings', bench.stationToken, {});
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const created = await call(bench.central, 'POST', '/v1/devices', bench.stationToken, {
    pairing_id: pairing.body.pairing_id,
    code: pairing.body.code,
    device_name: 'Test pager',
    public_key_jwk: keys.publicKey.export({ format: 'jwk' }),
  });
  return { deviceId: String(created.body.device_id), token: String(created.body.device_token), privateKey: keys.privateKey };
}

/** Approves a page the way a real pager does: a signed claim, not a flag. */
async function approve(bench: Bench, pager: Pager, page: Record<string, unknown>): Promise<void> {
  const claims: DecisionClaims = {
    page_id: String(page.page_id),
    fingerprint: String(page.fingerprint),
    verdict: 'approve',
    choice: null,
    nonce: newNonce(),
    expires_at: bench.clock.now() + 60_000,
    device_id: pager.deviceId,
  };
  const signature = sign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
    key: pager.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  const decided = await call(bench.central, 'POST', `/v1/pages/${claims.page_id}/decision`, pager.token, {
    ...claims,
    signature,
  });
  expect(decided.status).toBe(200);
}

async function askedPage(bench: Bench, command = 'git push origin main'): Promise<Record<string, unknown>> {
  const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
    kind: 'tool',
    tool_name: 'shell',
    command,
  });
  expect(created.status).toBe(201);
  return created.body;
}

/** POSTs an ordinary page, for the reserved-family checks. */
async function closurePage(bench: Bench, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(bench.central, 'POST', '/v1/pages', bench.stationToken, body);
}

async function closure(bench: Bench, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(bench.central, 'POST', '/v1/closures', bench.stationToken, body);
}

describe('the closing page', () => {
  beforeEach(async () => {
    bench = await startBench();
  });

  afterEach(async () => {
    if (bench) await bench.close();
    bench = null;
  });

  it('closes an approved page with a family-8 receipt', async () => {
    if (!bench) throw new Error('no bench');
    const pager = await pairPager(bench);
    const page = await askedPage(bench);
    await approve(bench, pager, page);

    const made = await closure(bench, {
      page_id: page.page_id,
      summary: 'trois commits poussés, CI verte',
      evidence: 'commit 1a2b3c4 + PR #87',
    });
    expect(made.status).toBe(201);
    expect(made.body.origin_fingerprint).toBe(page.fingerprint);
    const receipt = made.body.page as Record<string, unknown>;
    expect(receipt.code).toBe(CLOSURE_CODE);
    expect(String(receipt.line)).toMatch(/^810 main DONE /);
    expect(String(receipt.line)).toContain('PR #87');
  });

  it('puts the evidence in the line and the agent prose behind AGENT SAYS', async () => {
    if (!bench) throw new Error('no bench');
    const pager = await pairPager(bench);
    const page = await askedPage(bench);
    await approve(bench, pager, page);

    const made = await closure(bench, {
      page_id: page.page_id,
      summary: 'totally safe, nothing to see here',
      evidence: 'commit deadbee',
    });
    const receipt = made.body.page as Record<string, unknown>;
    const detail = receipt.detail as string[];
    expect(String(receipt.line)).not.toContain('nothing to see');
    expect(detail.at(-1)).toContain('AGENT SAYS:');
    expect(detail.at(-1)).toContain('nothing to see');
    expect(detail.join(' ')).toContain('commit deadbee');
  });

  it('reaches the pager that decided, and only that one', async () => {
    if (!bench) throw new Error('no bench');
    const pager = await pairPager(bench);
    const other = await pairPager(bench);
    const page = await askedPage(bench);
    await approve(bench, pager, page);
    const made = await closure(bench, { page_id: page.page_id, summary: 'fait', evidence: 'x' });
    expect(made.status).toBe(201);

    const closurePageId = String(made.body.closure_page_id);
    // BIP-F-37 targeting: the receipt is addressed to the pager that decided,
    // and to it alone — the other pager of the same station never sees it.
    expect(bench.central.store.pageTargets(closurePageId)).toEqual([pager.deviceId]);
    expect(bench.central.store.pageTargets(closurePageId)).not.toContain(other.deviceId);
    // And the page it closes is still readable on the deciding pager.
    const seen = await call(bench.central, 'GET', `/v1/pages/${page.page_id}/decision?wait=0`, bench.stationToken);
    expect(seen.status).toBe(200);
  });

  it('never costs attention: a saturated budget still lets the receipt through', async () => {
    if (!bench) throw new Error('no bench');
    const pager = await pairPager(bench);
    const page = await askedPage(bench);
    await approve(bench, pager, page);
    // Saturate the operator's budget with ordinary pages.
    for (let i = 0; i < 8; i += 1) await askedPage(bench, `git push origin b${i}`);
    const made = await closure(bench, { page_id: page.page_id, summary: 'fait', evidence: 'commit aaa' });
    expect(made.status).toBe(201);
    const receipt = made.body.page as Record<string, unknown>;
    expect(receipt.state).toBe('delivered');
  });

  it('asks nothing: no option, no callback, a short life', async () => {
    if (!bench) throw new Error('no bench');
    const pager = await pairPager(bench);
    const page = await askedPage(bench);
    await approve(bench, pager, page);
    const made = await closure(bench, { page_id: page.page_id, summary: 'fait', evidence: 'x' });
    const receipt = made.body.page as Record<string, unknown>;
    expect(receipt.options).toEqual([]);
    expect(receipt.callback_url).toBeNull();
    expect(Number(receipt.expires_at) - Number(receipt.created_at)).toBe(3_600_000);
  });

  it('is read back by the human as a receipt', async () => {
    if (!bench) throw new Error('no bench');
    const pager = await pairPager(bench);
    const page = await askedPage(bench);
    await approve(bench, pager, page);
    await closure(bench, { page_id: page.page_id, summary: 'fait', evidence: 'commit zzz' });
    const read = await call(bench.central, 'GET', `/v1/pages/${page.page_id}/closure`, bench.stationToken);
    expect(read.status).toBe(200);
    expect(read.body.evidence).toBe('commit zzz');
    expect(read.body.summary).toBe('fait');
  });
});

describe('the refusals', () => {
  beforeEach(async () => {
    bench = await startBench();
  });

  afterEach(async () => {
    if (bench) await bench.close();
    bench = null;
  });

  it('refuses a page that was never decided', async () => {
    if (!bench) throw new Error('no bench');
    const page = await askedPage(bench);
    const made = await closure(bench, { page_id: page.page_id, summary: 'fait' });
    expect(made.status).toBe(409);
    expect(made.body.error).toBe('not_decided');
  });

  it('refuses a denied page: a refusal is not an authorisation to close', async () => {
    if (!bench) throw new Error('no bench');
    const pager = await pairPager(bench);
    const page = await askedPage(bench);
    const claims: DecisionClaims = {
      page_id: String(page.page_id),
      fingerprint: String(page.fingerprint),
      verdict: 'deny',
      choice: null,
      nonce: newNonce(),
      expires_at: bench.clock.now() + 60_000,
      device_id: pager.deviceId,
    };
    const signature = sign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
      key: pager.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64');
    await call(bench.central, 'POST', `/v1/pages/${claims.page_id}/decision`, pager.token, { ...claims, signature });

    const made = await closure(bench, { page_id: page.page_id, summary: 'quand même' });
    expect(made.status).toBe(409);
    expect(made.body.error).toBe('denied_page');
  });

  it('refuses a page that belongs to another station', async () => {
    if (!bench) throw new Error('no bench');
    const stranger = await startBench({ bootstrapToken: 'autre-jeton', stationAlias: 'other' });
    const page = await askedPage(bench);
    const made = await call(stranger.central, 'POST', '/v1/closures', 'autre-jeton', {
      page_id: page.page_id,
      summary: 'je ferme chez moi',
    });
    expect(made.status).toBe(404);
    expect(made.body.error).toBe('unknown_page');
    await stranger.close();
  });

  it('refuses an unknown page and a malformed body', async () => {
    if (!bench) throw new Error('no bench');
    const unknown = await closure(bench, { page_id: 'pg_absent', summary: 'x' });
    expect(unknown.status).toBe(404);
    const empty = await closure(bench, { page_id: 'pg_absent' });
    expect(empty.status).toBe(422);
  });

  it('closes a page once: a retry lands on the receipt that exists', async () => {
    if (!bench) throw new Error('no bench');
    const pager = await pairPager(bench);
    const page = await askedPage(bench);
    await approve(bench, pager, page);
    const first = await closure(bench, { page_id: page.page_id, summary: 'fait', evidence: 'commit 111' });
    const second = await closure(bench, { page_id: page.page_id, summary: 'refait', evidence: 'commit 222' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.closure_page_id).toBe(first.body.closure_page_id);
    // The retry never overwrites the first receipt.
    expect(second.body.evidence).toBe('commit 111');
  });

  it('journals every refusal, and never a payload', async () => {
    if (!bench) throw new Error('no bench');
    const page = await askedPage(bench, 'rm -rf /chemin/secret');
    await closure(bench, { page_id: page.page_id, summary: 'le chemin secret' });
    const audit = await call(bench.central, 'GET', '/v1/audit?type=closure.rejected', bench.stationToken);
    expect(audit.body.events.length).toBe(1);
    expect(audit.body.events[0].data.reason).toBe('not_decided');
    const dumped = JSON.stringify(audit.body.events);
    expect(dumped).not.toContain('rm -rf');
    expect(dumped).not.toContain('chemin secret');
  });

  it('refuses a station that buys itself the exempt family', async () => {
    if (!bench) throw new Error('no bench');
    // Family 8 never costs attention, so a source must not be able to claim
    // it: declaring 810 on an ordinary page would be an unlimited pass.
    const question = await closurePage(bench, { kind: 'question', question: 'un choix?', code: 810 });
    expect(question.status).toBe(422);
    expect(question.body.error).toBe('reserved_code_family');
    const tool = await closurePage(bench, { kind: 'tool', tool_name: 'shell', command: 'ls', code: 899 });
    expect(tool.status).toBe(422);
    expect(tool.body.error).toBe('reserved_code_family');
    // An ordinary code still works, so the refusal is not a blanket ban.
    const fine = await closurePage(bench, { kind: 'question', question: 'un choix?', code: 510 });
    expect(fine.status).toBe(201);
  });

  it('needs a station token', async () => {
    if (!bench) throw new Error('no bench');
    const anonymous = await bench.central.app.request('/v1/closures', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"page_id":"pg_x","summary":"y"}',
    });
    expect(anonymous.status).toBe(401);
  });
});
