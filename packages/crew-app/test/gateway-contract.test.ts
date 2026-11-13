/**
 * The relay against a fake Gateway that speaks the REAL contract
 * (test/fake-gateway.ts): token exchange, cookie auth, `/api/ws` frames,
 * the slot decide route, its refusal codes and the notification push.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCrewAuth } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { relay } from '../src/relay.js';
import { fakeBeeper } from './fake-crew.js';
import { fakeCrewGateway, type FakeCrewGateway } from './fake-gateway.js';

const SECRET = 'test-app-secret';

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface Harness {
  gateway: FakeCrewGateway;
  beeper: ReturnType<typeof fakeBeeper>;
  app: ReturnType<typeof relay>;
}

async function harness(
  script: Parameters<typeof fakeBeeper>[0] = {},
  options: Parameters<typeof fakeCrewGateway>[0] = {},
): Promise<Harness> {
  const gateway = fakeCrewGateway({ appSecret: SECRET, ...options });
  await gateway.start();
  const config = loadConfig({
    CREW_GATEWAY_URL: gateway.baseUrl,
    CREW_APP_NAME: 'bipeur',
    CREW_BACKOFF_MS: '20',
    CREW_MAX_BACKOFF_MS: '100',
    CREW_PAGE_TTL: '60',
  });
  const auth = createCrewAuth(config, { CREW_APP_SECRET: SECRET });
  const beeper = fakeBeeper(script);
  const app = relay(config, beeper.client, { auth });
  await until(() => app.gateway.state === 'connected');
  return { gateway, beeper, app };
}

let live: Harness | null = null;

beforeEach(async () => {
  live = null;
});

afterEach(async () => {
  await live?.app.stop();
  await live?.gateway.stop();
  live = null;
});

describe('Crew contract — approval to page to resolution', () => {
  it('turns an approval frame into one page and resolves it exactly once', async () => {
    const { gateway, beeper, app } = await harness({ decisions: ['approved'] });
    live = { gateway, beeper, app };
    gateway.addApproval({
      id: 'ap_1',
      instance: 'inst_1',
      slot: 'slot-1',
      tool: 'shell',
      tool_input: 'pnpm deploy',
      tool_purpose: 'Deploy the docs site',
    });
    await until(() => beeper.created.length === 1);
    await app.flush();

    expect(beeper.created[0]).toMatchObject({
      kind: 'tool',
      tool_name: 'shell',
      dedupe_key: 'crew:approval:ap_1:inst_1',
      agent_says: 'Deploy the docs site',
      command: 'pnpm deploy',
    });
    const decides = gateway.approvals.filter((c) => c.path.endsWith('/approve'));
    expect(decides).toHaveLength(1);
    expect(decides[0]?.body).toMatchObject({ action: 'approved', request_id: 'ap_1' });
    expect(gateway.decisions.get('ap_1')).toBe(true);
  });

  it('pages once for the same approval broadcast twice', async () => {
    const { gateway, beeper, app } = await harness({ decisions: ['approved'] });
    live = { gateway, beeper, app };
    gateway.addApproval({ id: 'ap_2', instance: 'inst_2', slot: 'slot-1', tool: 'shell' });
    gateway.addApproval({ id: 'ap_2', instance: 'inst_2', slot: 'slot-1', tool: 'shell' });
    await until(() => beeper.created.length >= 1);
    await app.flush();
    expect(beeper.created).toHaveLength(1);
    expect(gateway.approvals.filter((c) => c.path.endsWith('/approve'))).toHaveLength(1);
  });

  it('resolves a denial as rejected, with the human reason', async () => {
    const { gateway, beeper, app } = await harness({ decisions: ['denied'], reason: 'not tonight' });
    live = { gateway, beeper, app };
    gateway.addApproval({ id: 'ap_3', instance: 'inst_3', slot: 'slot-1', tool: 'shell' });
    await until(() => beeper.created.length === 1);
    await app.flush();

    const decide = gateway.approvals[0];
    expect(decide?.body).toMatchObject({
      origin: 'native',
      request_mid: 'inst_3',
      action: 'rejected',
      reason: 'not tonight',
    });
    expect(gateway.decisions.get('ap_3')).toBe(false);
  });

  it('retries a failed resolution three times, then journals it explicitly', async () => {
    const { gateway, beeper, app } = await harness({ decisions: ['approved'] });
    live = { gateway, beeper, app };
    gateway.failApproveTimes(99);
    gateway.addApproval({ id: 'ap_4', instance: 'inst_4', slot: 'slot-1', tool: 'shell' });
    await until(() => beeper.created.length === 1);
    await app.flush();

    expect(gateway.approvals.filter((c) => c.path.endsWith('/approve'))).toHaveLength(3);
    expect(beeper.notices.filter((n) => n.includes('RESOLVE FAILED ap_4'))).toHaveLength(1);
  });

  it('re-authenticates transparently when the token expired', async () => {
    const { gateway, beeper, app } = await harness({ decisions: ['approved'] });
    live = { gateway, beeper, app };
    gateway.expireTokens();
    gateway.addApproval({ id: 'ap_5', instance: 'inst_5', slot: 'slot-1', tool: 'shell' });
    await until(() => beeper.created.length === 1);
    await app.flush();

    expect(gateway.decisions.get('ap_5')).toBe(true);
    // The first decide carried the expired token (counted as 401, never as an
    // approval call); the relay re-exchanged and the retry succeeded.
    expect(gateway.unauthorized()).toBeGreaterThanOrEqual(1);
    expect(gateway.approvals.filter((c) => c.path.endsWith('/approve'))).toHaveLength(1);
  });

  it('reconnects after a WebSocket drop and keeps the queue in order', async () => {
    const { gateway, beeper, app } = await harness({ decisions: ['approved'] });
    live = { gateway, beeper, app };
    gateway.addApproval({ id: 'ap_6a', instance: 'i6a', slot: 'slot-1', tool: 'shell' });
    await until(() => beeper.created.length === 1);
    gateway.addApproval({ id: 'ap_6b', instance: 'i6b', slot: 'slot-1', tool: 'shell' });
    await until(() => beeper.created.length === 2);
    const before = gateway.connections();
    gateway.dropSockets();
    await until(() => gateway.connections() > before && app.gateway.state === 'connected');
    gateway.addApproval({ id: 'ap_6c', instance: 'i6c', slot: 'slot-1', tool: 'shell' });
    await until(() => beeper.created.length === 3);
    await app.flush();

    expect(beeper.created.map((p) => p.dedupe_key)).toEqual([
      'crew:approval:ap_6a:i6a',
      'crew:approval:ap_6b:i6b',
      'crew:approval:ap_6c:i6c',
    ]);
    expect(new Set(beeper.created.map((p) => p.dedupe_key)).size).toBe(3);
    expect(gateway.decisions.get('ap_6a')).toBe(true);
    expect(gateway.decisions.get('ap_6c')).toBe(true);
  });

  it('journals notifications and completions without paging', async () => {
    const { gateway, beeper, app } = await harness();
    live = { gateway, beeper, app };
    gateway.broadcast('notification', { source: 'system', channel: 'system.cron', title: 'night build finished' });
    gateway.broadcast('task_complete', { task_id: 't_1', summary: 'docs site deployed' });
    await until(() => beeper.notices.length >= 2);
    await app.flush();

    expect(beeper.created).toHaveLength(0);
    expect(beeper.notices).toContain('CREW NOTIFY night build finished');
    expect(beeper.notices).toContain('CREW DONE docs site deployed');
    expect(gateway.notices.length).toBeGreaterThanOrEqual(2);
  });

  it('reports a manifest without the session approval grant', async () => {
    const { gateway, beeper, app } = await harness({ decisions: ['approved'] }, { sessionApproval: false });
    live = { gateway, beeper, app };
    gateway.addApproval({ id: 'ap_7', instance: 'inst_7', slot: 'slot-1', tool: 'shell' });
    await until(() => beeper.created.length === 1);
    await app.flush();

    expect(beeper.notices.filter((n) => n.includes('RESOLVE FAILED ap_7'))).toHaveLength(1);
    expect(gateway.decisions.has('ap_7')).toBe(false);
  });
});
