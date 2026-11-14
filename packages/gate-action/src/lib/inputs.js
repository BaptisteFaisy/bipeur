/**
 * Action inputs: the four documented ones (`url`, `token`, `command`,
 * `timeout-minutes`) plus the facts that make the page worth reading.
 * (BIP-F-48)
 *
 * Validation lives here so a bad workflow fails on its own step with the input
 * named — and never with the value of `token` echoed back (SPEC §2 rule 8).
 */
import { GateError } from './errors.js';
import { repoShortName } from './github.js';
import { LIMITS } from './request.js';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
/** The Central caps one long poll at 60 s (packages/central/src/routes/pages.ts). */
export const MAX_POLL_SECONDS = 50;
export const DEFAULT_TIMEOUT_MINUTES = 10;

/**
 * The runner exposes `with:` entries as `INPUT_<NAME>`; a dash stays a dash, but
 * a workflow written with underscores is accepted too.
 *
 * @param {Record<string, string|undefined>} env
 * @param {string} name
 */
export function rawInput(env, name) {
  const key = name.toUpperCase();
  const value = env[`INPUT_${key}`] ?? env[`INPUT_${key.replace(/-/g, '_')}`];
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {Record<string, string|undefined>} env */
function urlOf(env) {
  const url = rawInput(env, 'url') || String(env.BIPEUR_URL ?? '').trim();
  if (!url) throw new GateError('input "url" is required (the Central, e.g. https://pager.example.com)');
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new GateError('input "url" must be an http(s) URL');
  return url.replace(/\/+$/, '');
}

/** @param {Record<string, string|undefined>} env */
function tokenOf(env) {
  const token = rawInput(env, 'token') || String(env.BIPEUR_TOKEN ?? '').trim();
  if (!token) throw new GateError('input "token" is required — pass it from a secret, never a literal');
  return token;
}

/**
 * Minutes → a bounded number of seconds. A job that waits forever is a job that
 * never deploys *and* never tells anyone, so the ceiling is the workflow timeout.
 *
 * @param {string} raw
 */
export function minutesOf(raw, fallback) {
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new GateError(`"${raw}" is not a number of minutes`);
  }
  if (value > 1440) throw new GateError('a gate may not wait more than 1440 minutes');
  return value;
}

/**
 * The station a page belongs to: the attention budget is per station, so a
 * workflow that never names one would share a budget with every other one.
 *
 * @param {string} given
 * @param {{repo?: string, workflow?: string}} ctx
 */
export function stationOf(given, ctx) {
  const name = given || repoShortName(ctx.repo) || ctx.workflow || 'github-actions';
  return name.slice(0, LIMITS.station).toLowerCase();
}

/**
 * Normalized inputs of the `gate` action.
 *
 * @param {Record<string, string|undefined>} env
 * @param {ReturnType<typeof import('./github.js').jobContext>} job
 */
export function gateInputs(env, job) {
  const command = rawInput(env, 'command');
  if (!command) throw new GateError('input "command" is required — say what the job is about to run');
  const timeoutMinutes = minutesOf(rawInput(env, 'timeout-minutes'), DEFAULT_TIMEOUT_MINUTES);
  const ttlMinutes = minutesOf(rawInput(env, 'ttl-minutes'), timeoutMinutes);
  const station = stationOf(rawInput(env, 'station'), { repo: job.repo, workflow: job.workflow });
  return {
    url: urlOf(env),
    token: tokenOf(env),
    waitSeconds: Math.round(timeoutMinutes * 60),
    allowChoice: rawInput(env, 'allow-choice').slice(0, 1) || 'A',
    station,
    facts: {
      station,
      tool: rawInput(env, 'tool'),
      command,
      path: rawInput(env, 'path'),
      cwd: rawInput(env, 'cwd') || job.workspace,
      ref: rawInput(env, 'ref') || job.ref,
      reason: rawInput(env, 'reason'),
      sha: rawInput(env, 'sha') || job.sha,
      stats: rawInput(env, 'stats'),
      ttlSeconds: ttlMinutes * 60,
      dedupeKey: rawInput(env, 'dedupe-key') || dedupeOf(env, job),
    },
  };
}

/**
 * Normalized inputs of the `gate-pr` action. The SHA is not optional here: a
 * PR gate that does not know the commit it gates would be a replayable approval.
 *
 * @param {Record<string, string|undefined>} env
 * @param {ReturnType<typeof import('./github.js').prContext>} pr
 */
export function gatePrInputs(env, pr) {
  const timeoutMinutes = minutesOf(rawInput(env, 'timeout-minutes'), DEFAULT_TIMEOUT_MINUTES);
  const ttlMinutes = minutesOf(rawInput(env, 'ttl-minutes'), timeoutMinutes);
  const station = stationOf(rawInput(env, 'station'), { repo: pr.repo, workflow: pr.workflow });
  return {
    url: urlOf(env),
    token: tokenOf(env),
    waitSeconds: Math.round(timeoutMinutes * 60),
    allowChoice: rawInput(env, 'allow-choice').slice(0, 1) || 'A',
    station,
    facts: {
      station,
      tool: rawInput(env, 'tool'),
      command: rawInput(env, 'command'),
      reason: rawInput(env, 'reason'),
      sha: rawInput(env, 'sha') || pr.sha,
      prNumber: rawInput(env, 'pr-number') || pr.number,
      headRef: rawInput(env, 'ref') || pr.headRef,
      baseRef: pr.baseRef,
      cwd: String(env.GITHUB_WORKSPACE ?? '').trim(),
      repo: pr.repo,
      ttlSeconds: ttlMinutes * 60,
    },
  };
}

/** One run, one attempt, one commit: a retried job never reuses a page. */
function dedupeOf(env, job) {
  const attempt = String(env.GITHUB_RUN_ATTEMPT ?? '1').trim() || '1';
  const parts = ['gate', job.repo, job.runId, attempt, job.sha].filter(Boolean);
  return parts.join(':').slice(0, LIMITS.dedupe_key);
}
