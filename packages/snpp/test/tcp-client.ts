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

/** The lines received but not yet read, and the readers waiting for one. */
class LineQueue {
  private readonly pending: string[] = [];
  private readonly waiting: ((line: string) => void)[] = [];

  push(line: string): void {
    const waiter = this.waiting.shift();
    if (waiter) waiter(line);
    else this.pending.push(line);
  }

  shift(): string | undefined {
    return this.pending.shift();
  }

  /** Wait for the next line, or reject after `timeoutMs`. */
  next(timeoutMs: number): Promise<string> {
    const buffered = this.pending.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    return new Promise<string>((done, fail) => {
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(resolve);
        if (index >= 0) this.waiting.splice(index, 1);
        fail(new Error('no reply within timeout'));
      }, timeoutMs);
      const resolve = (line: string): void => {
        clearTimeout(timer);
        done(line);
      };
      this.waiting.push(resolve);
    });
  }
}

/** Split the incoming bytes into CRLF-terminated lines. */
class LineSplitter {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split('\r\n');
    this.buffer = parts.pop() ?? '';
    return parts;
  }
}

function buildClient(socket: Socket, queue: LineQueue): TestClient {
  const client: TestClient = {
    send(line: string): void {
      socket.write(`${line}\r\n`);
    },
    read(timeoutMs = 2_000): Promise<string> {
      return queue.next(timeoutMs);
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
      return Promise.resolve();
    },
    closed(): Promise<void> {
      return new Promise((done) => {
        if (socket.destroyed) done();
        else socket.once('close', () => done());
      });
    },
  };
  return client;
}

/** Wait for the socket to be connected, then hand the client over. */
function onConnect(socket: Socket, queue: LineQueue, splitter: LineSplitter): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const line of splitter.push(chunk)) queue.push(line);
    });
    socket.on('error', reject);
    socket.once('connect', () => resolve(buildClient(socket, queue)));
  });
}

export function connectTo(port: number, host = '127.0.0.1'): Promise<TestClient> {
  const socket: Socket = connect({ port, host });
  return onConnect(socket, new LineQueue(), new LineSplitter());
}
