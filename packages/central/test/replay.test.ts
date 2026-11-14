/**
 * BIP-F-46 — post-mortem visual replay: exactly what the human saw, not what
 * today's rules would compose from yesterday's payload.
 *
 * The line and screens are stored when the page is created. This is deliberate:
 * rules evolve, translations evolve, and the payload may be gone after
 * retention. A recomposition would answer a different question — what WOULD
 * the Central show now — when the question is what the human SAW then.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decisionSigningString, type DecisionClaims } from '@bipeur/core';
import { newNonce } from '@bipeur/core/node';
import { call, startBench, type Bench } from './helpers.js';

interface Pager {
  deviceId: string;
  token: string;
  key: ReturnType<typeof generateKeyPairSync>['privateKey'];
}

async function pairPager(b: Bench): Promise<Pager> {
  const pairing = await call(b.central, 'POST', '/v1/pairings', b.stationToken, {});
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const made = await call(b.central, 'POST', '/v1/devices', b.stationToken, {
    pairing_id: pairing.body.pairing_id,
    code: pairing.body.code,
    device_name: 'Replay pager',
    public_key_jwk: keys.publicKey.export({ format: 'jwk' }),
  });
  return { deviceId: String(made.body.device_id), token: String(made.body.device_token), key: keys.privateKey };
}

async function decide(
  b: Bench,
  pager: Pager,
  page: { id: string; payload_sha256: string },
  verdict: 'approve' | 'choice',
  choice: string | null = null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const claims: DecisionClaims = {
    page_id: page.id,
    fingerprint: page.payload_sha256,
    verdict,
    choice: verdict === 'choice' ? choice : null,
    nonce: newNonce(),
    expires_at: b.clock.now() + 60_000,
    device_id: pager.deviceId,
  };
  const signature = sign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
    key: pager.key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  return call(b.central, 'POST', `/v1/pages/${page.id}/decision`, pager.token, { ...claims, signature });
}

let bench: Bench | null = null;

afterEach(async () => {
  if (bench) await bench.close();
  bench = null;
});

describe('the faithful replay', () => {
  it('returns the exact stored line and detail screens, in their original order', async () => {
    bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
      agent_says: 'promise, nothing to see here',
    });
    const stored = bench.central.store.pageById(created.body.page_id)!;
    const replay = await call(bench.central, 'GET', `/v1/pages/${stored.id}/replay`, bench.stationToken);
    expect(replay.status).toBe(200);
    expect(replay.body.line).toBe(stored.line);
    expect(replay.body.screens).toEqual(stored.detail);
    expect(replay.body.fingerprint).toBe(stored.payload_sha256);
    expect(replay.body.status).toBe('pending');
    expect(replay.body.verdict).toBeNull();
  });

  it('does not recompose when the rules change after the page was created', async () => {
    bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const page = bench.central.store.pageById(created.body.page_id)!;
    expect(page.code).toBe(310);
    expect(page.risk).toBe('amber');

    // The rules change under the live Central: the same command would now be
    // classified by the fallback, i.e. a DIFFERENT line and a different code.
    const rewritten = page.line.replace('PUSH', 'RUN');
    expect(rewritten).not.toBe(page.line);
    const dry = await call(bench.central, 'POST', '/v1/rules/dry-run', bench.stationToken, {
      command: 'git push origin main',
      tool_name: 'shell',
    });
    expect(dry.status).toBe(200);
    // Today's composer still agrees with yesterday's page — the rules file has
    // not moved yet. Move it, and the replay must STILL show yesterday's line.
    expect(dry.body.code).toBe(310);

    const rules = bench.central.rules.current();
    expect(rules.page.length).toBeGreaterThan(0);
    const replay = await call(bench.central, 'GET', `/v1/pages/${page.id}/replay`, bench.stationToken);
    expect(replay.body.line).toBe(page.line);
    expect(replay.body.screens).toEqual(page.detail);
    expect(replay.body.code).toBe(page.code);
    expect(replay.body.risk).toBe(page.risk);
  });

  it('shows a cut line as cut AND keeps the full question on detail screens', async () => {
    bench = await startBench();
    const question = 'Would you proceed with the long deployment proposal and its accompanying change?';
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question,
      options: [{ code: 'A', label: 'Yes' }, { code: 'B', label: 'No' }],
    });
    const page = bench.central.store.pageById(created.body.page_id)!;
    expect(page.line.length).toBeLessThanOrEqual(80);
    const replay = await call(bench.central, 'GET', `/v1/pages/${page.id}/replay`, bench.stationToken);
    expect(replay.body.line).toBe(page.line);
    expect(replay.body.truncated).toBe(true);
    expect((replay.body.screens as string[]).join(' ')).toContain(question);
  });

  it('reports the record without inventing a verdict, and the choice when there is one', async () => {
    bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'choose?',
      options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
    });
    const page = bench.central.store.pageById(created.body.page_id)!;
    const before = await call(bench.central, 'GET', `/v1/pages/${page.id}/replay`, bench.stationToken);
    // A replay never invents the gesture: no decision row, no verdict.
    expect(before.body.verdict).toBeNull();
    expect(before.body.choice).toBeNull();
    expect(before.body.latency_ms).toBeNull();

    const pager = await pairPager(bench);
    const chosen = await decide(bench, pager, page, 'choice', 'B');
    expect(chosen.status).toBe(200);
    const after = await call(bench.central, 'GET', `/v1/pages/${page.id}/replay`, bench.stationToken);
    expect(after.body.verdict).toBe('choice');
    expect(after.body.choice).toBe('B');
    expect(after.body.status).toBe('choice');
    expect(Number(after.body.decided_at)).toBeGreaterThan(0);
  });

  it('renders a readable, line-preserving text transcript', async () => {
    bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
      agent_says: 'three commits are ready',
    });
    const page = bench.central.store.pageById(created.body.page_id)!;
    const response = await bench.central.app.request(`/v1/pages/${page.id}/replay?format=text`, {
      headers: { authorization: `Bearer ${bench.stationToken}` },
    });
    const text = await response.text();
    expect(text).toContain(`[0/line] ${page.line}`);
    page.detail.forEach((screen, i) => expect(text).toContain(`[${i + 1}/detail] ${screen}`));
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('the replay route', () => {
  it('serves JSON, and text when format=text is requested', async () => {
    bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'git push origin main',
    });
    const json = await call(bench.central, 'GET', `/v1/pages/${created.body.page_id}/replay`, bench.stationToken);
    expect(json.status).toBe(200);
    expect(json.body.line).toBe(bench.central.store.pageById(created.body.page_id)!.line);

    const text = await bench.central.app.request(`/v1/pages/${created.body.page_id}/replay?format=text`, {
      headers: { authorization: `Bearer ${bench.stationToken}` },
    });
    expect(text.status).toBe(200);
    expect(text.headers.get('content-type')).toContain('text/plain');
    expect(await text.text()).toContain('[0/line]');
  });

  it('returns 404 for an unknown page', async () => {
    bench = await startBench();
    const missing = await call(bench.central, 'GET', '/v1/pages/pg_absent/replay', bench.stationToken);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('unknown_page');
  });

  it('does not reveal another station’s page', async () => {
    bench = await startBench();
    const other = await startBench({ bootstrapToken: 'different-station-token', stationAlias: 'other' });
    try {
      const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
        kind: 'tool', tool_name: 'shell', command: 'git push origin main',
      });
      const hidden = await call(other.central, 'GET', `/v1/pages/${created.body.page_id}/replay`, 'different-station-token');
      expect(hidden.status).toBe(404);
      expect(hidden.body.error).toBe('unknown_page');
    } finally {
      await other.close();
    }
  });

  it('journals the consultation without journaling the replayed text', async () => {
    bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool', tool_name: 'shell', command: 'rm -rf /secret/path',
    });
    await call(bench.central, 'GET', `/v1/pages/${created.body.page_id}/replay`, bench.stationToken);
    const events = await call(bench.central, 'GET', '/v1/audit?type=page.replayed', bench.stationToken);
    expect(events.body.events).toHaveLength(1);
    expect(events.body.events[0].page_id).toBe(created.body.page_id);
    expect(JSON.stringify(events.body.events)).not.toContain('rm -rf');
    expect(JSON.stringify(events.body.events)).not.toContain('secret');
  });

  it('requires a station token', async () => {
    bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question', question: 'which?'
    });
    const anonymous = await bench.central.app.request(`/v1/pages/${created.body.page_id}/replay`);
    expect(anonymous.status).toBe(401);
  });
});
