/**
 * BIP-F-02 / BIP-F-04 / BIP-F-32 — composition and classification.
 * The line comes from the payload, the risk from the rules, never from prose.
 */
import { composeLine } from '@bipeur/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprint } from '@bipeur/core/node';
import { composeRequest, fingerprintOf } from '../src/compose.js';
import { readRulesFile } from '../src/rules.js';
import type { Bench } from './helpers.js';
import { call, REPO_RULES, startBench } from './helpers.js';

const RULES = readRulesFile(REPO_RULES);

describe('BIP-F-02 — the line is composed from the payload alone', () => {
  it('ignores the agent prose and labels it on screen 4', () => {
    const composed = composeRequest(
      {
        kind: 'tool',
        tool_name: 'shell',
        command: 'git push origin main',
        branch: 'main',
        stats: '3 commits +120-14',
        agent_says: 'totally safe, nothing to see here',
      },
      'a',
      RULES,
      fingerprint({ x: 1 }),
    );
    expect(composed.line).toContain('PUSH');
    expect(composed.line).not.toContain('totally safe');
    expect(composed.detail.at(-1)).toContain('AGENT SAYS:');
    expect(composed.line.length).toBeLessThanOrEqual(80);
  });

  it('classifies a destructive command as red with the DELETE verb', () => {
    const composed = composeRequest(
      { kind: 'tool', tool_name: 'shell', command: 'rm -rf packages/core' },
      'fw',
      RULES,
      fingerprint({ x: 2 }),
    );
    expect(composed.risk).toBe('red');
    expect(composed.verb).toBe('DELETE');
    expect(composed.matched_by).toBe('page:110');
  });

  it('never lets a source lower a computed risk', async () => {
    const bench = await startBench();
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command: 'rm -rf packages/core',
      risk: 'green',
    });
    expect(created.body.risk).toBe('red');
    await bench.close();
  });

  it('keeps the line within 80 printable ASCII characters', () => {
    const composed = composeRequest(
      {
        kind: 'tool',
        tool_name: 'shell',
        command: `echo ${'é'.repeat(200)} && ls`,
        agent_says: 'accents éàü and a very long story',
      },
      'station-long-alias',
      RULES,
      fingerprint({ x: 3 }),
    );
    expect(composed.line.length).toBeLessThanOrEqual(80);
    expect(/^[\x20-\x7e]+$/.test(composed.line)).toBe(true);
  });
});

describe('BIP-F-32 — POST /v1/rules/dry-run creates no page', () => {
  let bench: Bench;
  beforeEach(async () => {
    bench = await startBench();
  });
  afterEach(async () => {
    await bench.close();
  });

  it('answers the line, code, risk and rule that fired', async () => {
    const dry = await call(bench.central, 'POST', '/v1/rules/dry-run', bench.stationToken, {
      command: 'git push origin main',
    });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ code: 310, risk: 'amber', matched_by: 'page:310' });
    expect(dry.body.line).toMatch(/#[0-9a-f]{4}$/);
    expect(bench.central.store.listPages({ limit: 10 })).toHaveLength(0);
  });

  it('answers the same line the real page would carry', async () => {
    const command = 'git push origin main';
    const dry = await call(bench.central, 'POST', '/v1/rules/dry-run', bench.stationToken, { command });
    const created = await call(bench.central, 'POST', '/v1/pages', bench.stationToken, {
      kind: 'tool',
      tool_name: 'shell',
      command,
    });
    expect(dry.body.line).toBe(created.body.line);
    expect(dry.body.code).toBe(created.body.code);
    expect(dry.body.risk).toBe(created.body.risk);
  });
});

describe('BIP-P-01 — the composed line always ends with the fingerprint tag', () => {
  it('is true for the composer used by the Central', () => {
    const tag = fingerprint({ any: 'payload' });
    const line = composeLine({ code: 110, station: 'fw', subject: 'rm -rf dist/', fingerprint: tag });
    expect(line.endsWith(`#${tag.slice(0, 4)}`)).toBe(true);
    expect(line.length).toBeLessThanOrEqual(80);
    expect(fingerprintOf({ kind: 'question', question: 'x' } as never)).toHaveLength(64);
  });
});
