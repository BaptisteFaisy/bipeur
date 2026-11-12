import { describe, expect, it } from 'vitest';
import { parseFrame } from '../src/frames.js';

describe('BIP-F-33 — the frames of the SNPP unit channel', () => {
  it('reads the greeting of the gateway', () => {
    expect(parseFrame('220 SNPP (V3) Gateway Ready')).toEqual({ kind: 'ready' });
  });

  it('reads a 250 and keeps its text', () => {
    expect(parseFrame('250 OK, Unit Registered')).toEqual({
      kind: 'ok',
      text: 'OK, Unit Registered',
    });
  });

  it('reads a 550 and keeps its text', () => {
    expect(parseFrame('550 ERROR, Invalid Pager ID')).toEqual({
      kind: 'error',
      text: 'ERROR, Invalid Pager ID',
    });
    expect(parseFrame('550 ERROR, No Message Awaiting Reply')).toEqual({
      kind: 'error',
      text: 'ERROR, No Message Awaiting Reply',
    });
  });

  it('reads the line of the page', () => {
    expect(parseFrame('MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2')).toEqual({
      kind: 'message',
      text: '310 fw PUSH main>origin 3 commits +120-14 #07c2',
    });
  });

  it('reads a seeded reply and its label', () => {
    expect(parseFrame('MCRE 0001 Approve')).toEqual({
      kind: 'choice',
      code: '0001',
      label: 'Approve',
    });
  });

  it('reads the delivery and its tag', () => {
    expect(parseFrame('SEND 4821 7730')).toEqual({
      kind: 'send',
      tag: '4821',
      secret: '7730',
    });
  });

  it('reads the expiry', () => {
    expect(parseFrame('780 MESSAGE EXPIRED Before Delivery!')).toEqual({
      kind: 'expired',
      text: 'MESSAGE EXPIRED Before Delivery!',
    });
  });

  it('reads the page of the Central, with or without its fingerprint', () => {
    const fingerprint = 'a'.repeat(64);
    expect(parseFrame(`PAGE pg_7f3a1c ${fingerprint}`)).toEqual({
      kind: 'page',
      pageId: 'pg_7f3a1c',
      fingerprint,
    });
    expect(parseFrame('PAGE pg_7f3a1c')).toEqual({
      kind: 'page',
      pageId: 'pg_7f3a1c',
      fingerprint: null,
    });
  });

  it('never throws on a line it does not know', () => {
    expect(parseFrame('HELP 214 - SNPP commands')).toEqual({
      kind: 'unknown',
      text: 'HELP 214 - SNPP commands',
    });
    expect(parseFrame('')).toEqual({ kind: 'unknown', text: '' });
  });
});
