/**
 * Public surface of the Bipeur GitHub Action (BIP-F-48).
 *
 * Plain JavaScript, no build, no runtime dependency: a JavaScript action is
 * executed straight from the repository checkout, where no `node_modules` exist.
 * The two entry points (`gate.js`, `gate-pr.js`) are thin; everything a test can
 * assert on lives in `lib/` and is pure or fully injectable.
 */
export { GateError, messageOf } from './lib/errors.js';
export { OUTCOME, STATUSES, decide, decideTransport, isSettled } from './lib/verdict.js';
export { LIMITS, statsOf, ttlSecondsOf, toolPageRequest, pullRequestPageRequest } from './lib/request.js';
export {
  DEFAULT_TIMEOUT_MINUTES,
  MAX_POLL_SECONDS,
  gateInputs,
  gatePrInputs,
  minutesOf,
  rawInput,
  stationOf,
} from './lib/inputs.js';
export { jobContext, prContext, refParts, repoShortName } from './lib/github.js';
export { loadEvent } from './lib/event.js';
export { createCentral, pageOf, waitOf, requestOf } from './lib/central.js';
export { createReporter, outputLine, workflowCommand } from './lib/report.js';
export { redact, oneLine, secretList, REDACTED } from './lib/redact.js';
export { runGate, runGatePr, MAX_POLLS, MAX_CONSECUTIVE_FAILURES } from './lib/run.js';
