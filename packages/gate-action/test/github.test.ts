/**
 * BIP-F-48 — the GitHub side: refs, the event payload, and the commit a decision
 * binds to. Tested with fixtures, never with a runner.
 */
import { describe, expect, it } from 'vitest';
import { GateError, loadEvent, prContext, refParts, repoShortName, jobContext } from '../src/index.js';

const env = { GITHUB_SHA: 'f'.repeat(40), GITHUB_REPOSITORY: 'Tradoooo/bipeur', GITHUB_REF: 'refs/heads/main' };

describe('refParts', () => {
  it('reads a pull request ref and a branch ref', () => {
    expect(refParts('refs/pull/42/merge')).toEqual({ kind: 'pull', number: '42', name: '' });
    expect(refParts('refs/heads/feat/gate')).toEqual({ kind: 'head', number: '', name: 'feat/gate' });
    expect(refParts('')).toEqual({ kind: 'other', number: '', name: '' });
  });
});

describe('repoShortName', () => {
  it('gives the station alias, not the owner', () => {
    expect(repoShortName('Tradoooo/bipeur')).toBe('bipeur');
    expect(repoShortName('')).toBe('');
  });
});

describe('prContext — the commit under review', () => {
  const event = {
    number: 42,
    pull_request: { head: { sha: 'AABBCCDDEEFF00112233'.repeat(2), ref: 'feat/gate' }, base: { ref: 'main' } },
    repository: { full_name: 'Tradoooo/bipeur' },
  };

  it('prefers the head SHA over GITHUB_SHA, which is a throwaway merge commit', () => {
    const ctx = prContext(event, env);
    expect(ctx.sha).toBe('aabbccddeeff00112233'.repeat(2));
    expect(ctx.number).toBe('42');
    expect(ctx.headRef).toBe('feat/gate');
    expect(ctx.baseRef).toBe('main');
    expect(ctx.repo).toBe('Tradoooo/bipeur');
  });

  it('falls back to GITHUB_SHA on a push event, and lowercases either', () => {
    const ctx = prContext({ after: 'DEADBEEF'.repeat(5) }, env);
    expect(ctx.sha).toBe('deadbeef'.repeat(5));
    expect(prContext({}, env).sha).toBe('f'.repeat(40));
  });

  it('refuses to gate a commit it cannot name', () => {
    expect(() => prContext({}, {})).toThrow(GateError);
    expect(() => prContext({}, {})).toThrow(/no commit to bind/);
    expect(() => prContext({ after: 'not-a-sha' }, {})).toThrow(/no commit to bind/);
  });
});

describe('jobContext', () => {
  it('collects the facts a deploy job knows about itself', () => {
    const ctx = jobContext({ ...env, GITHUB_WORKSPACE: '/w', GITHUB_RUN_ID: '77', GITHUB_WORKFLOW: 'ship' });
    expect(ctx).toMatchObject({ sha: 'f'.repeat(40), ref: 'main', repo: 'Tradoooo/bipeur', runId: '77', workspace: '/w' });
  });
});

describe('loadEvent', () => {
  it('parses the payload file the runner points at', () => {
    const event = loadEvent({ GITHUB_EVENT_PATH: '/x/event.json' }, () => '{"number":9}');
    expect(event['number']).toBe(9);
  });
  it('is empty without a path or an unreadable file: the environment still answers', () => {
    expect(loadEvent({})).toEqual({});
    expect(loadEvent({ GITHUB_EVENT_PATH: '/x' }, () => { throw new Error('ENOENT'); })).toEqual({});
  });
  it('fails loudly on a payload that is not JSON', () => {
    expect(() => loadEvent({ GITHUB_EVENT_PATH: '/x' }, () => 'not json')).toThrow(/not JSON/);
  });
});
