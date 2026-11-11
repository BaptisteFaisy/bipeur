/**
 * The A.9 transcript, replayed over a real TCP socket on an ephemeral loopback
 * port, against an in-memory Central. Every server line of
 * `DEMO_TRANSCRIPT` must come out exactly as documented in `docs/SNPP.md`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createGateway, type SnppGateway } from '../src/gateway.js';
import {
  DEMO_NOW,
  DEMO_OFFSET_HOURS,
  DEMO_SECRET,
  DEMO_TAG,
  DEMO_TRANSCRIPT,
  transcriptLines,
} from '../src/transcript.js';
import { FakeCentral } from './fake-central.js';
import { connectTo, type TestClient } from './tcp-client.js';

const gateways: SnppGateway[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const gateway of gateways.splice(0)) await gateway.close();
});

async function start(central: FakeCentral): Promise<number> {
  const gateway = createGateway({
    client: central,
    now: () => DEMO_NOW,
    utcOffsetHours: () => DEMO_OFFSET_HOURS,
    newTag: () => DEMO_TAG,
    newSecret: () => DEMO_SECRET,
    decisionWaitSeconds: 1,
    idleTimeoutMs: 5_000,
  });
  gateways.push(gateway);
  const { port } = await gateway.listen('127.0.0.1', 0);
  return port;
}

async function session(central: FakeCentral): Promise<TestClient> {
  const client = await connectTo(await start(central));
  clients.push(client);
  return client;
}

/** The client lines of the transcript, up to and including SEND. */
function beforeStatus(): { from: 'C' | 'S'; text: string }[] {
  return DEMO_TRANSCRIPT.filter((line) => line.from === 'C' && line.text !== 'MSTA 4821 7730');
}

/** Wait until the gateway has actually asked the Central for a decision. */
async function untilAsked(central: FakeCentral): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (central.waits.length > 0) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('the gateway never waited for a decision');
}

describe('A.9 — the documented transcript, replayed end to end', () => {
  it('answers every client line exactly as the transcript says', async () => {
    const central = new FakeCentral();
    const client = await session(central);
    const observed: string[] = [];

    // The banner is the first server line of the transcript.
    observed.push(`S: ${await client.read()}`);

    const clientLines = DEMO_TRANSCRIPT.filter((line) => line.from === 'C');

    for (const [index, line] of clientLines.entries()) {
      client.send(line.text);
      observed.push(`C: ${line.text}`);
      // The 888 only comes once the human has answered, at the MSTAtus step.
      if (index === clientLines.length - 1) {
        await untilAsked(central);
        central.decide({ status: 'choice', choice: 'A' });
      }
      const reply = await client.read();
      observed.push(`S: ${reply}`);
    }

    expect(observed).toEqual(transcriptLines());
    await client.close();
  });

  it('creates exactly one Beeper page, with the line fields of MESSage', async () => {
    const central = new FakeCentral();
    const client = await session(central);
    await client.read();
    for (const line of beforeStatus().slice(0, -1)) {
      client.send(line.text);
      await client.read();
    }
    client.send('SEND');
    expect(await client.read()).toBe('861 4821 7730 Delivered, Awaiting Reply (MCR)');
    await untilAsked(central);

    expect(central.drafts).toHaveLength(1);
    const draft = central.drafts[0]!;
    expect(draft.message).toBe('310 fw PUSH main>origin 3 commits +120-14 #07c2');
    expect(draft.choices.map((c) => c.code)).toEqual(['0001', '0002']);
    expect(draft.ackRead).toBe(true);
    expect(draft.pager).toBe('lea');
    await client.close();
  });

  it('reports 888 with the code of the chosen seeded reply', async () => {
    const central = new FakeCentral();
    const client = await session(central);
    await client.read();
    for (const line of beforeStatus().slice(0, -1)) {
      client.send(line.text);
      await client.read();
    }
    client.send('SEND');
    await client.read();
    await untilAsked(central);
    central.decide({ status: 'choice', choice: 'B' });
    await new Promise((done) => setTimeout(done, 50));

    client.send('MSTA 4821 7730');
    expect(await client.read()).toBe('888 3 261124231455+1 0002 MCR Reply Received');
    await client.close();
  });
});

describe('the gateway over TCP — sequences, tags and isolation', () => {
  it('answers 503 to a command out of sequence', async () => {
    const client = await session(new FakeCentral());
    await client.read();
    client.send('MESS hello');
    expect(await client.read()).toBe('503 Bad Sequence of Commands');
    client.send('2WAY');
    expect(await client.read()).toBe('250 OK, Beginning 2-Way Transaction');
    await client.close();
  });

  it('answers 501 to an unknown command, and keeps serving', async () => {
    const client = await session(new FakeCentral());
    await client.read();
    client.send('BOGUS whatever');
    expect(await client.read()).toBe('501 unknown command \'bogus\'');
    client.send('2WAY');
    expect(await client.read()).toBe('250 OK, Beginning 2-Way Transaction');
    await client.close();
  });

  it('QUIT answers 221 and closes the connection', async () => {
    const client = await session(new FakeCentral());
    await client.read();
    client.send('QUIT');
    expect(await client.read()).toBe('221 OK, Goodbye');
    await client.closed();
  });

  it('two sessions never see each other’s tags', async () => {
    const central = new FakeCentral();
    const port = await start(central);
    const first = await connectTo(port);
    const second = await connectTo(port);
    clients.push(first, second);
    await first.read();
    await second.read();

    for (const line of ['2WAY', 'PAGE lea', 'MESS hello', 'SEND']) {
      first.send(line);
      await first.read();
    }
    second.send('2WAY');
    await second.read();
    second.send('MSTA 4821 7730');
    expect(await second.read()).toBe('550 Unknown or Illegal Message_Tag or Pass_Code');

    first.send('MSTA 4821 7730');
    expect(await first.read()).toBe('861 1 261124231455+1 Delivered, Awaiting Reply (MCR)');
  });

  it('answers 780 when nobody answers before the deadline', async () => {
    const central = new FakeCentral();
    let clock = DEMO_NOW;
    const gateway = createGateway({
      client: central,
      now: () => clock,
      utcOffsetHours: () => DEMO_OFFSET_HOURS,
      newTag: () => DEMO_TAG,
      newSecret: () => DEMO_SECRET,
      defaultTtlHours: 0.25,
      decisionWaitSeconds: 1,
    });
    gateways.push(gateway);
    const { port } = await gateway.listen('127.0.0.1', 0);
    const client = await connectTo(port);
    clients.push(client);
    await client.read();
    for (const line of ['2WAY', 'PAGE lea', 'MESS hello', 'SEND']) {
      client.send(line);
      await client.read();
    }
    await untilAsked(central);
    // The human never answers: the fake Central keeps saying pending.
    clock = DEMO_NOW + 30 * 60 * 1000;
    central.decide({ status: 'pending' });
    await new Promise((done) => setTimeout(done, 100));
    client.send('MSTA 4821 7730');
    const expired = await client.read();
    expect(expired).toMatch(/^780 2 \d{12}\+1 MESSAGE EXPIRED Before Delivery!$/);
  });

  it('answers 421 and closes when LOGIn is required and not sent', async () => {
    const gateway = createGateway({
      client: new FakeCentral(),
      credentials: { id: 'admin', password: 'secret' },
      now: () => DEMO_NOW,
    });
    gateways.push(gateway);
    const { port } = await gateway.listen('127.0.0.1', 0);
    const client = await connectTo(port);
    clients.push(client);
    await client.read();
    client.send('2WAY');
    expect(await client.read()).toBe('421 Illegal Access Attempt, LOGIn Required');
    await client.closed();
  });

  it('accepts the session after a successful LOGIn', async () => {
    const gateway = createGateway({
      client: new FakeCentral(),
      credentials: { id: 'admin', password: 'secret' },
      now: () => DEMO_NOW,
    });
    gateways.push(gateway);
    const { port } = await gateway.listen('127.0.0.1', 0);
    const client = await connectTo(port);
    clients.push(client);
    await client.read();
    client.send('LOGIn admin secret');
    expect(await client.read()).toBe('250 Login Accepted');
    client.send('2WAY');
    expect(await client.read()).toBe('250 OK, Beginning 2-Way Transaction');
  });

  it('HELP lists every command as 214 lines, then 250 OK', async () => {
    const client = await session(new FakeCentral());
    await client.read();
    client.send('HELP');
    const lines = await client.readUntil((line) => line.startsWith('250 '));
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.every((line) => line.startsWith('214 ') || line.startsWith('250 '))).toBe(true);
    await client.close();
  });

  it('a binary line still gets an RFC code, never a crash', async () => {
    const client = await session(new FakeCentral());
    await client.read();
    client.send('\u0000\u0007\u0008 nonsense');
    expect(await client.read()).toMatch(/^501 /);
    client.send('2WAY');
    expect(await client.read()).toBe('250 OK, Beginning 2-Way Transaction');
    await client.close();
  });
});

describe('docs/SNPP.md — the documentation quotes the replayed transcript', () => {
  it('contains every line of DEMO_TRANSCRIPT verbatim', () => {
    const path = fileURLToPath(new URL('../docs/SNPP.md', import.meta.url));
    const doc = readFileSync(path, 'utf8');
    for (const line of transcriptLines()) {
      expect(doc).toContain(line);
    }
  });
});
