/**
 * The event payload the runner writes to `GITHUB_EVENT_PATH` (BIP-F-48).
 *
 * Read through an injected function so a pull-request gate can be tested with a
 * fixture object instead of a runner. An unreadable file is not a failure: the
 * environment still carries `GITHUB_SHA`, and `prContext` raises if it does not.
 */
import { readFileSync } from 'node:fs';
import { GateError } from './errors.js';

/**
 * @param {Record<string, string|undefined>} env
 * @param {(path: string) => string} [read]
 * @returns {Record<string, any>}
 */
export function loadEvent(env, read = (path) => readFileSync(path, 'utf8')) {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return {};
  let text = '';
  try {
    text = read(path);
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new GateError('the event payload at GITHUB_EVENT_PATH is not JSON');
  }
}
