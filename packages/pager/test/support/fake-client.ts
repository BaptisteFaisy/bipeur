/** A Central that records everything and never opens a socket. */
import type { PageRecord, StreamMessage } from '@bipeur/core';
import type {
  CentralClient,
  DecisionAck,
  PairInput,
  RegisterInput,
  StreamHandlers,
} from '../../src/api/client.js';
import type { SignedDecision } from '../../src/state/decide.js';

export interface FakeClient extends CentralClient {
  readonly sent: SignedDecision[];
  readonly reads: string[];
  readonly pairs: PairInput[];
  readonly devices: RegisterInput[];
  demos: number;
  failSend: boolean;
  ack: DecisionAck;
  emit(message: StreamMessage): void;
  online(): boolean;
}

export interface FakeClientOptions {
  pages?: PageRecord[];
  failSend?: boolean;
  ack?: DecisionAck;
}

export function createFakeClient(options: FakeClientOptions = {}): FakeClient {
  const sent: SignedDecision[] = [];
  const reads: string[] = [];
  const pairs: PairInput[] = [];
  const devices: RegisterInput[] = [];
  let stream: StreamHandlers | null = null;

  const fake: FakeClient = {
    sent,
    reads,
    pairs,
    devices,
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
    async pair(input) {
      pairs.push(input);
      return { pairingId: 'pair_1', deviceId: 'dev_fake1' };
    },
    async registerDevice(input) {
      devices.push(input);
      return {
        id: input.deviceId,
        name: input.deviceName,
        public_key_jwk: input.publicKeyJwk,
        push_subscription: null,
        paired_at: 0,
        revoked_at: null,
      };
    },
    async startDemo() {
      fake.demos += 1;
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
