/**
 * BIP-F-48 — what the gate writes back to GitHub: outputs, log, summary. The two
 * things asserted here are the ones that break workflows silently: a value that
 * must stay on one line, and a secret that must never appear.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReporter, outputLine, redact, workflowCommand } from '../src/index.js';

const TOKEN = 'supers…cret';

describe('outputLine', () => {
  it('writes the simple form for a one-line value', () => {
    expect(outputLine('page_id', 'pg_1')).toBe('page_id=pg_1');
    expect(outputLine('simulated', false)).toBe('simulated=false');
    expect(outputLine('choice', null)).toBe('choice=');
  });
  it('falls back to the delimited form when a value could be misread', () => {
    const line = outputLine('why', 'deploy 100% of the fleet, "sure"');
    expect(line.split('\n')).toHaveLength(3);
    const [head, value, tail] = line.split('\n');
    expect(head).toBe('why<<bipeur_why_delimiter');
    expect(value).toBe('deploy 100% of the fleet, "sure"');
    expect(tail).toBe('bipeur_why_delimiter');
  });
});

describe('workflowCommand', () => {
  it('escapes what the runner would otherwise read as a new command', () => {
    expect(workflowCommand('error', 'gate refused\n::error::hidden')).toBe(
      '::error::gate refused%0A::error::hidden',
    );
    expect(workflowCommand('notice', '100% sure')).toBe('::notice::100%25 sure');
  });
});

describe('redact', () => {
  it('replaces every occurrence of a secret and drops short values', () => {
    expect(redact(`token ${TOKEN} and again ${TOKEN}`, [TOKEN])).toBe(`token *** and again ***`);
    expect(redact('abc', ['ab'])).toBe('abc');
  });
});

describe('createReporter', () => {
  it('appends outputs and the summary to the files the runner declared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-report-'));
    const output = join(dir, 'output');
    const summary = join(dir, 'summary');
    writeFileSync(output, '');
    writeFileSync(summary, '');
    const lines: string[] = [];
    const reporter = createReporter(
      { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
      sink(lines),
      () => undefined,
      [TOKEN],
    );
    reporter.setOutput('page_id', 'pg_1');
    reporter.summary([['line', '310 bip DEPLOY main #a3f9'], ['why', `leaked ${TOKEN}`]]);
    expect(readFileSync(output, 'utf8').trim()).toBe('page_id=pg_1');
    const text = readFileSync(summary, 'utf8');
    expect(text).toContain('**line**: 310 bip DEPLOY main #a3f9');
    expect(text).not.toContain(TOKEN);
    expect(text).toContain('***');
  });

  it('fails the step with one error line and a non-zero exit', () => {
    const lines: string[] = [];
    const exits: number[] = [];
    const reporter = createReporter({}, sink(lines), (code) => exits.push(code), [TOKEN]);
    reporter.fail(`refused — token was ${TOKEN}`);
    expect(exits).toEqual([1]);
    expect(lines.join('\n')).toContain('::error::');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('is a no-op on outputs when the runner did not declare a file', () => {
    const lines: string[] = [];
    const reporter = createReporter({}, sink(lines), () => undefined, []);
    expect(() => reporter.setOutput('page_id', 'pg_1')).not.toThrow();
    expect(() => reporter.summary([['a', 'b']])).not.toThrow();
  });
});

function sink(collector: string[]) {
  return {
    log: (text: string) => collector.push(text),
    info: (text: string) => collector.push(text),
    error: (text: string) => collector.push(text),
  };
}
