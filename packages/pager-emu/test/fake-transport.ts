/** A transport that records what the emulator sends and replays what the test wants. */
import type { Transport } from '../src/transport.js';

export class FakeTransport implements Transport {
  /** Every line the emulator sent, in order. */
  readonly sent: string[] = [];
  connected = false;
  closed = false;
  private lineHandler: (line: string) => void = () => undefined;
  private closeHandler: (reason: string) => void = () => undefined;
  private errorHandler: (error: Error) => void = () => undefined;

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  send(line: string): void {
    this.sent.push(line);
  }

  onLine(handler: (line: string) => void): void {
    this.lineHandler = handler;
  }

  onClose(handler: (reason: string) => void): void {
    this.closeHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  close(): void {
    this.closed = true;
  }

  /** The gateway says something. */
  receive(line: string): void {
    this.lineHandler(line);
  }

  /** The gateway hangs up. */
  hangUp(reason = 'closed'): void {
    this.closeHandler(reason);
  }

  /** The socket breaks. */
  fail(message: string): void {
    this.errorHandler(new Error(message));
  }
}
