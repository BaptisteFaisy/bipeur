/**
 * Command-line parsing for `bip-hook` and `bip-notice`. Flags win over the
 * environment, the environment wins over the defaults (A.9).
 */
import { DEFAULT_TTL_MS, parseDuration } from '@bipeur/core';
import type { NoticeOptions } from './notice.js';
import type { HookOptions } from './types.js';

export const DEFAULT_WAIT_SECONDS = 50;
export const DEFAULT_STATION = 'agent';

export const HOOK_USAGE = `Usage: bip-hook [options]

Reads a Kiro PreToolUse event on stdin, applies the local rules, and pages a
human only when a rule says so. Exit 0 approves, exit 2 refuses with a reason.

  --rules <path>      rules file (default ./.bipeur/rules.yaml, $BIPEUR_RULES)
  --url <url>         Central URL (default $BIPEUR_URL)
  --token <token>     station token (default $BIPEUR_TOKEN)
  --station <alias>   station alias on the pager (default $BIPEUR_STATION)
  --ttl <duration>    page lifetime, e.g. 15m (default 15m)
  --timeout <s>       stop waiting after N seconds (default: the TTL)
  --wait <s>          long-poll length per request (default 50)
  --dry-run           print the line and the risk, create no page
  --help              this text`;

export const NOTICE_USAGE = `Usage: bip-notice [options]

Sends one line to the Central notice journal at the end of a turn. Never
blocks and never fails the turn.

  --line <text>       the line to send (default: derived from the event on stdin)
  --url <url>         Central URL (default $BIPEUR_URL)
  --token <token>     station token (default $BIPEUR_TOKEN)
  --station <alias>   station alias (default $BIPEUR_STATION)
  --help              this text`;

export interface HookCli extends HookOptions {
  help: boolean;
}

export interface NoticeCli extends NoticeOptions {
  help: boolean;
}

export function parseHookArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): HookCli {
  const flags = readFlags(argv);
  const ttlMs = parseDuration(text(flags, 'ttl') ?? '15m') ?? DEFAULT_TTL_MS;
  const timeoutSeconds = count(flags, 'timeout');
  return {
    rulesPath: text(flags, 'rules') ?? env['BIPEUR_RULES'] ?? './.bipeur/rules.yaml',
    url: text(flags, 'url') ?? env['BIPEUR_URL'],
    token: text(flags, 'token') ?? env['BIPEUR_TOKEN'],
    station: text(flags, 'station') ?? env['BIPEUR_STATION'] ?? DEFAULT_STATION,
    ttlMs,
    timeoutMs: timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000,
    waitSeconds: count(flags, 'wait') ?? DEFAULT_WAIT_SECONDS,
    dryRun: flags.has('dry-run'),
    help: flags.has('help') || flags.has('h'),
  };
}

export function parseNoticeArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): NoticeCli {
  const flags = readFlags(argv);
  return {
    line: text(flags, 'line'),
    url: text(flags, 'url') ?? env['BIPEUR_URL'],
    token: text(flags, 'token') ?? env['BIPEUR_TOKEN'],
    station: text(flags, 'station') ?? env['BIPEUR_STATION'] ?? DEFAULT_STATION,
    help: flags.has('help') || flags.has('h'),
  };
}

type FlagMap = Map<string, string | true>;

/** `--flag value`, `--flag=value`, `--flag`; the last one wins. */
function readFlags(argv: readonly string[]): FlagMap {
  const flags: FlagMap = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const equals = body.indexOf('=');
    if (equals >= 0) {
      flags.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(body, next);
      index += 1;
      continue;
    }
    flags.set(body, true);
  }
  return flags;
}

function text(flags: FlagMap, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function count(flags: FlagMap, name: string): number | undefined {
  const raw = text(flags, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
