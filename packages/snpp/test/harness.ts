/**
 * The shared harness of the gateway tests: a gateway on an ephemeral loopback
 * port, an in-memory Central, a clock the test moves by hand, and the wait for
 * the Central to be asked for a decision. No HTTP, no network, no real pager
 * (`.kiro/steering/testing.md` §4).
 */
import { createGateway, type SnppGateway } from '../src/gateway.js';
import { DEMO_NOW, DEMO_OFFSET_HOURS, DEMO_SECRET, DEMO_TAG } from '../src/transcript.js';
import { FakeCentral } from './fake-central.js';
import { connectTo, type TestClient } from './tcp-client.js';

/** A clock the test moves by hand: no test ever sleeps to prove a timeout. */
export interface TestClock {
  now: number;
}

export interface StartOptions {
  /** The clock of the gateway; the demo clock by default. */
  clock?: TestClock;
  /** Credentials `LOGIn` requires, when the gateway is not on the loopback. */
  credentials?: { id: string; password: string } | null;
}

export interface Harness {
  central: FakeCentral;
  clock: TestClock;
  port: number;
}

const gateways: SnppGateway[] = [];
const clients: TestClient[] = [];

/** Close every client and every gateway the tests opened. */
export async function cleanup(): Promise<void> {
  for (const client of clients.splice(0)) await client.close();
  for (const gateway of gateways.splice(0)) await gateway.close();
}

/** Start a gateway on an ephemeral port, with the clock and the demo tags. */
export async function startGateway(
  central: FakeCentral,
  options: StartOptions = {},
): Promise<Harness> {
  const clock = options.clock ?? { now: DEMO_NOW };
  const gateway = createGateway({
    client: central,
    credentials: options.credentials ?? null,
    now: () => clock.now,
    utcOffsetHours: () => DEMO_OFFSET_HOURS,
    newTag: () => DEMO_TAG,
    newSecret: () => DEMO_SECRET,
    decisionWaitSeconds: 1,
    idleTimeoutMs: 5_000,
  });
  gateways.push(gateway);
  const { port } = await gateway.listen('127.0.0.1', 0);
  return { central, clock, port };
}

/** Connect a client; the caller reads the `220` banner when it needs it. */
export async function connectClient(port: number): Promise<TestClient> {
  const client = await connectTo(port);
  clients.push(client);
  return client;
}

/** Wait until the gateway has actually asked the Central for a decision. */
export async function untilAsked(central: FakeCentral): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (central.waits.length > 0) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('the gateway never waited for a decision');
}
