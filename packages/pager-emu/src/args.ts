/**
 * The arguments of `bip-pager`. Pure: no I/O, no environment read, so every
 * rule below is testable without a gateway and without a Central.
 */

/** The defaults of the emulator: the loopback, the historical port. */
export const DEFAULTS = {
  host: '127.0.0.1',
  port: 4440,
  capcode: 'lea',
  central: 'http://127.0.0.1:8787',
} as const;

export interface EmulatorOptions {
  host: string;
  port: number;
  capcode: string;
  central: string;
  /** The six-character pairing code of the Central, when there is one. */
  code: string | null;
  help: boolean;
}

const VALUE_FLAGS = ['--host', '--port', '--capcode', '--central', '--code'] as const;
const BOOLEAN_FLAGS = ['--help', '-h'] as const;

/**
 * A pager id: the unit channel of the gateway accepts 1 to 20 characters of
 * `[A-Za-z0-9._-]`, so the emulator accepts exactly that — a capcode the
 * gateway would refuse never leaves the process.
 */
const CAPCODE_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;

/** The pairing code of the Central: six characters, A-Z and 0-9. */
const CODE_PATTERN = /^[A-Z0-9]{6}$/;

/**
 * Parse the arguments. Returns the options, or the message of the first
 * mistake — the binary prints it and stops.
 */
export function parseArgs(argv: readonly string[]): EmulatorOptions | string {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--') && !arg.startsWith('-h')) {
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
  const capcode = (flags.get('--capcode') as string | undefined) ?? DEFAULTS.capcode;
  if (!CAPCODE_PATTERN.test(capcode)) {
    return `invalid --capcode "${capcode}": 1 to 6 characters, letters, digits, - or _`;
  }
  const rawCode = flags.get('--code') as string | undefined;
  const code = rawCode === undefined ? null : rawCode.trim().toUpperCase();
  if (code !== null && !CODE_PATTERN.test(code)) {
    return `invalid --code "${rawCode}": six characters, A-Z and 0-9`;
  }
  const port = Number((flags.get('--port') as string | undefined) ?? DEFAULTS.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return `invalid --port "${flags.get('--port') ?? DEFAULTS.port}": a port is 1 to 65535`;
  }
  const central = (flags.get('--central') as string | undefined) ?? DEFAULTS.central;
  if (!/^https?:\/\//.test(central)) {
    return `invalid --central "${central}": an http(s) URL`;
  }

  return {
    host: (flags.get('--host') as string | undefined) ?? DEFAULTS.host,
    port,
    capcode,
    central: central.replace(/\/+$/, ''),
    code,
    help,
  };
}
