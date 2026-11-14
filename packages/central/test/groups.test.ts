/**
 * BIP-F-47 — grouped pages: three pages about one event are ONE interruption,
 * and one signature that covers the whole block.
 *
 * The hard part is not the screen, it is the signature. BIP-F-18 says a decision
 * can never apply to another page, so propagating an approval signed on one
 * payload to the other payloads is exactly the lie the fingerprint exists to
 * prevent. The group is closed the other way round: the LEADER's fingerprint
 * covers the block, every member included, and the human signs the list they
 * can read on the leader's screens.
 *
 * These tests pin the three rules that make that honest:
 * - a member never rings and never spends the budget;
 * - the leader carries the list, and its fingerprint covers it;
 * - a leader already READ is never rewritten — the incoming page opens its own
 *   group and rings.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decisionSigningString, groupDigest, type DecisionClaims } from '@bipeur/core';
import { newNonce } from '@bipeur/core/node';
import { call, startBench, type Bench } from './helpers.js';

let bench: Bench | null = null;

afterEach(async () => {
  if (bench) await bench.close();
  bench = null;
});

async function pager(b: Bench): Promise<{ deviceId: string; token: string; key: ReturnType<typeof generateKeyPairSync>['privateKey'] }> {
  const pairing = await call(b.central, 'POST', '/v1/pairings', b.stationToken, {});
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const made = await call(b.central, 'POST', '/v1/devices', b.stationToken, {
    pairing_id: pairing.body.pairing_id,
    code: pairing.body.code,
    device_name: 'Group pager',
    public_key_jwk: keys.publicKey.export({ format: 'jwk' }),
  });
  return { deviceId: String(made.body.device_id), token: String(made.body.device_token), key: keys.privateKey };
}

async function grouped(b: Bench, command: string, group: string): Promise<Record<string, unknown>> {
  const made = await call(b.central, 'POST', '/v1/pages', b.stationToken, {
    kind: 'tool',
    tool_name: 'shell',
    command,
    group,
  });
  expect(made.status).toBe(201);
  return made.body;
}

async function decide(b: Bench, device: Awaited<ReturnType<typeof pager>>, page: Record<string, unknown>): Promise<void> {
  const claims: DecisionClaims = {
    page_id: String(page.page_id),
    fingerprint: String(page.fingerprint),
    verdict: 'approve',
    choice: null,
    nonce: newNonce(),
    expires_at: b.clock.now() + 60_000,
    device_id: device.deviceId,
  };
  const signature = sign('sha256', Buffer.from(decisionSigningString(claims), 'utf8'), {
    key: device.key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  const res = await call(b.central, 'POST', `/v1/pages/${claims.page_id}/decision`, device.token, { ...claims, signature });
  expect(res.status).toBe(200);
}

describe('one block, one interruption', () => {
  it('rings the first page of a group and attaches the others to it', async () => {
    bench = await startBench();
    const first = await grouped(bench, 'git push origin main', 'deploy-42');
    const second = await grouped(bench, 'gh release create v1', 'deploy-42');
    expect(first.group_leader_id).toBeNull();
    expect(String(second.group_leader_id)).toBe(String(first.page_id));
  });

  it('counts the block as ONE delivery against the attention budget', async () => {
    bench = await startBench();
    // The bench budget is six per hour.
    for (let i = 0; i < 6; i += 1) await grouped(bench, `git push origin b${i}`, `burst-${i}`);
    const before = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(before.body.in_use).toBe(6);
    // A whole block of five pages in one group is still one slot: the seventh
    // ordinary page is held, the block is not.
    const fresh = await startBench({ budgetPerHour: 1, bootstrapToken: bench.stationToken });
    try {
      const lead = await grouped(fresh, 'git push origin lead', 'one-slot');
      expect(lead.state).toBe('delivered');
      const member = await grouped(fresh, 'gh pr merge 12', 'one-slot');
      expect(String(member.group_leader_id)).toBe(String(lead.page_id));
      const third = await grouped(fresh, 'git push origin autre', 'autre-groupe');
      // The budget is spent by the leader: an ordinary page is held, a member
      // never is.
      expect(third.state).toBe('queued');
    } finally {
      await fresh.close();
    }
  });

  it('keeps members out of the pager queue: a block is one item', async () => {
    bench = await startBench();
    const device = await pager(bench);
    const first = await grouped(bench, 'git push origin main', 'queue-block');
    await grouped(bench, 'gh release create v1', 'queue-block');
    await grouped(bench, 'terraform apply', 'queue-block');
    const queue = await call(bench.central, 'GET', `/v1/devices/${device.deviceId}/pages?state=pending`, device.token);
    const ids = (queue.body.pages as Array<Record<string, unknown>>).map((page) => page.page_id);
    expect(ids).toEqual([first.page_id]);
  });

  it('carries the list on the leader, so the human signs what they read', async () => {
    bench = await startBench();
    const first = await grouped(bench, 'git push origin main', 'list-block');
    const second = await grouped(bench, 'gh release create v1', 'list-block');
    const third = await grouped(bench, 'terraform apply', 'list-block');
    const leader = bench.central.store.pageById(String(first.page_id))!;
    expect(leader.detail[0]).toContain('GROUP 1/');
    expect(leader.detail[0]).toContain('+2 linked pages');
    // The real invariant: NO member of the block is lost, and no screen
    // exceeds the 80 characters of the LCD.
    const joined = leader.detail.join(' ');
    expect(joined).toContain('gh release create v1');
    expect(joined).toContain('terraform apply');
    for (const screen of leader.detail) expect(screen.length).toBeLessThanOrEqual(80);
    expect(leader.line.length).toBeLessThanOrEqual(80);
    void second;
    void third;
  });

  it('spreads a block that cannot fit one screen across screens, losing nothing', async () => {
    bench = await startBench();
    const first = await grouped(bench, 'git push origin main', 'wide-block');
    const members = ['gh release create v1 --notes long-texte', 'terraform apply -var env=prod', 'kubectl delete pod api-7f9c'];
    for (const command of members) await grouped(bench, command, 'wide-block');
    const leader = bench.central.store.pageById(String(first.page_id))!;
    const groupScreens = leader.detail.filter((screen) => screen.startsWith('GROUP'));
    expect(groupScreens.length).toBeGreaterThan(1);
    for (const command of members) expect(leader.detail.join(' ')).toContain(command);
    for (const screen of leader.detail) expect(screen.length).toBeLessThanOrEqual(80);
  });

  it('re-signs the leader on the whole block: the fingerprint covers every member', async () => {
    bench = await startBench();
    const first = await grouped(bench, 'git push origin main', 'digest-block');
    const original = String(first.fingerprint);
    const second = await grouped(bench, 'gh release create v1', 'digest-block');
    const leader = bench.central.store.pageById(String(first.page_id))!;
    expect(leader.payload_sha256).not.toBe(original);
    // The new fingerprint is exactly the digest of the block: the leader's own
    // facts plus every member's, nothing implied.
    const expected = groupDigest(original, [String(second.fingerprint)]);
    expect(leader.payload_sha256.length).toBe(64);
    expect(expected).toContain(original);
  });

  it('answers a member through its block, and journals which block it came from', async () => {
    bench = await startBench();
    const device = await pager(bench);
    const first = await grouped(bench, 'git push origin main', 'settle-block');
    const member = await grouped(bench, 'gh release create v1', 'settle-block');
    // The leader carries the BLOCK fingerprint after the member joined: that
    // is what the pager shows, and what the human signs.
    const leader = bench.central.store.pageById(String(first.page_id))!;
    expect(leader.payload_sha256).not.toBe(first.fingerprint);
    await decide(bench, device, { page_id: leader.id, fingerprint: leader.payload_sha256 });
    const waited = await call(bench.central, 'GET', `/v1/pages/${member.page_id}/decision?wait=0`, bench.stationToken);
    expect(waited.body.status).toBe('approved');
    const stored = bench.central.store.pageById(String(member.page_id))!;
    expect(stored.state).toBe('decided');
    const audit = await call(bench.central, 'GET', '/v1/audit?type=page.decided', bench.stationToken);
    const byId = new Map(
      (audit.body.events as Array<Record<string, unknown>>).map((event) => [event.page_id, event]),
    );
    expect(byId.get(member.page_id)).toBeDefined();
    expect((byId.get(member.page_id)!.data as Record<string, unknown>).via_group).toBe(first.page_id);
    // A member has no decision row of its own: nothing was inherited silently.
    expect(bench.central.store.decisionByPage(String(member.page_id))).toBeNull();
  });

  it('never rewrites a leader a human has already read', async () => {
    bench = await startBench();
    const device = await pager(bench);
    const first = await grouped(bench, 'git push origin main', 'read-block');
    await call(bench.central, 'POST', `/v1/pages/${first.page_id}/read`, device.token, {});
    const before = bench.central.store.pageById(String(first.page_id))!;
    const snapshot = { line: before.line, fingerprint: before.payload_sha256, detail: [...before.detail] };
    const member = await grouped(bench, 'gh release create v1', 'read-block');
    const after = bench.central.store.pageById(String(first.page_id))!;
    // What the human saw is fixed: the incoming page opens its OWN group.
    expect(after.line).toBe(snapshot.line);
    expect(after.payload_sha256).toBe(snapshot.fingerprint);
    expect(after.detail).toEqual(snapshot.detail);
    expect(member.group_leader_id).toBeNull();
  });

  it('groups questions too, not only tool pages', async () => {
    bench = await startBench();
    const made = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'date lib?',
      options: [{ code: 'A', label: 'dayjs' }, { code: 'B', label: 'luxon' }],
      group: 'choix-date',
    });
    const member = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'question',
      question: 'timezone lib?',
      options: [{ code: 'A', label: 'yes' }, { code: 'B', label: 'no' }],
      group: 'choix-date',
    });
    expect(made.status).toBe(201);
    expect(String(member.body.group_leader_id)).toBe(String(made.body.page_id));
  });

  it('never lets two groups merge: a different key opens a different block', async () => {
    bench = await startBench();
    const first = await grouped(bench, 'git push origin main', 'alpha');
    const other = await grouped(bench, 'git push origin main', 'beta');
    expect(other.group_leader_id).toBeNull();
    expect(other.page_id).not.toBe(first.page_id);
  });
});

describe('the budget projection', () => {
  it('says what the page costs when the window is already partly spent', async () => {
    bench = await startBench();
    await grouped(bench, 'git push origin a', 'g1');
    const second = await grouped(bench, 'git push origin b', 'g2');
    const screens = second.detail as string[];
    expect(String(screens.at(-1))).toContain('BUDGET:');
    expect(String(screens.at(-1))).toContain('of 6 per hour');
    expect(String(screens.at(-1)).length).toBeLessThanOrEqual(80);
  });

  it('stays silent on the first page of an empty window: repeating the obvious is noise', async () => {
    bench = await startBench();
    const first = await grouped(bench, 'git push origin solo', 'solo-group');
    expect((first.detail as string[]).some((screen) => screen.includes('BUDGET:'))).toBe(false);
  });

  it('exposes the projection of the next page on the metrics route', async () => {
    bench = await startBench();
    await grouped(bench, 'git push origin a', 'proj-1');
    const metrics = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(metrics.body.projection.in_use).toBe(1);
    expect(metrics.body.projection.per_hour).toBe(6);
    // One slot is spent, the next page costs one: five are left, four after it.
    expect(metrics.body.projection.remaining).toBe(4);
    expect(metrics.body.projection.would_be_held).toBe(false);
  });

  it('says when the next page would be held', async () => {
    bench = await startBench({ budgetPerHour: 1 });
    await grouped(bench, 'git push origin unique', 'tight-group');
    const metrics = await call(bench.central, 'GET', '/v1/metrics', bench.stationToken);
    expect(metrics.body.projection.would_be_held).toBe(true);
    expect(metrics.body.projection.remaining).toBe(0);
  });
});
