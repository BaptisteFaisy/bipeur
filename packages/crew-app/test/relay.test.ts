import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { relay } from '../src/relay.js';
import { fakeBeeper, fakeClock, fakeGateway, fakeGatewayFetch } from './fake-crew.js';

const config = loadConfig({
  CREW_GATEWAY_URL: 'http://crew.test',
  BIPEUR_URL: 'http://central.test',
  BIPEUR_TOKEN: 'tok',
  CREW_PAGE_TTL: '60',
});

function setup(script: Parameters<typeof fakeBeeper>[0] = {}, fetchScript: Parameters<typeof fakeGatewayFetch>[0] = {}) {
  const gateway = fakeGateway();
  const beeper = fakeBeeper(script);
  const gatewayFetch = fakeGatewayFetch(fetchScript);
  const clock = fakeClock();
  const logs: string[] = [];
  const app = relay(config, beeper.client, {
    gateway,
    now: clock.now,
    sleep: clock.sleep,
    fetchImpl: gatewayFetch.fetchImpl,
    log: (line) => logs.push(line),
  });
  return { gateway, beeper, gatewayFetch, app, logs };
}

describe('BIP-F-27 — Crew approval becomes a Beeper page', () => {
  it('creates a tool page with the approval dedupe key', async () => {
    const { gateway, beeper, app } = setup({ decisions: ['approved'] });
    gateway.emit({
      type: 'approval',
      approval_id: 'ap_1',
      summary: 'Deploy the docs site',
      command: 'pnpm deploy',
    });
    await app.flush();

    expect(beeper.created).toHaveLength(1);
    expect(beeper.created[0]).toMatchObject({
      kind: 'tool',
      tool_name: 'crew.approval',
      dedupe_key: 'crew:approval:ap_1',
      agent_says: 'Deploy the docs site',
      command: 'pnpm deploy',
      station: 'crew',
      ttl_seconds: 60,
    });
  });

  it('creates one page only when the same approval is emitted twice', async () => {
    const { gateway, beeper, app } = setup({ decisions: ['approved'] });
    gateway.emit({ type: 'approval', approval_id: 'ap_1', summary: 'Deploy' });
    gateway.emit({ type: 'approval', approval_id: 'ap_1', summary: 'Deploy' });
    await app.flush();
    expect(beeper.created).toHaveLength(1);
  });

  it('reads the event through a payload envelope and the id alias', async () => {
    const { gateway, beeper, app } = setup({ decisions: ['approved'] });
    gateway.emit({ payload: { type: 'approval', id: 'ap_9', summary: 'Merge' } });
    await app.flush();
    expect(beeper.created[0]).toMatchObject({ dedupe_key: 'crew:approval:ap_9' });
  });

  it('ignores an unknown event without paging', async () => {
    const { gateway, beeper, app, logs } = setup();
    gateway.emit({ type: 'mystery', whatever: true });
    gateway.emit('not an object');
    await app.flush();
    expect(beeper.created).toHaveLength(0);
    expect(logs.some((line) => line.includes('unrecognised shape'))).toBe(true);
  });
});

describe('BIP-F-27 — decision resolves the approval', () => {
  it('calls the resolution once with approve', async () => {
    const { gateway, gatewayFetch, app } = setup({ decisions: ['approved'] });
    gateway.emit({ type: 'approval', approval_id: 'ap_1', summary: 'Deploy' });
    await app.flush();

    expect(gatewayFetch.calls).toHaveLength(1);
    expect(gatewayFetch.calls[0]?.url).toBe('http://crew.test/api/crew/approvals/resolve');
    expect(gatewayFetch.calls[0]?.body).toEqual({
      approval_id: 'ap_1',
      decision: 'approve',
      reason: 'approved from the pager',
    });
  });

  it('resolves a denial as deny with the human reason', async () => {
    const { gateway, gatewayFetch, app } = setup({ decisions: ['denied'] });
    gateway.emit({ type: 'approval', approval_id: 'ap_2', summary: 'Deploy' });
    await app.flush();
    expect(gatewayFetch.calls[0]?.body).toMatchObject({ approval_id: 'ap_2', decision: 'deny' });
  });

  it('resolves an expired page as a deny, never as an approval', async () => {
    const { gateway, gatewayFetch, app } = setup({ decisions: ['expired'] });
    gateway.emit({ type: 'approval', approval_id: 'ap_3', summary: 'Deploy' });
    await app.flush();
    expect(gatewayFetch.calls[0]?.body).toMatchObject({
      decision: 'deny',
      reason: 'no decision before expiry',
    });
  });

  it('retries the resolution three times, then writes a notice', async () => {
    const { gateway, beeper, gatewayFetch, app, logs } = setup({ decisions: ['approved'] }, { failTimes: 99 });
    gateway.emit({ type: 'approval', approval_id: 'ap_4', summary: 'Deploy' });
    await app.flush();

    expect(gatewayFetch.calls).toHaveLength(3);
    expect(beeper.notices).toHaveLength(1);
    expect(beeper.notices[0]).toContain('RESOLVE FAILED ap_4');
    expect(beeper.notices[0]).toContain('3');
    expect(logs.some((line) => line.includes('unresolved'))).toBe(true);
  });

  it('gives up once, not twice, on the same approval', async () => {
    const { gateway, beeper, app } = setup({ decisions: ['approved'] }, { failTimes: 99 });
    gateway.emit({ type: 'approval', approval_id: 'ap_5', summary: 'Deploy' });
    await app.flush();
    await app.flush();
    expect(beeper.notices.filter((line) => line.includes('RESOLVE FAILED'))).toHaveLength(1);
  });
});

describe('BIP-F-27 — notifications never beep', () => {
  it('logs a notification as a notice', async () => {
    const { gateway, beeper, app } = setup();
    gateway.emit({ type: 'notification', message: 'night build finished' });
    await app.flush();
    expect(beeper.created).toHaveLength(0);
    expect(beeper.notices).toEqual(['CREW NOTIFY night build finished']);
  });

  it('logs a completed task as a notice', async () => {
    const { gateway, beeper, app } = setup();
    gateway.emit({ type: 'task_complete', task_id: 't_1', summary: 'docs site deployed' });
    await app.flush();
    expect(beeper.created).toHaveLength(0);
    expect(beeper.notices).toEqual(['CREW DONE docs site deployed']);
  });

  it('keeps a notice line inside the 80-column budget', async () => {
    const { gateway, beeper, app } = setup();
    gateway.emit({ type: 'notification', message: 'x'.repeat(400) });
    await app.flush();
    expect(beeper.notices[0]?.length).toBeLessThanOrEqual(80);
  });
});
