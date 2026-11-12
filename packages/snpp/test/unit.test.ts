/**
 * The unit channel — the half of RFC 1861 that receives.
 *
 * A pager connects on the same port as the terminals, registers itself with
 * `UNIT <capcode>`, receives the delivery frames (`MESS`, `MCRE`, `SEND`) and
 * answers `MCR <code>`. The terminal that fired the page learns the answer
 * through `MSTAtus`, which answers `888` with the seeded code.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_NOW } from '../src/transcript.js';
import { FakeCentral } from './fake-central.js';
import { cleanup, connectClient, startGateway, untilAsked } from './harness.js';
import type { TestClient } from './tcp-client.js';

afterEach(async () => {
  await cleanup();
});

/** The two-way transaction of the A.9 demo, up to SEND. */
const TRANSACTION = [
  '2WAY',
  'PAGE lea',
  'MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2',
  'RTYP MULTICHOICE',
  'MCRE 0001 Approve',
  'MCRE 0002 Deny',
];

/** The delivery the unit receives, in the order of the contract. */
const DELIVERY = [
  // The page of the Central, named first: the unit signs its decision
  // against that id.
  'PAGE page_1 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2',
  'MCRE 0001 Approve',
  'MCRE 0002 Deny',
  'SEND 4821 7730',
];

/** Connect a client and read the banner of the gateway. */
async function client(port: number): Promise<TestClient> {
  const connection = await connectClient(port);
  expect(await connection.read()).toBe('220 SNPP (V3) Gateway Ready');
  return connection;
}

/** Fire the transaction from a terminal; the `861` closes it. */
async function fire(terminal: TestClient): Promise<void> {
  for (const line of TRANSACTION) {
    terminal.send(line);
    await terminal.read();
  }
  terminal.send('SEND');
  expect(await terminal.read()).toBe('861 4821 7730 Delivered, Awaiting Reply (MCR)');
}

/** Read the delivery frames, one by one, and return them. */
async function readDelivery(unit: TestClient): Promise<string[]> {
  const frames: string[] = [];
  for (let index = 0; index < DELIVERY.length; index += 1) {
    frames.push(await unit.read());
  }
  return frames;
}

describe('the unit channel — registration', () => {
  it('registers a unit under a valid capcode', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    expect(await unit.read()).toBe('250 OK, Unit Registered');
  });

  it('accepts the capcodes of 1 to 20 characters of [A-Za-z0-9._-]', async () => {
    const { port } = await startGateway(new FakeCentral());
    for (const capcode of ['a', 'lea', 'A1.b_c-2', 'x'.repeat(20)]) {
      const unit = await client(port);
      unit.send(`UNIT ${capcode}`);
      expect(await unit.read()).toBe('250 OK, Unit Registered');
    }
  });

  it.each([
    ['an empty capcode', 'UNIT'],
    ['a capcode with a space', 'UNIT bad id'],
    ['a capcode with a slash', 'UNIT lea/x'],
    ['a capcode of 21 characters', `UNIT ${'x'.repeat(21)}`],
  ])('refuses %s with 550', async (_label, line) => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send(line);
    expect(await unit.read()).toBe('550 ERROR, Invalid Pager ID');
  });

  it('refuses a capcode another connection already holds', async () => {
    const { port } = await startGateway(new FakeCentral());
    const first = await client(port);
    const second = await client(port);
    first.send('UNIT lea');
    expect(await first.read()).toBe('250 OK, Unit Registered');
    second.send('UNIT lea');
    expect(await second.read()).toBe('550 ERROR, Unit Already Registered');
  });

  it('refuses a second capcode on the same connection', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    expect(await unit.read()).toBe('250 OK, Unit Registered');
    unit.send('UNIT bob');
    expect(await unit.read()).toBe('550 ERROR, Unit Already Registered');
  });

  it('frees the capcode when the unit hangs up', async () => {
    const { port } = await startGateway(new FakeCentral());
    const first = await client(port);
    first.send('UNIT lea');
    expect(await first.read()).toBe('250 OK, Unit Registered');
    await first.close();
    // The socket close is asynchronous: give the gateway a moment.
    await new Promise((done) => setTimeout(done, 50));
    const second = await client(port);
    second.send('UNIT lea');
    expect(await second.read()).toBe('250 OK, Unit Registered');
  });
});

describe('the unit channel — delivery', () => {
  it('pushes the delivery frames in the order of the contract', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    await unit.read();
    const terminal = await client(port);
    await fire(terminal);
    expect(await readDelivery(unit)).toEqual(DELIVERY);
  });

  it('sends no MCRE frame when the terminal seeded no reply', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    await unit.read();
    const terminal = await client(port);
    for (const line of ['2WAY', 'PAGE lea', 'MESS hello']) {
      terminal.send(line);
      await terminal.read();
    }
    terminal.send('SEND');
    await terminal.read();
    expect(await unit.read()).toBe(
      'PAGE page_1 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(await unit.read()).toBe('MESS hello');
    expect(await unit.read()).toBe('SEND 4821 7730');
  });

  it('delivers nothing when no unit carries the capcode', async () => {
    const harness = await startGateway(new FakeCentral());
    const terminal = await client(harness.port);
    await fire(terminal);
    expect(harness.central.drafts).toHaveLength(1);
  });
});

describe('the unit channel — the answer of the unit', () => {
  it('concludes the tag: the terminal reads 888 with the seeded code', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    await unit.read();
    const terminal = await client(port);
    await fire(terminal);
    await readDelivery(unit);

    unit.send('MCR 0002');
    expect(await unit.read()).toBe('250 OK, Response Accepted');

    terminal.send('MSTA 4821 7730');
    expect(await terminal.read()).toBe('888 2 261124231455+1 0002 MCR Reply Received');
  });

  it('maps 0001 to the first seeded reply', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    await unit.read();
    const terminal = await client(port);
    await fire(terminal);
    await readDelivery(unit);

    unit.send('MCR 0001');
    expect(await unit.read()).toBe('250 OK, Response Accepted');
    terminal.send('MSTA 4821 7730');
    expect(await terminal.read()).toBe('888 2 261124231455+1 0001 MCR Reply Received');
  });

  it('refuses an MCR when no message awaits a reply', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    await unit.read();
    unit.send('MCR 0001');
    expect(await unit.read()).toBe('550 ERROR, No Message Awaiting Reply');
  });

  it('refuses a second MCR on the same message', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    await unit.read();
    const terminal = await client(port);
    await fire(terminal);
    await readDelivery(unit);

    unit.send('MCR 0001');
    expect(await unit.read()).toBe('250 OK, Response Accepted');
    unit.send('MCR 0001');
    expect(await unit.read()).toBe('550 ERROR, No Message Awaiting Reply');
  });
});

describe('the unit channel — the expiry of the message', () => {
  it('tells the unit that the message expired before delivery', async () => {
    const harness = await startGateway(new FakeCentral());
    const unit = await client(harness.port);
    unit.send('UNIT lea');
    await unit.read();
    const terminal = await client(harness.port);
    await fire(terminal);
    await readDelivery(unit);

    await untilAsked(harness.central);
    // Nobody answers: the fake Central keeps saying pending.
    harness.clock.now = DEMO_NOW + 30 * 60 * 1000;
    harness.central.decide({ status: 'pending' });
    expect(await unit.read()).toBe('780 MESSAGE EXPIRED Before Delivery!');
  });

  it('tells the unit when the terminal reads the 780', async () => {
    const harness = await startGateway(new FakeCentral());
    const unit = await client(harness.port);
    unit.send('UNIT lea');
    await unit.read();
    const terminal = await client(harness.port);
    await fire(terminal);
    await readDelivery(unit);

    harness.clock.now = DEMO_NOW + 30 * 60 * 1000;
    terminal.send('MSTA 4821 7730');
    expect(await terminal.read()).toMatch(/^780 \d+ \d{12}\+1 MESSAGE EXPIRED Before Delivery!$/);
    expect(await unit.read()).toBe('780 MESSAGE EXPIRED Before Delivery!');
  });
});

describe('the unit channel — the terminal path is untouched', () => {
  it('still creates the page on the Central and answers 888', async () => {
    const harness = await startGateway(new FakeCentral());
    const terminal = await client(harness.port);
    for (const line of ['2WAY', 'PAGE lea', 'MESS hello', 'RTYP MULTICHOICE', 'MCRE 0001 Approve']) {
      terminal.send(line);
      await terminal.read();
    }
    terminal.send('SEND');
    expect(await terminal.read()).toBe('861 4821 7730 Delivered, Awaiting Reply (MCR)');
    expect(harness.central.drafts).toHaveLength(1);

    await untilAsked(harness.central);
    harness.central.decide({ status: 'choice', choice: 'A' });
    await new Promise((done) => setTimeout(done, 50));
    terminal.send('MSTA 4821 7730');
    expect(await terminal.read()).toBe('888 2 261124231455+1 0001 MCR Reply Received');
  });

  it('answers 850 when a unit carries the capcode', async () => {
    const { port } = await startGateway(new FakeCentral({ online: false }));
    const unit = await client(port);
    unit.send('UNIT lea');
    await unit.read();
    const terminal = await client(port);
    terminal.send('2WAY');
    await terminal.read();
    terminal.send('PAGE lea');
    expect(await terminal.read()).toBe(
      '850 Two-Way Unit Online and Available; Transaction Accepted',
    );
  });

  it('keeps 950 when no unit carries the capcode', async () => {
    const { port } = await startGateway(new FakeCentral({ online: false }));
    const terminal = await client(port);
    terminal.send('2WAY');
    await terminal.read();
    terminal.send('PAGE lea');
    expect(await terminal.read()).toBe(
      '950 Unit NOT Online; Message Will Be Queued for Later Delivery',
    );
  });

  it('refuses the terminal vocabulary on a registered unit', async () => {
    const { port } = await startGateway(new FakeCentral());
    const unit = await client(port);
    unit.send('UNIT lea');
    await unit.read();
    unit.send('2WAY');
    expect(await unit.read()).toBe('503 Bad Sequence of Commands');
    unit.send('QUIT');
    expect(await unit.read()).toBe('221 OK, Goodbye');
  });
});
