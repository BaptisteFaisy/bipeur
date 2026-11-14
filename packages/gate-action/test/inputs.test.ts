/**
 * BIP-F-48 — inputs. The four documented ones work, the defaults are the ones a
 * workflow forgets, and a missing `token` fails with the name of the input and
 * never with a value.
 */
import { describe, expect, it } from 'vitest';
import {
  GateError,
  gateInputs,
  gatePrInputs,
  jobContext,
  minutesOf,
  prContext,
  rawInput,
  stationOf,
} from '../src/index.js';

const TOKEN = 'statio…abcd';

const env = {
  INPUT_URL: 'https://pager.example.com/',
  INPUT_TOKEN: 'statio…abcd',
  INPUT_COMMAND: 'flyctl deploy --ha=false',
  GITHUB_REPOSITORY: 'Tradoooo/bipeur',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'b'.repeat(40),
  GITHUB_WORKSPACE: '/home/runner/work/bipeur/bipeur',
  GITHUB_RUN_ID: '77',
  GITHUB_RUN_ATTEMPT: '1',
};

describe('rawInput', () => {
  it('reads the dashed name the runner writes, and the underscored one a workflow may use', () => {
    expect(rawInput({ 'INPUT_TIMEOUT-MINUTES': '7' }, 'timeout-minutes')).toBe('7');
    expect(rawInput({ INPUT_TIMEOUT_MINUTES: '8' }, 'timeout-minutes')).toBe('8');
    expect(rawInput({}, 'timeout-minutes')).toBe('');
  });
});

describe('gateInputs', () => {
  it('takes the defaults a workflow forgets: 10 minutes, the repo as station, the job commit', () => {
    const inputs = gateInputs(env, jobContext(env));
    expect(inputs.url).toBe('https://pager.example.com');
    expect(inputs.waitSeconds).toBe(600);
    expect(inputs.station).toBe('bipeur');
    expect(inputs.facts.sha).toBe('b'.repeat(40));
    expect(inputs.facts.cwd).toBe('/home/runner/work/bipeur/bipeur');
    expect(inputs.facts.dedupeKey).toBe(`gate:Tradoooo/bipeur:77:1:${'b'.repeat(40)}`);
  });

  it('honours timeout-minutes and lets the page outlive the wait when asked', () => {
    const inputs = gateInputs({ ...env, 'INPUT_TIMEOUT-MINUTES': '3', 'INPUT_TTL-MINUTES': '30' }, jobContext(env));
    expect(inputs.waitSeconds).toBe(180);
    expect(inputs.facts.ttlSeconds).toBe(1800);
  });

  it('fails on the input that is missing, by name, without printing the token', () => {
    expect(() => gateInputs({ ...env, INPUT_URL: '' }, jobContext(env))).toThrow(/"url" is required/);
    expect(() => gateInputs({ ...env, INPUT_TOKEN: '' }, jobContext(env))).toThrow(/"token" is required/);
    expect(() => gateInputs({ ...env, INPUT_COMMAND: '' }, jobContext(env))).toThrow(/"command" is required/);
    expect(() => gateInputs({ ...env, INPUT_URL: 'pager.example.com' }, jobContext(env))).toThrow(/http\(s\) URL/);
    const message = errorMessage(() => gateInputs({ ...env, INPUT_TOKEN: '' }, jobContext(env)));
    expect(message).not.toContain(TOKEN);
  });

  it('refuses a wait longer than a job has any right to block on', () => {
    expect(() => minutesOf('2000', 10)).toThrow(/1440 minutes/);
    expect(() => minutesOf('zero', 10)).toThrow(/not a number of minutes/);
    expect(minutesOf('', 10)).toBe(10);
  });
});

describe('stationOf', () => {
  it('falls back to the repository, then the workflow, then a generic station', () => {
    expect(stationOf('', { repo: 'Tradoooo/bipeur' })).toBe('bipeur');
    expect(stationOf('', { workflow: 'deploy' })).toBe('deploy');
    expect(stationOf('', {})).toBe('github-actions');
    expect(stationOf('PLATFORM-OPS', {})).toBe('platform-ops');
  });
});

describe('gatePrInputs', () => {
  const event = {
    number: 42,
    pull_request: { head: { sha: 'c'.repeat(40), ref: 'feat/gate' }, base: { ref: 'main' } },
    repository: { full_name: 'Tradoooo/bipeur' },
  };

  it('binds to the head SHA of the pull request, not to the merge commit of the runner', () => {
    const inputs = gatePrInputs(
      { ...env, GITHUB_SHA: 'd'.repeat(40), GITHUB_EVENT_NAME: 'pull_request' },
      prContext(event, env),
    );
    expect(inputs.facts.sha).toBe('c'.repeat(40));
    expect(inputs.facts.prNumber).toBe('42');
    expect(inputs.facts.headRef).toBe('feat/gate');
    expect(inputs.facts.baseRef).toBe('main');
  });

  it('lets a workflow name the commit and the pull request explicitly', () => {
    const inputs = gatePrInputs(
      { ...env, 'INPUT_SHA': 'e'.repeat(40), 'INPUT_PR-NUMBER': '7' },
      prContext(event, env),
    );
    expect(inputs.facts.sha).toBe('e'.repeat(40));
    expect(inputs.facts.prNumber).toBe('7');
  });
});

function errorMessage(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GateError);
    return (error as Error).message;
  }
  throw new Error('expected a GateError');
}
