/**
 * The flow of a gate step (BIP-F-48): read inputs, page the human, wait, decide,
 * report. Everything that touches the outside world is injected — environment,
 * fetch, clock, sleep, reporter — so the whole decision path runs in a unit test
 * with a fake Central and never opens a socket.
 *
 * The shape of the loop is the one the CLI already follows (`packages/cli/src/ask.ts`):
 * long polls of at most 50 s, a hard bound on iterations, and a deadline that is
 * the job's own `timeout-minutes`. What differs is the verdict table: a gate has
 * two outcomes, run the job or fail it.
 */
import { loadEvent } from './event.js';
import { messageOf } from './errors.js';
import { createCentral } from './central.js';
import { prContext, jobContext } from './github.js';
import { gateInputs, gatePrInputs, MAX_POLL_SECONDS, SECOND } from './inputs.js';
import { createReporter } from './report.js';
import { pullRequestPageRequest, toolPageRequest } from './request.js';
import { secretList } from './redact.js';
import { decide, decideTransport, OUTCOME } from './verdict.js';

/** Same bound as the CLI: 720 polls of 50 s is far past any sane job timeout. */
export const MAX_POLLS = 720;
/** A transient blip is retried, then the gate fails closed (3 tries, as the CLI). */
export const MAX_CONSECUTIVE_FAILURES = 3;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {Record<string, string|undefined>} env */
function prepareGate(env) {
  const inputs = gateInputs(env, jobContext(env));
  return { inputs, body: toolPageRequest(inputs.facts), secrets: secretList([inputs.token]) };
}

/** @param {Record<string, string|undefined>} env @param {{readEvent?: (path:string)=>string}} deps */
function prepareGatePr(env, deps) {
  const event = loadEvent(env, deps.readEvent);
  const inputs = gatePrInputs(env, prContext(event, env));
  return { inputs, body: pullRequestPageRequest(inputs.facts), secrets: secretList([inputs.token]) };
}

/**
 * `gate`: page the human about one command, then run the job or fail it.
 * @param {{env?:Record<string,string|undefined>, fetchImpl?:typeof fetch,
 *   now?:()=>number, sleep?:(ms:number)=>Promise<void>, reporter?:object,
 *   central?:object, io?:object, exit?:(code:number)=>void,
 *   readEvent?:(path:string)=>string}} [deps]
 */
export async function runGate(deps = {}) {
  return gateFlow(deps, prepareGate);
}

/**
 * `gate-pr`: same, but the page carries the head SHA of the pull request, so the
 * signature only ever covers the code that was reviewed.
 */
export async function runGatePr(deps = {}) {
  return gateFlow(deps, (env, all) => prepareGatePr(env, all));
}

async function gateFlow(deps, prepare) {
  const env = deps.env ?? process.env;
  const io = deps.io ?? console;
  const plain = deps.reporter ?? createReporter(env, io, deps.exit ?? exitWithCode, []);
  let prepared;
  try {
    prepared = prepare(env, deps);
  } catch (error) {
    plain.fail(messageOf(error));
    return { outcome: OUTCOME.FAIL, reason: messageOf(error) };
  }
  const { inputs, body, secrets } = prepared;
  const reporter = deps.reporter ?? createReporter(env, io, deps.exit ?? exitWithCode, secrets);
  const central = deps.central ?? createCentral({
    url: inputs.url,
    token: inputs.token,
    fetchImpl: deps.fetchImpl,
    secrets,
  });
  return settle(deps, { inputs, body, central, reporter });
}

async function settle(deps, { inputs, body, central, reporter }) {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  let page;
  try {
    page = await central.createPage(body);
  } catch (error) {
    return publish(reporter, inputs, null, null, decideTransport(messageOf(error)));
  }
  reporter.info(`paged ${page.station || inputs.station}: ${page.line}`);
  const { wait, transport } = await waitForAnswer(central, page.id, inputs.waitSeconds, { now, sleep });
  const verdict = transport ? decideTransport(transport) : decide(wait, { allowChoice: inputs.allowChoice });
  return publish(reporter, inputs, page, wait, verdict);
}

/** Long-poll until the page settles, the deadline passes, or the Central is gone. */
async function waitForAnswer(central, pageId, waitSeconds, { now, sleep }) {
  const deadline = now() + waitSeconds * SECOND;
  let last = null;
  let failures = 0;
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const remaining = Math.max(0, deadline - now());
    const slice = Math.max(1, Math.min(MAX_POLL_SECONDS, Math.ceil(remaining / SECOND)));
    try {
      last = await central.waitDecision(pageId, slice);
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        return { wait: last, transport: messageOf(error) };
      }
      await sleep(SECOND * failures);
      continue;
    }
    if (last.status !== 'pending') return { wait: last, transport: null };
    if (now() >= deadline) return { wait: last, transport: null };
    await sleep(SECOND);
  }
  return { wait: last, transport: null };
}

/** Outputs, summary, and the exit code of the step. */
function publish(reporter, inputs, page, wait, verdict) {
  const rows = [
    ['page_id', page?.id ?? '-'],
    ['line', page?.line ?? '(no page created)'],
    ['fingerprint', page?.fingerprint ?? '-'],
    ['status', wait?.status ?? 'unreachable'],
    ['choice', wait?.choice ?? '-'],
    ['simulated', wait ? String(wait.simulated === true) : '-'],
    ['latency_ms', wait ? String(wait.latencyMs) : '-'],
    ['outcome', verdict.outcome],
    ['why', verdict.reason],
  ];
  for (const [name, value] of rows) reporter.setOutput(name, value);
  reporter.summary(rows);
  if (verdict.outcome === OUTCOME.PASS) {
    reporter.pass(`deploy allowed — ${verdict.reason}`);
  } else {
    reporter.fail(`gate refused the job — ${verdict.reason}`);
  }
  return { ...verdict, page, wait, inputs: redactedInputs(inputs) };
}

function redactedInputs(inputs) {
  return { url: inputs.url, station: inputs.station, waitSeconds: inputs.waitSeconds };
}

/**
 * The step fails on the process exit code, not on `process.exit()`: a hard exit
 * can truncate the log buffer and the summary file the runner is still writing.
 *
 * @param {number} code
 */
function exitWithCode(code) {
  if (code !== 0 && typeof process !== 'undefined') process.exitCode = code;
}

