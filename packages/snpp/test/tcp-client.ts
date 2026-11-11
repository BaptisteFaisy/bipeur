/**
 * A tiny line-oriented SNPP client for the tests: a real TCP socket on an
 * ephemeral loopback port, exactly like a 1995 client (RFC 1861 §4.1.3).
 */
import { connect, type Socket } from 'node:net';

export interface TestClient {
  /** Send one command line, CRLF terminated, as the RFC wants. */
  send(line: string): void;
  /** Next server line, terminator stripped. Rejects after `timeoutMs`. */
  read(timeoutMs?: number): Promise<string>;
  /** Read until a line satisfies `predicate`; returns every line read. */
  readUntil(predicate: (line: string) => boolean, timeoutMs?: number): Promise<string[]>;
  close(): Promise<void>;
  closed(): Promise<void>;
}

export function connectTo(port: number, host = '127.0.0.1'): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ port, host });
    const pending: string[] = [];
    const waiting: ((line: string) => void)[] = [];
    const endWaiters: (() => void)[] = [];
    let buffer = '';
    let ended = false;

    const flush = (line: string): void => {
      const waiter = waiting.shift();
      if (waiter) waiter(line);
      else pending.push(line);
    };

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) flush(line);
    });
    socket.on('error', reject);
    socket.on('close', () => {
      ended = true;
      for (const waiter of endWaiters) waiter();
      endWaiters.length = 0;
    });
    socket.once('connect', () => {
      const client: TestClient = {
        send(line: string): void {
          socket.write(`${line}\r\n`);
        },
        read(timeoutMs = 2_000): Promise<string> {
          const buffered = pending.shift();
          if (buffered !== undefined) return Promise.resolve(buffered);
          if (ended) return Promise.reject(new Error('connection closed'));
          return new Promise<string>((done, fail) => {
            const timer = setTimeout(() => fail(new Error('no reply within timeout')), timeoutMs);
            waiting.push((line) => {
              clearTimeout(timer);
              done(line);
            });
          });
        },
        async readUntil(predicate: (line: string) => boolean, timeoutMs = 2_000): Promise<string[]> {
          const seen: string[] = [];
          for (;;) {
            const line = await client.read(timeoutMs);
            seen.push(line);
            if (predicate(line)) return seen;
          }
        },
        close(): Promise<void> {
          socket.end();
          return new Promise((done) => {
            if (ended) done();
            else endWaiters.push(done);
          });
        },
        closed(): Promise<void> {
          return new Promise((done) => {
            if (ended) done();
            else endWaiters.push(done);
          });
        },
      };
      resolve(client);
    });
  });
}
