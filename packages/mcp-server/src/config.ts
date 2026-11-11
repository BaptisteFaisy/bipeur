/**
 * `bipeur-mcp` configuration: flags first, environment second, defaults last.
 */
export interface McpConfig {
  url: string;
  token: string;
  station: string;
  transport: 'stdio' | 'http';
  port: number;
  host: string;
}

export type ParsedArgs =
  | { kind: 'config'; config: McpConfig }
  | { kind: 'help' }
  | { kind: 'error'; reason: string };

export const MCP_USAGE = `Usage: bipeur-mcp [options]

MCP server exposing page_human, page_wait and page_cancel to any agent.

  --transport <mode>  stdio (default) or http
  --port <n>          HTTP port (default 8790, $BIPEUR_MCP_PORT)
  --host <host>       HTTP host (default 127.0.0.1, $BIPEUR_MCP_HOST)
  --url <url>         Central URL (default $BIPEUR_URL)
  --token <token>     station token (default $BIPEUR_TOKEN)
  --station <alias>   station alias on the pager (default $BIPEUR_STATION)
  --help              this text`;

export function parseMcpArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): ParsedArgs {
  const flags = readFlags(argv);
  if (flags.has('help') || flags.has('h')) return { kind: 'help' };

  const transport = text(flags, 'transport') ?? 'stdio';
  if (transport !== 'stdio' && transport !== 'http') {
    return { kind: 'error', reason: `unknown transport "${transport}" (stdio or http)` };
  }
  const url = text(flags, 'url') ?? env['BIPEUR_URL'];
  const token = text(flags, 'token') ?? env['BIPEUR_TOKEN'];
  if (!url) return { kind: 'error', reason: 'BIPEUR_URL is not set: the server has no Central to talk to' };
  if (!token) return { kind: 'error', reason: 'BIPEUR_TOKEN is not set: the server has no station token' };

  return {
    kind: 'config',
    config: {
      url,
      token,
      station: text(flags, 'station') ?? env['BIPEUR_STATION'] ?? 'mcp',
      transport,
      port: positiveInt(text(flags, 'port') ?? env['BIPEUR_MCP_PORT']) ?? 8790,
      host: text(flags, 'host') ?? env['BIPEUR_MCP_HOST'] ?? '127.0.0.1',
    },
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

function positiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}
