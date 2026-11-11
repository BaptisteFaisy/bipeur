/**
 * @bipeur/cli — `bip`, the shell entry point: ask a human, get an exit code.
 * Exit 0 = yes, 1 = no, 3 = expired, 2 = error (BIP-F-29).
 */
export { EXIT, type ExitCode } from './exit-codes.js';
export { CliError, describeError } from './errors.js';
export { parseArgs, parseChoice, YES_NO_OPTIONS, type AskCommand, type Command, type NotifyCommand } from './args.js';
export { createCentralClient, type CentralClient, type PageSummary } from './api.js';
export { ask, buildRequest, exitCodeFor, type AskResult } from './ask.js';
export { describeDecision, toHuman, toJson, toMachineResult } from './render.js';
export { previewAsk, type Preview } from './preview.js';
export { HELP_TEXT } from './help.js';
export { DEFAULT_URL, runCli, type RunDeps } from './run.js';
