/**
 * Argument parsing of `bip` (BIP-F-29). Pure: no I/O, no environment read, so
 * every rule below is testable without a Central.
 */
import { DAY, LINE_MAX, SECOND, parseDuration, type PageOption } from '@bipeur/core';

export const DETAIL_MAX = 240;
export const TTL_MIN_MS = 30 * SECOND;
export const TTL_MAX_MS = DAY;
export const OPTION_LABEL_MAX = 20;

/** `--yes-no` seeds the two replies of a confirmation. */
export const YES_NO_OPTIONS: readonly PageOption[] = [
  { code: 'A', label: 'Yes' },
  { code: 'B', label: 'No' },
];

export interface AskCommand {
  kind: 'ask';
  question: string;
  options: PageOption[];
  /** True when the replies are Yes/No, so a `choice` verdict maps to 0 or 1. */
  yesNo: boolean;
  detail: string | null;
  ttlMs: number;
  station: string | null;
  url: string | null;
  token: string | null;
  json: boolean;
  dryRun: boolean;
}

export interface NotifyCommand {
  kind: 'notify';
  line: string;
  station: string | null;
  url: string | null;
  token: string | null;
  json: boolean;
}

export interface HelpCommand {
  kind: 'help';
}

export interface UsageErrorCommand {
  kind: 'error';
  message: string;
}

export type Command = AskCommand | NotifyCommand | HelpCommand | UsageErrorCommand;

const BOOLEAN_FLAGS = ['--yes-no', '--json', '--dry-run', '--help', '-h'];
const ASK_VALUE_FLAGS = ['--ttl', '--detail', '--station', '--url', '--token', '--choice'];
const NOTIFY_VALUE_FLAGS = ['--station', '--url', '--token'];

interface Tokenized {
  positionals: string[];
  flags: Map<string, string | true>;
}

function tokenize(args: readonly string[], valueFlags: readonly string[]): Tokenized | string {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (BOOLEAN_FLAGS.includes(name)) {
      flags.set(name, true);
      continue;
    }
    if (!valueFlags.includes(name)) return `unknown option "${name}"`;
    if (eq !== -1) {
      flags.set(name, arg.slice(eq + 1));
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) return `option "${name}" needs a value`;
    flags.set(name, value);
    index += 1;
  }
  return { positionals, flags };
}

function text(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === 'string' ? value : null;
}

/** `A=dayjs,B=luxon,C=temporal` → options, or a message when malformed. */
export function parseChoice(raw: string): PageOption[] | string {
  const parts = raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length < 2 || parts.length > 4) {
    return `--choice needs 2 to 4 replies (got ${parts.length})`;
  }
  const options: PageOption[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) return `--choice entry "${part}" must read CODE=label, e.g. A=dayjs`;
    const code = part.slice(0, eq).trim().toUpperCase();
    const label = part.slice(eq + 1).trim();
    if (!/^[A-D]$/.test(code)) return `--choice code "${code}" must be one of A, B, C, D`;
    if (options.some((option) => option.code === code)) return `--choice code "${code}" is used twice`;
    if (label.length === 0 || label.length > OPTION_LABEL_MAX) {
      return `--choice label for ${code} must be 1 to ${OPTION_LABEL_MAX} characters`;
    }
    options.push({ code, label });
  }
  return options;
}

function parseTtl(raw: string | null): number | string {
  if (raw === null) return 15 * 60 * SECOND;
  const ttlMs = parseDuration(raw);
  if (ttlMs === null) {
    return `invalid --ttl "${raw}": expected a duration such as 30s, 10m, 2h or 1d`;
  }
  if (ttlMs < TTL_MIN_MS || ttlMs > TTL_MAX_MS) {
    return `--ttl must be between 30s and 1d (got "${raw}")`;
  }
  return ttlMs;
}

function parseAsk(args: readonly string[]): Command {
  const tokenized = tokenize(args, ASK_VALUE_FLAGS);
  if (typeof tokenized === 'string') return { kind: 'error', message: tokenized };
  const { flags, positionals } = tokenized;

  const question = positionals.join(' ').trim();
  if (question.length === 0) {
    return { kind: 'error', message: 'ask needs a question, e.g. bip ask "Deploy now?" --yes-no' };
  }
  const detail = text(flags, '--detail');
  if (detail !== null && detail.length > DETAIL_MAX) {
    return { kind: 'error', message: `--detail is limited to ${DETAIL_MAX} characters (got ${detail.length})` };
  }
  const yesNo = flags.get('--yes-no') === true;
  const choiceRaw = text(flags, '--choice');
  if (yesNo && choiceRaw !== null) {
    return { kind: 'error', message: '--yes-no and --choice are mutually exclusive' };
  }
  let options: PageOption[] = yesNo ? [...YES_NO_OPTIONS] : [];
  if (choiceRaw !== null) {
    const parsed = parseChoice(choiceRaw);
    if (typeof parsed === 'string') return { kind: 'error', message: parsed };
    options = parsed;
  }
  const ttl = parseTtl(text(flags, '--ttl'));
  if (typeof ttl === 'string') return { kind: 'error', message: ttl };

  return {
    kind: 'ask',
    question,
    options,
    yesNo,
    detail,
    ttlMs: ttl,
    station: text(flags, '--station'),
    url: text(flags, '--url'),
    token: text(flags, '--token'),
    json: flags.get('--json') === true,
    dryRun: flags.get('--dry-run') === true,
  };
}

function parseNotify(args: readonly string[]): Command {
  const tokenized = tokenize(args, NOTIFY_VALUE_FLAGS);
  if (typeof tokenized === 'string') return { kind: 'error', message: tokenized };
  const { flags, positionals } = tokenized;
  const line = positionals.join(' ').trim();
  if (line.length === 0) {
    return { kind: 'error', message: 'notify needs a line, e.g. bip notify "night build finished"' };
  }
  if (line.length > LINE_MAX) {
    return { kind: 'error', message: `a notice line is limited to ${LINE_MAX} characters (got ${line.length})` };
  }
  return {
    kind: 'notify',
    line,
    station: text(flags, '--station'),
    url: text(flags, '--url'),
    token: text(flags, '--token'),
    json: flags.get('--json') === true,
  };
}

export function parseArgs(argv: readonly string[]): Command {
  const args = argv.filter((arg) => arg.length > 0);
  const first = args[0];
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    return { kind: 'help' };
  }
  const rest = args.slice(1);
  if (first === 'ask') return parseAsk(rest);
  if (first === 'notify') return parseNotify(rest);
  if (first === '--notify') return parseNotify(rest);
  if (first.startsWith('--notify=')) return parseNotify([first.slice('--notify='.length)]);
  return { kind: 'error', message: `unknown command "${first}": expected "ask" or "notify"` };
}
