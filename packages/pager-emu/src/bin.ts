#!/usr/bin/env node
/**
 * `bip-pager` — the runnable entry point.
 *
 *   bip-pager --host 127.0.0.1 --port 4440 --capcode lea --code ABC123
 *
 * The keys are read in raw mode: a pager of 1995 had no Enter key, and
 * neither has this one. When the standard input is not a terminal (a pipe, a
 * test), the same bytes are read as they come.
 */
import { parseArgs } from './args.js';
import { startApp, type App } from './app.js';
import { HELP_TEXT } from './help.js';

/** How long the emulator waits for the `221` of the gateway before leaving. */
const HANG_UP_MS = 200;

/** The running application, and the guard that leaves only once. */
let current: App | null = null;
let finished = false;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (typeof parsed === 'string') {
    process.stderr.write(`bip-pager: ${parsed}\nTry \`bip-pager --help\`.\n`);
    process.exitCode = 2;
    return;
  }
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  let app: App;
  try {
    app = await startApp({
      options: parsed,
      clearScreen: process.stdout.isTTY ? '\u001b[2J\u001b[H' : '',
      onExit: () => finish(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`bip-pager: ${reason}\n`);
    process.exitCode = 2;
    return;
  }
  current = app;
  if (app.session.view.state === 'closed') {
    finish();
    return;
  }
  readKeys(app);
}

/** Every key of the keyboard is an answer, except the ones we ignore. */
function readKeys(app: App): void {
  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', (chunk: Buffer) => {
    for (const char of chunk.toString()) {
      app.session.pressKey(char);
      if (app.session.view.state === 'closed') return;
    }
  });
  process.on('SIGINT', () => {
    app.session.quit();
    finish();
  });
}

/** Hang up: leave the raw mode, close the socket, go. */
function finish(): void {
  if (finished) return;
  finished = true;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  current?.shutdown();
  setTimeout(() => process.exit(0), HANG_UP_MS).unref();
}

void main().catch((error: unknown) => {
  process.stderr.write(`bip-pager: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
