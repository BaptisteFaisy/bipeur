#!/usr/bin/env node
/** `bip-notice` — the end-of-turn hook (BIP-F-25). It always exits 0. */
import { NOTICE_USAGE, parseNoticeArgs } from './args.js';
import { runNotice } from './notice.js';
import { readStdin } from './stdin.js';

const cli = parseNoticeArgs(process.argv.slice(2), process.env);

if (cli.help) {
  process.stdout.write(`${NOTICE_USAGE}\n`);
} else {
  const result = await runNotice(await readStdin(), cli);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
}
process.exitCode = 0;
