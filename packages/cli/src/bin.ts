#!/usr/bin/env node
/** `bip` — see `help.ts` for the usage page and the exit-code contract. */
import { runCli } from './run.js';

process.exitCode = await runCli(process.argv.slice(2));
