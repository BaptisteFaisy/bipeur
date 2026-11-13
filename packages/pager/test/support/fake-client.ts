/** A Central that records everything and never opens a socket. */
import type { PageRecord, StreamMessage } from '@bipeur/core';
import type {
  CentralClient,
  DecisionAck,
  PairInput,
  StreamHandlers,
} from '../../src/api/client.js';
import type { DemoSpace } from '../../src/api/schemas.js';
import { TEST_DEMO_PRIVATE_JWK } from './keys.js';
import type { SignedDecision } from '../../src/state/decide.js';

export interface FakeClient extends CentralClient {
  readonly sent: SignedDecision[];
  readonly reads: string[];
  readonly pairs: PairInput[];
  demos: number;
  /** The token the fake hands out, so a test can assert the pager stored it. */
  readonly deviceToken: string;
  failSend: boolean;
  ack: DecisionAck;
  emit(message: StreamMessage): void;
  online(): boolean;
}

export interface FakeClientOptions {
  pages?: PageRecord[];
  failSend?: boolean;
  ack?: DecisionAck;
  deviceToken?: string;
  demoPrivateKeyJwk?: Record<string, unknown>;
}

export function createFakeClient(options: FakeClientOptions = {}): FakeClient {
  const sent: SignedDecision[] = [];
  const reads: string[] = [];
  const pairs: PairInput[] = [];
  let stream: StreamHandlers | null = null;
  const deviceToken = options.deviceToken ?? 'tok_fake_device';

  const fake: FakeClient = {
    sent,
    reads,
    pairs,
    deviceToken,
    demos: 0,
    failSend: options.failSend ?? false,
    ack: options.ack ?? { status: 'accepted', reason: null },
    connect(handlers) {
      stream = handlers;
      handlers.onStatus('online');
      return () => {
        stream = null;
      };
    },
    async fetchPending() {
      return options.pages ?? [];
    },
    async markRead(pageId) {
      reads.push(pageId);
    },
    async sendDecision(_pageId, decision) {
      if (fake.failSend) throw new Error('central unreachable');
      sent.push(decision);
      return fake.ack;
    },
    // Mirrors the REAL Central: POST /v1/devices answers with a device id and
    // a device token, and POST /v1/demo/start hands over a whole visitor space.
    // A double that invents its own shape is how the pager shipped without ever
    // sending the token.
    async pair(input) {
      pairs.push(input);
      return {
        deviceId: 'dev_fake1',
        deviceToken,
        name: input.deviceName,
        pairedAt: 1_700_000_000_000,
      };
    },
    async startDemo(): Promise<DemoSpace> {
      fake.demos += 1;
      return {
        visitor_id: 'vis_fake',
        device_id: 'dev_demo1',
        device_token: deviceToken,
        station_token: 'tok_fake_station',
        device_private_key_jwk: (options.demoPrivateKeyJwk ??
          TEST_DEMO_PRIVATE_JWK) as Record<string, unknown>,
        pager_url: '/',
        expires_at: 1_700_000_086_400_000,
      };
    },
    emit(message) {
      stream?.onMessage(message);
    },
    online() {
      return stream !== null;
    },
  };
  return fake;
}
