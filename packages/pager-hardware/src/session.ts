/**
 * The hardware pager, as a pure state machine — no I/O of its own.
 *
 * It pairs itself as a device of the Central (an ECDSA P-256 key from
 * `@bipeur/core`), reads its pending pages, draws each on the display, and
 * when a button is pressed signs the decision with the shared claims of the
 * PWA and sends it back. Everything it touches is injected — the Central, the
 * display, the buzzer and the clock — so the whole machine runs against fakes
 * in a test.
 */
import type { SignedDecision } from '@bipeur/core';
import type { ButtonInput, ButtonLetter } from './buttons.js';
import type { Buzzer } from './buzzer.js';
import type { CentralApi, DecisionAck, PendingPage } from './central.js';
import { signDecision } from './decision.js';
import { generateDeviceKey, type DeviceKey } from './device.js';
import {
  layoutScreen,
  LCD_COLS_20,
  LCD_ROWS_20,
  type DisplayDriver,
  type PendingPageView,
} from './display.js';

export type SessionState =
  | 'idle'
  | 'pairing'
  | 'paired'
  | 'paged'
  | 'deciding'
  | 'decided'
  | 'failed';

/** What the screen shows, and the tests assert. Immutable, rebuilt on change. */
export interface PagerView {
  state: SessionState;
  deviceId: string | null;
  page: PendingPageView | null;
  status: string;
  decision: SignedDecision | null;
  ack: DecisionAck | null;
}

export interface SessionOptions {
  api: CentralApi;
  display: DisplayDriver;
  /** The six-character pairing code of the Central. */
  code: string;
  deviceName?: string;
  buzzer?: Buzzer;
  now?: () => number;
  /** Injected in the tests; the binary generates its own non-extractable key. */
  key?: DeviceKey;
  /** The geometry of the glass: 20×4 or 16×2. Defaults to 20×4. */
  cols?: number;
  rows?: number;
}

/** The hardware pager. It is also the `ButtonInput` the readers push into. */
export class PagerSession implements ButtonInput {
  private current: PagerView;
  private key: DeviceKey | null;
  private token: string | null = null;
  private readonly now: () => number;
  private readonly buzzer: Buzzer;
  private readonly deviceName: string;
  private readonly cols: number;
  private readonly rows: number;

  constructor(private readonly options: SessionOptions) {
    this.now = options.now ?? (() => Date.now());
    this.buzzer = options.buzzer ?? { beep: () => undefined };
    this.deviceName = options.deviceName ?? 'bip-pager-hw';
    this.cols = options.cols ?? LCD_COLS_20;
    this.rows = options.rows ?? LCD_ROWS_20;
    this.key = options.key ?? null;
    this.current = {
      state: 'idle',
      deviceId: null,
      page: null,
      status: 'not paired',
      decision: null,
      ack: null,
    };
  }

  get view(): PagerView {
    return this.current;
  }

  /** Generate the key (once) and pair against the six-character code. */
  async start(): Promise<void> {
    try {
      this.update({ state: 'pairing', status: `pairing as ${this.deviceName}` });
      if (this.key === null) this.key = await generateDeviceKey();
      const pairing = await this.options.api.pair(
        this.options.code,
        this.key.publicKeyJwk,
        this.deviceName,
      );
      this.token = pairing.token;
      this.update({
        state: 'paired',
        deviceId: pairing.deviceId,
        status: `paired as ${pairing.deviceId}`,
      });
    } catch (error) {
      this.update({ state: 'failed', status: reasonOf(error) });
    }
    this.draw();
  }

  /** Read the pending pages; return true when a new one reached the screen. */
  async poll(): Promise<boolean> {
    if (this.current.deviceId === null || this.token === null) return false;
    if (this.current.state !== 'paired' && this.current.state !== 'decided') return false;
    let pages: PendingPage[];
    try {
      pages = await this.options.api.pendingPages(this.current.deviceId, this.token);
    } catch (error) {
      this.update({ state: 'failed', status: reasonOf(error) });
      this.draw();
      return false;
    }
    const page = pages[0] ?? null;
    if (page === null) {
      this.update({ status: 'no pending page' });
      this.draw();
      return false;
    }
    this.update({
      state: 'paged',
      page: toPageView(page),
      decision: null,
      ack: null,
      status: `page ${page.pageId}`,
    });
    this.buzzer.beep(1);
    this.draw();
    return true;
  }

  /** A button was pressed: sign and send the decision for the page on screen. */
  onPress(letter: ButtonLetter): void {
    void this.press(letter);
  }

  async press(letter: ButtonLetter): Promise<void> {
    const page = this.current.page;
    if (page === null) {
      this.update({ status: 'no page on the screen' });
      this.draw();
      return;
    }
    const verdict = verdictFor(letter, page.options.map((option) => option.code));
    if (verdict === null) {
      this.update({ status: `no answer "${letter}" on this page` });
      this.draw();
      return;
    }
    await this.decide(verdict, page);
  }

  /** Build, sign and send the decision; the Central verifies it (BIP-F-18). */
  private async decide(
    verdict: { kind: 'approve' | 'deny' } | { kind: 'choice'; choice: string },
    page: PendingPageView,
  ): Promise<void> {
    const deviceId = this.current.deviceId;
    if (deviceId === null || this.token === null || this.key === null) {
      this.update({ status: 'not paired — nothing was signed' });
      this.draw();
      return;
    }
    try {
      const decision = await signDecision(
        {
          pageId: page.pageId,
          fingerprint: page.fingerprint,
          verdict: verdict.kind,
          choice: verdict.kind === 'choice' ? verdict.choice : null,
          deviceId,
          hasOptions: page.options.length > 0,
          now: this.now(),
        },
        this.key,
      );
      this.update({ state: 'deciding', decision, status: 'decision signed, sending' });
      const ack = await this.options.api.postDecision(page.pageId, decision, this.token);
      this.update({
        state: 'decided',
        ack,
        status: ack.accepted ? 'decision accepted' : `decision refused: ${ack.reason ?? 'unknown'}`,
      });
    } catch (error) {
      this.update({ state: 'failed', status: reasonOf(error) });
    }
    this.draw();
  }

  private draw(): void {
    this.options.display.write(
      layoutScreen(
        { page: this.current.page, status: this.current.status },
        { cols: this.cols, rows: this.rows, phase: this.current.state },
      ),
    );
  }

  private update(patch: Partial<PagerView>): void {
    this.current = { ...this.current, ...patch };
  }
}

/** The verdict a letter means, or null when the letter answers nothing. */
export function verdictFor(
  letter: ButtonLetter,
  optionCodes: string[],
): { kind: 'approve' | 'deny' } | { kind: 'choice'; choice: string } | null {
  if (optionCodes.length === 0) {
    if (letter === 'A') return { kind: 'approve' };
    if (letter === 'B') return { kind: 'deny' };
    return null;
  }
  return optionCodes.includes(letter) ? { kind: 'choice', choice: letter } : null;
}

/** The slice of a page the screen needs (the session keeps only that). */
function toPageView(page: PendingPage): PendingPageView {
  return {
    pageId: page.pageId,
    line: page.line,
    code: page.code,
    risk: page.risk,
    fingerprint: page.fingerprint,
    options: page.options,
  };
}

/** Why an error: its message, never a stack in the status line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}