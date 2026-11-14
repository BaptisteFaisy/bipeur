/**
 * BIP-F-48 — the page the gate builds carries facts, never the agent's story,
 * and the commit is one of those facts.
 */
import { describe, expect, it } from 'vitest';
import {
  GateError,
  LIMITS,
  pullRequestPageRequest,
  statsOf,
  toolPageRequest,
  ttlSecondsOf,
} from '../src/index.js';

const base = {
  station: 'bipeur',
  command: 'pnpm deploy --prod',
  ttlSeconds: 600,
  cwd: '/home/runner/work/bipeur/bipeur',
  ref: 'main',
  sha: 'a'.repeat(40),
  dedupeKey: 'gate:Tradoooo/bipeur:12:1:aaaa',
};

describe('toolPageRequest — facts only (A.6)', () => {
  it('shapes a tool page the contract accepts', () => {
    const body = toolPageRequest(base);
    expect(body['kind']).toBe('tool');
    expect(body['command']).toBe('pnpm deploy --prod');
    expect(body['branch']).toBe('main');
    expect(body['stats']).toBe(`sha ${'a'.repeat(40)}`);
    expect(body['station']).toBe('bipeur');
    expect(body['ttl_seconds']).toBe(600);
    expect(body['tool_name']).toBe('github-action');
  });

  it('keeps the agent prose out of the facts and in agent_says', () => {
    const body = toolPageRequest({ ...base, reason: 'trust me, it is a tiny change' });
    expect(body['agent_says']).toBe('trust me, it is a tiny change');
    expect(body['command']).toBe('pnpm deploy --prod');
  });

  it('omits the facts the workflow did not give, instead of sending empty strings', () => {
    const body = toolPageRequest({ station: 's', command: 'ls', ttlSeconds: 60 });
    expect(Object.keys(body).sort()).toEqual(['command', 'kind', 'station', 'tool_name', 'ttl_seconds']);
  });

  it('names the offending input when it exceeds the contract, and never its value', () => {
    expect(() => toolPageRequest({ ...base, command: 'x'.repeat(LIMITS.command + 1) })).toThrow(GateError);
    expect(() => toolPageRequest({ ...base, command: '' })).toThrow(/"command" is required/);
    expect(() => toolPageRequest({ ...base, station: '' })).toThrow(/"station" is required/);
  });

  it('refuses a page lifetime outside the contract', () => {
    expect(ttlSecondsOf(30)).toBe(30);
    expect(() => ttlSecondsOf(5)).toThrow(/between 30 and 86400/);
    expect(() => ttlSecondsOf(Number.NaN)).toThrow(/must be a number/);
  });
});

describe('statsOf — the commit is a fact the human reads', () => {
  it('puts the sha first so the context line starts with it', () => {
    expect(statsOf('deadbeef', 'pr#42')).toBe('sha deadbeef pr#42');
  });
  it('is empty when there is nothing to show', () => {
    expect(statsOf(undefined, undefined)).toBe('');
  });
  it('cannot be padded past the contract by a clever workflow', () => {
    expect(() => statsOf('a'.repeat(40), 'x'.repeat(160))).toThrow(/exceed/);
  });
});

describe('pullRequestPageRequest — the decision binds to the head SHA', () => {
  const pr = {
    station: 'bipeur',
    sha: 'b'.repeat(40),
    prNumber: 42,
    headRef: 'feat/gate',
    baseRef: 'main',
    ttlSeconds: 600,
    repo: 'Tradoooo/bipeur',
  };

  it('defaults the command to what the human is really approving', () => {
    const body = pullRequestPageRequest(pr);
    expect(body['command']).toBe('merge pull request #42 into main');
    expect(body['stats']).toContain('pr#42');
    expect(body['stats']).toContain('b'.repeat(40));
    expect(body['branch']).toBe('feat/gate');
  });

  it('keys the page on the commit, so a new push cannot reuse the old approval', () => {
    const first = pullRequestPageRequest(pr);
    const pushed = pullRequestPageRequest({ ...pr, sha: 'c'.repeat(40) });
    expect(first['dedupe_key']).toBe(`gate-pr:Tradoooo/bipeur:42:${'b'.repeat(40)}`);
    expect(pushed['dedupe_key']).not.toBe(first['dedupe_key']);
    expect(pushed['stats']).not.toBe(first['stats']);
  });

  it('accepts an explicit command without dropping the sha', () => {
    const body = pullRequestPageRequest({ ...pr, command: 'flyctl deploy --ha=false' });
    expect(body['command']).toBe('flyctl deploy --ha=false');
    expect(String(body['stats'])).toContain('b'.repeat(40));
  });

  it('refuses a pull-request gate that does not know the commit', () => {
    expect(() => pullRequestPageRequest({ ...pr, sha: '' })).toThrow(/"sha" is required/);
    expect(() => pullRequestPageRequest({ ...pr, prNumber: '' })).toThrow(/"pr-number" is required/);
  });
});
