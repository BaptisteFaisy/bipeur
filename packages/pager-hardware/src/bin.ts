#!/usr/bin/env node
/**
 * `bip-pager-hw` — the software of the hardware pager.
 *
 *   bip-pager-hw --code ABC123 --central http://127.0.0.1:8787 --display mock
 *   bip-pager-hw --code ABC123 --display hd44780 --buttons gpio --buzzer gpio
 *
 * The keys are read one letter per line in `mock` mode, or from the GPIO in
 * `gpio` mode. The same bytes the PWA and the emulator read work here.
 */
import { startApp } from './app.js';
import { parseArgs } from './args.js';

const HELP_TEXT = `bip-pager-hw — a hardware pager for Beeper

  --code ABC123     the six-character pairing code of the Central
  --central <url>   the base URL of the Central (default http://127.0.0.1:8787)
  --display <kind>  mock (stdout) or hd44780 (I2C backpack) — default mock
  --buttons <kind>  mock (stdin lines) or gpio — default mock
  --buzzer <kind>   mock (stdout) or gpio — default mock
  --poll <ms>       how often pending pages are read (default 2000)
  --help            this text

Start with --display mock first; once the LCD is wired, switch to hd44780.
The full BOM and wiring are in the README of packages/pager-hardware.
`;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (typeof parsed === 'string') {
    process.stderr.write(`bip-pager-hw: ${parsed}\nTry \`bip-pager-hw --help\`.\n`);
    process.exitCode = 2;
    return;
  }
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  const app = await startApp({ options: parsed });
  if (app.session.view.state === 'failed') {
    process.stderr.write(`bip-pager-hw: ${app.session.view.status}\n`);
    app.stop();
    process.exitCode = 1;
    return;
  }
  process.on('SIGINT', () => {
    app.stop();
    process.exit(0);
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`bip-pager-hw: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});