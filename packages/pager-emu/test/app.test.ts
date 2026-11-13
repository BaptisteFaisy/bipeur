import { describe, expect, it, vi } from 'vitest';
import type { SignedDecision } from '@bipeur/core';
import { startApp } from '../src/app.js';
import { DEFAULTS } from '../src/args.js';
import type { CentralApi } from '../src/central.js';
import { generateDeviceKey } from '../src/device-key.js';
import { FakeTransport } from './fake-transport.js';

interface Posted {
  pageId: string;
  decision: SignedDecision;
}

function fakeCentralApi(posted: Posted[]): CentralApi {
  return {
    pair: async () => ({ deviceId: 'dev_1', token: 'bip_token' }),
    postDecision: async (pageId, decision) => {
      posted.push({ pageId, decision });
      return { accepted: true, reason: null };
    },
    fingerprintOf: async () => 'f'.repeat(64),
  };
}

describe('BIP-F-33 — the emulator signs what the human decided', () => {
  it('posts a signed decision to the Central when the human answers', async () => {
    const transport = new FakeTransport();
    const posted: Posted[] = [];
    const screens: string[] = [];
    const app = await startApp({
      options: { ...DEFAULTS, code: 'ABC123', help: false },
      transport,
      centralApi: fakeCentralApi(posted),
      key: await generateDeviceKey(),
      stdout: (text) => screens.push(text),
      stderr: () => undefined,
      now: () => 1_700_000_000_000,
    });

    transport.receive('220 SNPP (V3) Gateway Ready');
    transport.receive('250 OK, Unit Registered');
    transport.receive(`PAGE pg_7f3a1c ${'a'.repeat(64)}`);
    transport.receive('MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2');
    transport.receive('MCRE 0001 Approve');
    transport.receive('MCRE 0002 Deny');
    transport.receive('SEND 4821 7730');
    app.session.pressKey('a');

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.pageId).toBe('pg_7f3a1c');
    expect(posted[0]?.decision.verdict).toBe('choice');
    expect(posted[0]?.decision.choice).toBe('A');
    expect(posted[0]?.decision.device_id).toBe('dev_1');
    expect(posted[0]?.decision.signature.length).toBeGreaterThan(0);
    expect(transport.sent).toContain('MCR 0001');
    expect(screens.join('')).toContain('310 fw PUSH main>ori');
  });

  it('signs an approval when the page seeded no reply', async () => {
    const transport = new FakeTransport();
    const posted: Posted[] = [];
    const app = await startApp({
      options: { ...DEFAULTS, code: 'ABC123', help: false },
      transport,
      centralApi: fakeCentralApi(posted),
      key: await generateDeviceKey(),
      stdout: () => undefined,
      stderr: () => undefined,
      now: () => 1_700_000_000_000,
    });

    transport.receive('220 SNPP (V3) Gateway Ready');
    transport.receive(`PAGE pg_7f3a1c ${'a'.repeat(64)}`);
    transport.receive('MESS 610 fw SPEND 400 credits, continue?');
    app.session.pressKey('b');

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.decision.verdict).toBe('deny');
    expect(posted[0]?.decision.choice).toBeNull();
  });

  it('signs nothing when the gateway pushed no page id', async () => {
    const transport = new FakeTransport();
    const posted: Posted[] = [];
    const app = await startApp({
      options: { ...DEFAULTS, code: 'ABC123', help: false },
      transport,
      centralApi: fakeCentralApi(posted),
      key: await generateDeviceKey(),
      stdout: () => undefined,
      stderr: () => undefined,
      now: () => 1_700_000_000_000,
    });

    transport.receive('220 SNPP (V3) Gateway Ready');
    transport.receive('MESS 310 fw PUSH');
    app.session.pressKey('a');

    await vi.waitFor(() => expect(app.centralStatus).toContain('no page id'));
    expect(posted).toHaveLength(0);
  });

  it('answers the gateway alone when it is not paired', async () => {
    const transport = new FakeTransport();
    const posted: Posted[] = [];
    const app = await startApp({
      options: { ...DEFAULTS, code: null, help: false },
      transport,
      centralApi: fakeCentralApi(posted),
      key: await generateDeviceKey(),
      stdout: () => undefined,
      stderr: () => undefined,
      now: () => 1_700_000_000_000,
    });

    transport.receive('220 SNPP (V3) Gateway Ready');
    transport.receive('MESS 310 fw PUSH');
    app.session.pressKey('a');

    await vi.waitFor(() => expect(app.centralStatus).toContain('not paired'));
    expect(transport.sent).toContain('MCR 0001');
    expect(posted).toHaveLength(0);
  });
});
