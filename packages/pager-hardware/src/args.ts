/**
 * The arguments of `bip-pager-hw`. Pure: no I/O, no environment read, so
 * every rule below is testable without a Central and without a Pi.
 */

export type DisplayKind = 'mock' | 'hd44780';
export type ButtonsKind = 'mock' | 'gpio';
export type BuzzerKind = 'mock' | 'gpio';

export const DEFAULTS = {
  central: 'http://127.0.0.1:8787',
  display: 'mock',
  buttons: 'mock',
  buzzer: 'mock',
  pollMs: 2000,
} as const;

export interface HardwareOptions {
  central: string;
  code: string;
  display: DisplayKind;
  buttons: ButtonsKind;
  buzzer: BuzzerKind;
  pollMs: number;
  help: boolean;
}

const VALUE_FLAGS = ['--code', '--central', '--display', '--buttons', '--buzzer', '--poll'] as const;
const BOOLEAN_FLAGS = ['--help', '-h'] as const;

/** The pairing code of the Central: six characters, A-Z and 0-9. */
const CODE_PATTERN = /^[A-Z0-9]{6}$/;

/** Parse the arguments, or return the message of the first mistake. */
export function parseArgs(argv: readonly string[]): HardwareOptions | string {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--') && arg !== '-h') {
      return `unexpected argument "${arg}"`;
    }
    const equal = arg.indexOf('=');
    const name = equal === -1 ? arg : arg.slice(0, equal);
    if ((BOOLEAN_FLAGS as readonly string[]).includes(name)) {
      flags.set(name, true);
      continue;
    }
    if (!(VALUE_FLAGS as readonly string[]).includes(name)) {
      return `unknown option "${name}"`;
    }
    const value = equal === -1 ? argv[index + 1] : arg.slice(equal + 1);
    if (value === undefined || value.startsWith('--')) {
      return `option "${name}" needs a value`;
    }
    flags.set(name, value);
    if (equal === -1) index += 1;
  }

  const help = flags.get('--help') === true || flags.get('-h') === true;
  const code = ((flags.get('--code') as string | undefined) ?? '').trim().toUpperCase();
  if (!help && !CODE_PATTERN.test(code)) {
    return 'invalid --code: six characters, A-Z and 0-9';
  }
  const central = (flags.get('--central') as string | undefined) ?? DEFAULTS.central;
  if (!/^https?:\/\//.test(central)) {
    return `invalid --central "${central}": an http(s) URL`;
  }
  const display = choiceOf(flags.get('--display'), DEFAULTS.display, ['mock', 'hd44780'], '--display');
  if (!display.ok) return display.error;
  const buttons = choiceOf(flags.get('--buttons'), DEFAULTS.buttons, ['mock', 'gpio'], '--buttons');
  if (!buttons.ok) return buttons.error;
  const buzzer = choiceOf(flags.get('--buzzer'), DEFAULTS.buzzer, ['mock', 'gpio'], '--buzzer');
  if (!buzzer.ok) return buzzer.error;
  const pollMs = Number((flags.get('--poll') as string | undefined) ?? DEFAULTS.pollMs);
  if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000) {
    return `invalid --poll "${flags.get('--poll') ?? DEFAULTS.pollMs}": 100 to 60000 ms`;
  }
  return {
    central: central.replace(/\/+$/, ''),
    code,
    display: display.value,
    buttons: buttons.value,
    buzzer: buzzer.value,
    pollMs,
    help,
  };
}

/** The outcome of reading a `--flag mock|…` style choice. */
type Choice<T extends string> = { ok: true; value: T } | { ok: false; error: string };

/** Read a `--flag mock|…` style choice, or a refusal. */
function choiceOf<T extends string>(
  raw: string | true | undefined,
  fallback: string,
  allowed: readonly T[],
  flag: string,
): Choice<T> {
  if (raw === true) return { ok: false, error: `option "${flag}" needs a value` };
  const value = raw ?? fallback;
  if ((allowed as readonly string[]).includes(value)) return { ok: true, value: value as T };
  return { ok: false, error: `unknown ${flag} "${value}": one of ${allowed.join(', ')}` };
}