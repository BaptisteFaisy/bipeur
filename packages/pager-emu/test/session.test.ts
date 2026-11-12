import { describe, expect, it } from 'vitest';
import { ANSWER_SENT, PagerSession } from '../src/session.js';
import { FakeTransport } from './fake-transport.js';

async function connected(capcode = 'lea'): Promise<{ transport: FakeTransport; session: PagerSession }> {
  const transport = new FakeTransport();
  const session = new PagerSession({ transport, capcode });
  await session.start();
  return { transport, session };
}

describe('BIP-F-33 — the emulator answers the gateway', () => {
  it('registers itself when the gateway greets it', async () => {
    const { transport, session } = await connected();
    transport.receive('220 SNPP (V3) Gateway Ready');
    expect(transport.sent).toEqual(['UNIT lea']);
    expect(session.view.state).toBe('registering');
  });

  it('is registered once the gateway accepts', async () => {
    const { transport, session } = await connected();
    transport.receive('220 SNPP (V3) Gateway Ready');
    transport.receive('250 OK, Unit Registered');
    expect(session.view.state).toBe('registered');
    expect(session.view.status).toContain('lea');
  });

  it('refuses an unknown pager id', async () => {
    const { transport, session } = await connected();
    transport.receive('550 ERROR, Invalid Pager ID');
    expect(session.view.state).toBe('failed');
    expect(session.view.status).toContain('refused');
  });

  it('refuses a pager id that is already registered', async () => {
    const { transport, session } = await connected();
    transport.receive('550 ERROR, Unit Already Registered');
    expect(session.view.state).toBe('failed');
  });

  it('shows the page and its code', async () => {
    const { transport, session } = await connected();
    transport.receive('MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2');
    expect(session.view.lines).toEqual(['310 fw PUSH main>origin 3 commits +120-14 #07c2']);
    expect(session.view.code).toBe(310);
    expect(session.view.state).toBe('delivered');
  });

  it('shows the seeded replies with their letter', async () => {
    const { transport, session } = await connected();
    transport.receive('MCRE 0001 Approve');
    transport.receive('MCRE 0002 Deny');
    expect(session.view.choices).toEqual([
      { code: '0001', letter: 'A', label: 'Approve' },
      { code: '0002', letter: 'B', label: 'Deny' },
    ]);
  });

  it('keeps the page id and the fingerprint of the gateway', async () => {
    const { transport, session } = await connected();
    const fingerprint = 'b'.repeat(64);
    transport.receive(`PAGE pg_7f3a1c ${fingerprint}`);
    expect(session.view.pageId).toBe('pg_7f3a1c');
    expect(session.view.fingerprint).toBe(fingerprint);
  });

  it('answers with the MCResponse code of the key', async () => {
    const { transport, session } = await connected();
    transport.receive('MESS 310 fw PUSH');
    transport.receive('MCRE 0001 Approve');
    session.pressKey('a');
    expect(transport.sent).toContain('MCR 0001');
    expect(session.view.state).toBe('answering');
    expect(session.view.answeredCode).toBe('0001');
  });

  it('is answered once the gateway accepted the MCResponse', async () => {
    const { transport, session } = await connected();
    transport.receive('MESS 310 fw PUSH');
    session.pressKey('a');
    transport.receive('250 OK, Response Accepted');
    expect(session.view.state).toBe('answered');
    expect(session.view.status).toBe(ANSWER_SENT);
  });

  it('tells the application what the human answered', async () => {
    const transport = new FakeTransport();
    const answers: string[] = [];
    const session = new PagerSession({
      transport,
      capcode: 'lea',
      onAnswer: (answer) => answers.push(`${answer.letter}:${answer.code}:${answer.label}`),
    });
    await session.start();
    transport.receive('MESS 310 fw PUSH');
    transport.receive('MCRE 0001 Approve');
    session.pressKey('a');
    expect(answers).toEqual(['A:0001:Approve']);
  });

  it('hangs up on q', async () => {
    const { transport, session } = await connected();
    session.pressKey('q');
    expect(transport.sent).toContain('QUIT');
    expect(session.view.state).toBe('closed');
  });

  it('refuses an answer when no page is on the screen', async () => {
    const { transport, session } = await connected();
    session.pressKey('a');
    expect(transport.sent).not.toContain('MCR 0001');
    expect(session.view.status).toContain('no answer');
  });

  it('refuses a letter the gateway did not seed', async () => {
    const { transport, session } = await connected();
    transport.receive('MESS 510 b PICK which date lib?');
    transport.receive('MCRE 0001 dayjs');
    transport.receive('MCRE 0002 luxon');
    session.pressKey('c');
    expect(transport.sent).not.toContain('MCR 0003');
  });

  it('approves or denies when the page seeded no reply', async () => {
    const { transport, session } = await connected();
    transport.receive('MESS 610 fw SPEND 400 credits, continue?');
    session.pressKey('b');
    expect(transport.sent).toContain('MCR 0002');
  });

  it('reports the expiry of the message', async () => {
    const { transport, session } = await connected();
    transport.receive('780 MESSAGE EXPIRED Before Delivery!');
    expect(session.view.state).toBe('expired');
  });

  it('reports a refusal of the gateway', async () => {
    const { transport, session } = await connected();
    transport.receive('MESS 310 fw PUSH');
    session.pressKey('a');
    transport.receive('550 ERROR, No Message Awaiting Reply');
    expect(session.view.status).toContain('no message awaiting a reply');
  });

  it('closes when the gateway hangs up', async () => {
    const { transport, session } = await connected();
    transport.hangUp('closed');
    expect(session.view.state).toBe('closed');
  });
});
