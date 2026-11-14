/**
 * What the gate writes back to GitHub: step outputs, the job log, the run
 * summary (BIP-F-48).
 *
 * No `@actions/core`: the runner protocol is a file and a couple of workflow
 * commands, and a dependency would have to be bundled — which a JS action is not
 * allowed to need. Everything is injected (`env`, `io`, `exit`) so the decision
 * path is testable without a runner.
 */
import { appendFileSync } from 'node:fs';
import { oneLine, redact } from './redact.js';

/**
 * `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` take `name=value` lines; a value with
 * a line break needs the delimited form, and no value here should have one —
 * `oneLine` guarantees it, so a workflow cannot smuggle a command into the file.
 *
 * @param {string} name
 * @param {string|number|boolean|null|undefined} value
 */
export function outputLine(name, value) {
  const text = oneLine(value === null || value === undefined ? '' : String(value), 500);
  if (!/[%"'\n]/.test(text) && text.length < 200) return `${name}=${text}`;
  const delim = `bipeur_${name}_delimiter`;
  return `${name}<<${delim}\n${text}\n${delim}`;
}

/**
 * A workflow command, with the percent-escaping the runner expects.
 *
 * @param {'error'|'warning'|'notice'} kind
 * @param {string} message
 * @param {Record<string, string>} [properties]
 */
export function workflowCommand(kind, message, properties) {
  const params = Object.entries(properties ?? {})
    .map(([key, value]) => `${key}=${escapeValue(String(value))}`)
    .join(',');
  const head = params ? `::${kind} ${params}::` : `::${kind}::`;
  return `${head}${escapeValue(clip(message))}`;
}

/** A log line stays readable: 500 characters, whatever the Central answered. */
function clip(text) {
  const flat = String(text ?? '');
  return flat.length > 500 ? `${flat.slice(0, 499)}…` : flat;
}

function escapeValue(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {{log:(t:string)=>void, error:(t:string)=>void, info:(t:string)=>void}} [io]
 * @param {(code:number)=>void} [exit]
 * @param {(string|null|undefined)[]} [secrets]
 */
export function createReporter(env, io = console, exit = (code) => process.exit(code), secrets = []) {
  const append = (file, text) => {
    if (!file) return;
    appendFileSync(file, `${text}\n`, { flag: 'a' });
  };

  return {
    /** @param {string} name @param {string|number|boolean|null|undefined} value */
    setOutput(name, value) {
      append(env.GITHUB_OUTPUT, outputLine(name, value));
    },
    /** The page line is composed by the Central from facts: safe to print. */
    info(text) {
      io.info(redact(oneLine(text), secrets));
    },
    warn(text) {
      io.log(workflowCommand('warning', redact(oneLine(text), secrets)));
    },
    /** One failing step, one message, a non-zero exit: the job does not run. */
    fail(message) {
      io.error(workflowCommand('error', redact(oneLine(message), secrets)));
      exit(1);
    },
    pass(message) {
      io.log(workflowCommand('notice', redact(oneLine(message), secrets)));
    },
    /** The run summary: what was paged, who answered, how long it took. */
    summary(rows) {
      const lines = ['### Bipeur gate', ''];
      for (const [key, value] of rows) {
        lines.push(`- **${key}**: ${redact(oneLine(String(value ?? '-')), secrets)}`);
      }
      append(env.GITHUB_STEP_SUMMARY, lines.join('\n'));
    },
  };
}
