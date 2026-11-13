import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { relay } from '../src/relay.js';
import { approvalFrame, fakeBeeper, fakeClock, fakeGateway, fakeGatewayFetch } from './fake-crew.js';

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
    gateway.emit(approvalFrame('ap_1'));
    await app.flush();

    expect(beeper.created).toHaveLength(1);
    expect(beeper.created[0]).toMatchObject({
      kind: 'tool',
      tool_name: 'shell',
      dedupe_key: 'crew:approval:ap_1:ap_1-inst',
      agent_says: 'Deploy the docs site',
      command: 'pnpm deploy',
      station: 'crew',
      ttl_seconds: 60,
    });
  });

  it('creates one page only when the same approval is emitted twice', async () => {
    const { gateway, beeper, app } = setup({ decisions: ['approved'] });
    gateway.emit(approvalFrame('ap_1'));
    gateway.emit(approvalFrame('ap_1'));
    await app.flush();
    expect(beeper.created).toHaveLength(1);
  });

  it('pages again when the same id recurs under a new instance', async () => {
    const { gateway, beeper, app } = setup({ decisions: ['approved'] });
    gateway.emit(approvalFrame('ap_1', { instance: 'first' }));
    gateway.emit(approvalFrame('ap_1', { instance: 'second' }));
    await app.flush();
    // The relay keys in-flight work by id (the Gateway retires the replaced
    // record), so the second request updates nothing — one page per id.
    expect(beeper.created).toHaveLength(1);
  });

  it('never pages for an approval already resolved on the dashboard', async () => {
    const { gateway, beeper, app } = setup();
    gateway.emit({ type: 'approval_resolved', data: { id: 'ap_9', approved: true, slot: 'slot-1' } });
    gateway.emit(approvalFrame('ap_9'));
    await app.flush();
    expect(beeper.created).toHaveLength(0);
  });

  it('ignores an unknown frame without paging', async () => {
    const { gateway, beeper, app, logs } = setup();
    gateway.emit({ type: 'mystery', data: { whatever: true } });
    gateway.emit('not an object');
    await app.flush();
    expect(beeper.created).toHaveLength(0);
    expect(logs.some((line) => line.includes('unrecognised shape'))).toBe(true);
  });
});

describe('BIP-F-27 — decision resolves the approval on the real route', () => {
  it('calls the slot decide route once with approve', async () => {
    const { gateway, gatewayFetch, app } = setup({ decisions: ['approved'] });
    gateway.emit(approvalFrame('ap_1'));
    await app.flush();

    const decides = gatewayFetch.calls.filter((c) => c.url.endsWith('/approve'));
    expect(decides).toHaveLength(1);
    expect(decides[0]?.url).toBe('http://crew.test/api/chat/slots/slot-1/approve');
    expect(decides[0]?.body).toMatchObject({
      action: 'approved',
      request_id: 'ap_1',
      response_id: 'bipeur:ap_1-inst:a',
    });
  });

  it('resolves a denial through the native form, reason included', async () => {
    const { gateway, gatewayFetch, app } = setup({ decisions: ['denied'], reason: 'not tonight' });
    gateway.emit(approvalFrame('ap_2'));
    await app.flush();
    const decides = gatewayFetch.calls.filter((c) => c.url.endsWith('/approve'));
    expect(decides[0]?.body).toMatchObject({
      origin: 'native',
      request_mid: 'ap_2-inst',
      action: 'rejected',
      reason: 'not tonight',
    });
  });

  it('resolves an expired page as a denial, never as an approval', async () => {
    const { gateway, gatewayFetch, app } = setup({ decisions: ['expired'] });
    gateway.emit(approvalFrame('ap_3'));
    await app.flush();
    const decides = gatewayFetch.calls.filter((c) => c.url.endsWith('/approve'));
    expect(decides[0]?.body).toMatchObject({ action: 'rejected', request_id: 'ap_3' });
    expect(decides[0]?.body).not.toMatchObject({ action: 'approved' });
  });

  it('falls back to the global route when the frame carries no slot', async () => {
    const { gateway, gatewayFetch, app } = setup({ decisions: ['approved'] });
    gateway.emit(approvalFrame('ap_6', { slot: undefined }));
    await app.flush();
    const globals = gatewayFetch.calls.filter((c) => c.url.includes('/api/approvals/'));
    expect(globals).toHaveLength(1);
    expect(globals[0]?.url).toBe('http://crew.test/api/approvals/ap_6/approve');
  });

  it('retries the resolution three times, then writes a notice', async () => {
    const { gateway, beeper, gatewayFetch, app, logs } = setup({ decisions: ['approved'] }, { failTimes: 99 });
    gateway.emit(approvalFrame('ap_4'));
    await app.flush();

    const decides = gatewayFetch.calls.filter((c) => c.url.endsWith('/approve'));
    expect(decides).toHaveLength(3);
    expect(beeper.notices.filter((n) => n.includes('RESOLVE FAILED ap_4'))).toHaveLength(1);
    expect(logs.some((line) => line.includes('unresolved'))).toBe(true);
  });

  it('treats a 404 as settled elsewhere: one call, one explicit notice', async () => {
    const { gateway, beeper, gatewayFetch, app } = setup({ decisions: ['approved'] }, { failTimes: 99, status: 404 });
    gateway.emit(approvalFrame('ap_7'));
    await app.flush();
    const decides = gatewayFetch.calls.filter((c) => c.url.endsWith('/approve'));
    expect(decides).toHaveLength(1);
    expect(beeper.notices.filter((n) => n.includes('SETTLED ap_7'))).toHaveLength(1);
  });

  it('gives up once, not twice, on the same approval', async () => {
    const { gateway, beeper, app } = setup({ decisions: ['approved'] }, { failTimes: 99 });
    gateway.emit(approvalFrame('ap_5'));
    await app.flush();
    await app.flush();
    expect(beeper.notices.filter((line) => line.includes('RESOLVE FAILED'))).toHaveLength(1);
  });
});

describe('BIP-F-27 — journal events never beep', () => {
  it('logs a notification as a notice', async () => {
    const { gateway, beeper, app } = setup();
    gateway.emit({ type: 'notification', data: { source: 'system', channel: 'system.cron', title: 'night build finished' } });
    await app.flush();
    expect(beeper.created).toHaveLength(0);
    expect(beeper.notices[0]).toBe('CREW NOTIFY night build finished');
  });

  it('logs a completed task as a notice', async () => {
    const { gateway, beeper, app } = setup();
    gateway.emit({ type: 'task_complete', data: { task_id: 't_1', summary: 'docs site deployed' } });
    await app.flush();
    expect(beeper.created).toHaveLength(0);
    expect(beeper.notices[0]).toBe('CREW DONE docs site deployed');
  });

  it('keeps a notice line inside the 80-column budget', async () => {
    const { gateway, beeper, app } = setup();
    gateway.emit({ type: 'notification', data: { title: 'x'.repeat(400) } });
    await app.flush();
    expect(beeper.notices[0]?.length).toBeLessThanOrEqual(80);
  });
});
