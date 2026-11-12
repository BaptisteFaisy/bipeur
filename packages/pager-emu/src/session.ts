/**
 * The emulator: a pager that listens to the unit channel and answers.
 *
 * The session owns the protocol and nothing else — no terminal, no HTTP, no
 * clock of its own. Everything it needs is injected, so the whole state
 * machine is testable without a socket and without a screen:
 *
 *   gateway  220 → the emulator registers itself (`UNIT <capcode>`)
 *   gateway  MESS / MCRE / SEND / PAGE → the page is on the screen
 *   human    a, b, c, d → `MCR 0001` … `MCR 0004`
 *   gateway  250 OK, Response Accepted → the answer is on its way
 *   human    q → `QUIT`
 */
import { parseFrame, type GatewayFrame } from './frames.js';
import { keyAction, letterOfCode, type ChoiceLetter } from './keys.js';
import { pageCodeOf } from './lcd.js';
import type { Transport } from './transport.js';

/** Where the pager stands. The screen shows it, the tests assert it. */
export type SessionState =
  | 'connecting'
  | 'registering'
  | 'registered'
  | 'delivered'
  | 'answering'
  | 'answered'
  | 'expired'
  | 'closed'
  | 'failed';

/** A seeded reply: the code of the wire and the letter on the screen. */
export interface Choice {
  /** `0001` … `0004`, the code the gateway expects. */
  code: string;
  /** `A` … `D`, the letter the human presses. */
  letter: string;
  label: string;
}

/** Everything the screen needs. Immutable: a new object on every change. */
export interface PagerView {
  state: SessionState;
  capcode: string;
  pageId: string | null;
  fingerprint: string | null;
  /** The three-digit code of the page line, when it carries one. */
  code: number | null;
  /** The lines of the page, as the gateway sent them. */
  lines: string[];
  choices: Choice[];
  tag: string | null;
  secret: string | null;
  /** The last thing that happened, in one line. */
  status: string;
  /** The code of the answer the human gave, once it was accepted. */
  answeredCode: string | null;
}

/** The answer the human gave, with the label of the choice. */
export interface Answer {
  letter: string;
  code: string;
  label: string;
}

export interface SessionOptions {
  transport: Transport;
  capcode: string;
  /** Called on every change, so the screen can be redrawn. */
  onChange?: (view: PagerView) => void;
  /** Called for every line sent or received: the transcript of the session. */
  onLog?: (line: string) => void;
  /** Called when the human answers, so the Central can be told. */
  onAnswer?: (answer: Answer) => void;
}

/** The status of a delivered answer. */
export const ANSWER_SENT = 'answer sent';

export class PagerSession {
  private readonly transport: Transport;
  private readonly onChange: (view: PagerView) => void;
  private readonly onLog: (line: string) => void;
  private readonly onAnswer: (answer: Answer) => void;
  private current: PagerView;

  constructor(options: SessionOptions) {
    this.transport = options.transport;
    this.onChange = options.onChange ?? (() => undefined);
    this.onLog = options.onLog ?? (() => undefined);
    this.onAnswer = options.onAnswer ?? (() => undefined);
    this.current = {
      state: 'connecting',
      capcode: options.capcode,
      pageId: null,
      fingerprint: null,
      code: null,
      lines: [],
      choices: [],
      tag: null,
      secret: null,
      status: 'connecting to the gateway',
      answeredCode: null,
    };
  }

  /** The current state of the screen. */
  get view(): PagerView {
    return this.current;
  }

  /** Open the connection and wait for the greeting of the gateway. */
  async start(): Promise<void> {
    this.transport.onLine((line) => this.handleLine(line));
    this.transport.onClose((reason) => this.close(reason));
    this.transport.onError((error) => this.fail(error.message));
    await this.transport.connect();
    this.update({ state: 'registering', status: 'connected, waiting for the gateway' });
  }

  /** Read one line of the gateway and apply it. */
  handleLine(line: string): void {
    this.onLog(`S: ${line}`);
    this.apply(parseFrame(line));
  }

  /** A key of the pager: `a`…`d`, `1`…`4`, or `q` to hang up. */
  pressKey(key: string): void {
    const action = keyAction(key);
    if (action.kind === 'quit') {
      this.send('QUIT');
      this.update({ state: 'closed', status: 'hung up' });
      return;
    }
    if (action.kind === 'none') return;
    if (!this.canAnswer(action.letter)) {
      this.update({ status: 'no answer to give on this page' });
      return;
    }
    this.send(`MCR ${action.code}`);
    this.update({
      state: 'answering',
      status: `answer ${action.letter} sent to the gateway`,
      answeredCode: action.code,
    });
    this.onAnswer({
      letter: action.letter,
      code: action.code,
      label: this.labelOf(action.letter),
    });
  }

  /** Hang up: `QUIT`, then the socket closes. */
  quit(): void {
    this.send('QUIT');
    this.update({ state: 'closed', status: 'hung up' });
    this.transport.close();
  }

  /** Apply one frame of the gateway to the state of the pager. */
  private apply(frame: GatewayFrame): void {
    switch (frame.kind) {
      case 'ready':
        this.register();
        return;
      case 'ok':
        this.applyOk(frame.text);
        return;
      case 'error':
        this.applyError(frame.text);
        return;
      case 'page':
        this.update({
          pageId: frame.pageId,
          fingerprint: frame.fingerprint ?? this.current.fingerprint,
          status: `page ${frame.pageId} from the Central`,
        });
        return;
      case 'message':
        this.update({
          state: 'delivered',
          lines: [frame.text],
          code: pageCodeOf(frame.text),
          choices: [],
          tag: null,
          secret: null,
          answeredCode: null,
          status: 'a page is on the screen',
        });
        return;
      case 'choice':
        this.addChoice(frame.code, frame.label);
        return;
      case 'send':
        this.update({
          tag: frame.tag,
          secret: frame.secret,
          status: 'delivered, waiting for an answer',
        });
        return;
      case 'expired':
        this.update({ state: 'expired', status: 'the message expired before delivery' });
        return;
      case 'goodbye':
        this.update({ state: 'closed', status: 'the gateway closed the session' });
        return;
      case 'unknown':
        this.update({ status: `ignored: ${frame.text}` });
    }
  }

  /** `220 SNPP (V3) Gateway Ready` → the pager introduces itself. */
  private register(): void {
    this.send(`UNIT ${this.current.capcode}`);
    this.update({ state: 'registering', status: `registering as ${this.current.capcode}` });
  }

  /** The `250` of the gateway: which one it is depends on the text. */
  private applyOk(text: string): void {
    if (text.includes('Unit Registered')) {
      this.update({ state: 'registered', status: `registered as ${this.current.capcode}` });
      return;
    }
    if (text.includes('Response Accepted')) {
      this.update({ state: 'answered', status: ANSWER_SENT });
      return;
    }
    this.update({ status: text });
  }

  /** The `550` of the gateway: a refusal, always explicit. */
  private applyError(text: string): void {
    if (text.includes('Invalid Pager ID')) {
      this.update({ state: 'failed', status: 'the gateway refused this pager id' });
      return;
    }
    if (text.includes('Unit Already Registered')) {
      this.update({ state: 'failed', status: 'this pager id is already registered' });
      return;
    }
    if (text.includes('No Message Awaiting Reply')) {
      this.update({ status: 'no message awaiting a reply' });
      return;
    }
    this.update({ status: text });
  }

  /** One seeded reply: the code of the wire and the letter on the screen. */
  private addChoice(code: string, label: string): void {
    const letter = letterOfCode(code);
    if (letter === null) return;
    const choices = [...this.current.choices.filter((item) => item.code !== code), { code, letter, label }];
    this.update({ choices });
  }

  /** The label of a letter, when the gateway seeded one. */
  private labelOf(letter: string): string {
    return this.current.choices.find((choice) => choice.letter === letter)?.label ?? '';
  }

  /**
   * A letter can be given when the gateway seeded it, or when no reply was
   * seeded at all: without options the page is a yes/no one, and `a` approves
   * while `b` denies.
   */
  private canAnswer(letter: ChoiceLetter): boolean {
    if (this.current.lines.length === 0) return false;
    if (this.current.choices.length === 0) return letter === 'A' || letter === 'B';
    return this.current.choices.some((choice) => choice.letter === letter);
  }

  private send(line: string): void {
    this.onLog(`C: ${line}`);
    this.transport.send(line);
  }

  private close(reason: string): void {
    if (this.current.state === 'closed') return;
    this.update({ state: 'closed', status: `the gateway closed the session (${reason})` });
  }

  private fail(reason: string): void {
    this.update({ state: 'failed', status: `connection lost: ${reason}` });
  }

  /** Apply a patch, then tell the screen. */
  private update(patch: Partial<PagerView>): void {
    this.current = { ...this.current, ...patch };
    this.onChange(this.current);
  }
}
