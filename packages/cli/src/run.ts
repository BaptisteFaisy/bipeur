/**
 * Entry logic of `bip`, separated from `bin.ts` so every branch is testable
 * without a process: the streams, the clock and `fetch` are injected.
 */
import { toLineText } from '@bipeur/core';
import { createCentralClient } from './api.js';
import { ask } from './ask.js';
import { parseArgs, type AskCommand, type NotifyCommand } from './args.js';
import { describeError } from './errors.js';
import { EXIT } from './exit-codes.js';
import { HELP_TEXT } from './help.js';
import { previewAsk } from './preview.js';
import { describeDecision, toJson } from './render.js';

export const DEFAULT_URL = 'http://127.0.0.1:8787';

export interface RunDeps {
  env?: NodeJS.ProcessEnv;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Endpoint {
  url: string;
  token: string;
}

/** `--url` beats `$BIPEUR_URL`; a missing token is an error, never a silent default. */
function resolveEndpoint(command: AskCommand | NotifyCommand, env: NodeJS.ProcessEnv): Endpoint | string {
  const url = command.url ?? env['BIPEUR_URL'] ?? DEFAULT_URL;
  const token = command.token ?? env['BIPEUR_TOKEN'];
  if (token === undefined || token.length === 0) {
    return 'no station token: pass --token or set BIPEUR_TOKEN';
  }
  return { url, token };
}

async function runAsk(
  command: AskCommand,
  endpoint: Endpoint,
  deps: RunDeps,
  stdout: (text: string) => void,
): Promise<number> {
  if (command.dryRun) {
    const preview = previewAsk(command);
    stdout(command.json ? `${JSON.stringify(preview)}\n` : `${preview.line}\ndry run: nothing sent\n`);
    return EXIT.YES;
  }
  const client = createCentralClient({
    baseUrl: endpoint.url,
    token: endpoint.token,
    fetchImpl: deps.fetchImpl,
  });
  const result = await ask(command, {
    client,
    now: deps.now,
    sleep: deps.sleep,
    onLine: command.json ? undefined : (line) => stdout(`${line}\n`),
  });
  stdout(command.json ? `${toJson(result)}\n` : `${describeDecision(result)}\n`);
  return result.exitCode;
}

async function runNotify(
  command: NotifyCommand,
  endpoint: Endpoint,
  deps: RunDeps,
  stdout: (text: string) => void,
): Promise<number> {
  const client = createCentralClient({
    baseUrl: endpoint.url,
    token: endpoint.token,
    fetchImpl: deps.fetchImpl,
  });
  const line = toLineText(command.line);
  await client.postNotice(line, command.station ?? undefined);
  stdout(command.json ? `${JSON.stringify({ status: 'logged', line })}\n` : `logged: ${line}\n`);
  return EXIT.YES;
}

export async function runCli(argv: readonly string[], deps: RunDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((text: string) => void process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => void process.stderr.write(text));

  const command = parseArgs(argv);
  if (command.kind === 'help') {
    stdout(HELP_TEXT);
    return EXIT.YES;
  }
  if (command.kind === 'error') {
    stderr(`bip: ${command.message}\nTry \`bip --help\`.\n`);
    return EXIT.ERROR;
  }

  const endpoint = resolveEndpoint(command, env);
  if (typeof endpoint === 'string') {
    stderr(`bip: ${endpoint}\n`);
    return EXIT.ERROR;
  }

  try {
    return command.kind === 'ask'
      ? await runAsk(command, endpoint, deps, stdout)
      : await runNotify(command, endpoint, deps, stdout);
  } catch (error) {
    stderr(`bip: ${describeError(error)}\n`);
    return EXIT.ERROR;
  }
}
