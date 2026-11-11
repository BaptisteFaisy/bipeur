/**
 * Demo mode (BIP-F-31): three fictional agents (`fw`, `a`, `b`) emit varied
 * requests into a space isolated per visitor and wiped after 24 hours. The
 * pages go through the very same path as a real agent: rules, budget, audit.
 */
import { generateKeyPairSync } from 'node:crypto';
import type { CreatePageRequest } from '@bipeur/core';
import { hashToken, newId, newToken } from '@bipeur/core/node';
import type { CentralContext } from './context.js';
import { createPage } from './pages.js';
import type { SourceRow } from './store/types.js';

export const DEMO_SCRIPT: CreatePageRequest[] = [
  {
    kind: 'tool',
    tool_name: 'shell',
    command: 'git push origin main',
    cwd: '/home/lea/bipeur',
    branch: 'main',
    stats: '3 commits +120-14',
  },
  {
    kind: 'tool',
    tool_name: 'shell',
    command: 'rm -rf packages/core/dist',
    cwd: '/home/lea/bipeur',
    agent_says: 'cleaning the build output before the release',
  },
  {
    kind: 'question',
    question: 'date lib?',
    options: [
      { code: 'A', label: 'dayjs' },
      { code: 'B', label: 'luxon' },
      { code: 'C', label: 'temporal' },
    ],
    detail: 'three candidates, all MIT',
  },
  {
    kind: 'question',
    question: 'spend 400 credits of 1000?',
    code: 610,
    options: [
      { code: 'A', label: 'go' },
      { code: 'B', label: 'wait' },
    ],
  },
  {
    kind: 'question',
    question: 'cannot reach registry.npmjs.org (3 tries)',
    code: 911,
    risk: 'red',
    options: [
      { code: 'A', label: 'retry' },
      { code: 'B', label: 'abort' },
    ],
  },
];

export interface DemoSession {
  visitor_id: string;
  station_token: string;
  device_token: string;
  device_id: string;
  pager_url: string;
  expires_at: number;
  /** Demo only: the browser signs its decisions with this throwaway key. */
  device_private_key_jwk: JsonWebKey;
}

export class Simulator {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly ctx: CentralContext,
    private readonly intervalMs = 4000,
  ) {}

  start(visitorId: string, source: SourceRow): void {
    this.stop(visitorId);
    let index = 0;
    const timer = setInterval(() => {
      const request = DEMO_SCRIPT[index];
      index += 1;
      if (!request) {
        this.stop(visitorId);
        return;
      }
      createPage(this.ctx, source, request);
    }, this.intervalMs);
    timer.unref();
    this.timers.set(visitorId, timer);
  }

  stop(visitorId: string): void {
    const timer = this.timers.get(visitorId);
    if (!timer) return;
    clearInterval(timer);
    this.timers.delete(visitorId);
  }

  close(): void {
    for (const visitorId of [...this.timers.keys()]) this.stop(visitorId);
  }
}

export function startDemo(ctx: CentralContext, simulator: Simulator): DemoSession {
  const now = ctx.clock();
  const visitorId = newId('vis');
  ctx.store.insertVisitor({ id: visitorId, created_at: now });

  const stationToken = newToken();
  const source: SourceRow = {
    id: newId('src'),
    alias: 'demo',
    kind: 'simulator',
    token_hash: hashToken(stationToken),
    last_seen_at: now,
    visitor_id: visitorId,
  };
  ctx.store.insertSource(source);

  const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const deviceToken = newToken();
  const deviceId = newId('dev');
  ctx.store.insertDevice({
    id: deviceId,
    name: 'Demo pager',
    token_hash: hashToken(deviceToken),
    public_key_jwk: keyPair.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    push_subscription: null,
    paired_at: now,
    revoked_at: null,
    visitor_id: visitorId,
  });
  ctx.audit.append({ type: 'device.paired', device_id: deviceId, data: { demo: true } });

  simulator.start(visitorId, source);
  return {
    visitor_id: visitorId,
    station_token: stationToken,
    device_token: deviceToken,
    device_id: deviceId,
    pager_url: '/',
    expires_at: now + 24 * 60 * 60 * 1000,
    device_private_key_jwk: keyPair.privateKey.export({ format: 'jwk' }) as JsonWebKey,
  };
}
