/**
 * The wire of the unit channel: a plain TCP socket, one line per frame,
 * CRLF terminated, exactly like RFC 1861 §4.1.3.
 *
 * The transport is an interface so the whole emulator can be tested without a
 * socket and without a terminal: the test injects a fake, the binary injects
 * `node:net`.
 */
import { connect, type Socket } from 'node:net';

/** A line-oriented channel to the gateway. */
export interface Transport {
  /** Open the connection; rejects when the gateway is unreachable. */
  connect(): Promise<void>;
  /** Send one line, CRLF terminated. */
  send(line: string): void;
  /** Called for every complete line received. */
  onLine(handler: (line: string) => void): void;
  /** Called once, when the connection is over. */
  onClose(handler: (reason: string) => void): void;
  /** Called on a socket error; the close follows. */
  onError(handler: (error: Error) => void): void;
  /** Close the connection. */
  close(): void;
}

/**
 * Split the incoming bytes into complete lines. CRLF ends a line; a lone CR
 * or LF does too, because a pager of 1995 met every kind of terminal.
 */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (char !== '\n' && char !== '\r') continue;
    if (char === '\r' && index === buffer.length - 1) break;
    lines.push(buffer.slice(start, index));
    if (char === '\r' && buffer[index + 1] === '\n') index += 1;
    start = index + 1;
  }
  return { lines, rest: buffer.slice(start) };
}

/** The real transport: a `node:net` socket. */
export function nodeTransport(host: string, port: number): Transport {
  let socket: Socket | null = null;
  let buffer = '';
  let lineHandler: (line: string) => void = () => undefined;
  let closeHandler: (reason: string) => void = () => undefined;
  let errorHandler: (error: Error) => void = () => undefined;

  const flush = (chunk: string): void => {
    buffer += chunk;
    const { lines, rest } = splitLines(buffer);
    buffer = rest;
    for (const line of lines) lineHandler(line);
  };

  return {
    connect(): Promise<void> {
      return new Promise((done, fail) => {
        const client = connect({ host, port });
        socket = client;
        client.setEncoding('utf8');
        client.on('connect', () => done());
        client.on('data', (chunk: string) => flush(chunk));
        client.on('error', (error: Error) => {
          errorHandler(error);
          fail(error);
        });
        client.on('close', () => closeHandler('closed'));
      });
    },
    send(line: string): void {
      socket?.write(`${line}\r\n`);
    },
    onLine(handler: (line: string) => void): void {
      lineHandler = handler;
    },
    onClose(handler: (reason: string) => void): void {
      closeHandler = handler;
    },
    onError(handler: (error: Error) => void): void {
      errorHandler = handler;
    },
    close(): void {
      socket?.end();
      socket?.destroy();
    },
  };
}
