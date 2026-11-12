/**
 * The buttons of the hardware pager, behind one contract: a `ButtonReader`
 * that forwards every physical press into a `ButtonInput`. `MockButtons`
 * reads one letter per line on a stream (stdin by default); `GpioButtons`
 * reads the four tactile buttons wired to GPIO through the Linux sysfs, so
 * no native npm module is needed on the Pi.
 */
import { readFileSync } from 'node:fs';

/** The four answers the pager can give — the letters of the LCD choices. */
export type ButtonLetter = 'A' | 'B' | 'C' | 'D';

export const BUTTON_LETTERS: readonly ButtonLetter[] = ['A', 'B', 'C', 'D'];

/** The receiving end of a press: the machine exposes this to a reader. */
export interface ButtonInput {
  onPress(letter: ButtonLetter): void;
}

/** A reader that detects physical presses and forwards them. */
export interface ButtonReader {
  start(input: ButtonInput): void;
  stop(): void;
}

const LETTER_BY_KEY: Readonly<Record<string, ButtonLetter>> = {
  a: 'A',
  b: 'B',
  c: 'C',
  d: 'D',
  '1': 'A',
  '2': 'B',
  '3': 'C',
  '4': 'D',
};

/** The letter a key asks for (`a`, `2` → A), or null. Pure, testable. */
export function letterOfKey(key: string): ButtonLetter | null {
  const char = key.trim().charAt(0).toLowerCase();
  return LETTER_BY_KEY[char] ?? null;
}

/** A reader that watches a stream: one line (a letter) per press. */
export class MockButtons implements ButtonReader {
  constructor(private readonly stream: NodeJS.ReadableStream = process.stdin) {}

  start(input: ButtonInput): void {
    let pending = '';
    this.stream.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      let index = pending.indexOf('\n');
      while (index !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        const letter = letterOfKey(line);
        if (letter !== null) input.onPress(letter);
        index = pending.indexOf('\n');
      }
    });
  }

  stop(): void {
    // A stream reader cannot close its source; the process owns stdin.
  }
}

/** The BCM pin numbers (not the board numbers) of the four buttons. */
export interface GpioPins {
  A: number;
  B: number;
  C: number;
  D: number;
}

export const DEFAULT_PINS: GpioPins = { A: 17, B: 27, C: 22, D: 23 };

/** A tactile button pulls the pin to GND when pressed, hence active-low. */
function readGpioPressed(pin: number): boolean {
  try {
    return readFileSync(`/sys/class/gpio/gpio${pin}/value`, 'utf8').trim() === '0';
  } catch {
    return false;
  }
}

/**
 * The real buttons: poll the four pins and report the falling edge of each
 * (a press), debounced by the poll interval. The pins must be exported at
 * boot — see the README for the `gpio-export` snippet. Off the Pi, the reads
 * fail and nothing ever fires, so the same code runs harmlessly on a laptop.
 */
export class GpioButtons implements ButtonReader {
  private timer: NodeJS.Timeout | null = null;
  private readonly last = new Map<ButtonLetter, boolean>();

  constructor(
    private readonly pins: GpioPins = DEFAULT_PINS,
    private readonly readPressed: (pin: number) => boolean = readGpioPressed,
    private readonly intervalMs: number = 20,
  ) {}

  start(input: ButtonInput): void {
    for (const letter of BUTTON_LETTERS) {
      this.last.set(letter, this.readPressed(this.pins[letter]));
    }
    this.timer = setInterval(() => {
      for (const letter of BUTTON_LETTERS) {
        const pressed = this.readPressed(this.pins[letter]);
        if (pressed && this.last.get(letter) === false) input.onPress(letter);
        this.last.set(letter, pressed);
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}