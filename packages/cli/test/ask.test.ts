import { describe, expect, it } from 'vitest';
import { fakeCentral, fakeClock } from './fake-central.js';
import { runCli } from '../src/run.js';

interface RunOutput {
  code: number;
  out: string;
  err: string;
}

async function run(argv: string[], script: Parameters<typeof fakeCentral>[0] = {}): Promise<RunOutput & { calls: ReturnType<typeof fakeCentral>['calls'] }> {
  const central = fakeCentral(script);
  const clock = fakeClock();
  let out = '';
  let err = '';
  const code = await runCli(argv, {
    env: {},
    fetchImpl: central.fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err, calls: central.calls };
}

describe('BIP-F-29 — bip ask exit codes', () => {
  it('exits 0 when the human says yes', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--token', 'tok'], {
      decisions: ['approved'],
    });
    expect(result.code).toBe(0);
    expect(result.out).toContain('510 crew PICK Deploy now? #a3f9');
    expect(result.out).toContain('approved');
  });

  it('exits 1 when the human says no', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--token', 'tok'], {
      decisions: ['denied'],
    });
    expect(result.code).toBe(1);
  });

  it('exits 3 when the page expires', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--ttl', '30s', '--token', 'tok'], {
      decisions: ['pending'],
    });
    expect(result.code).toBe(3);
    expect(result.out).toContain('expired');
  });

  it('exits 2 when the Central is unreachable', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--token', 'tok'], {
      failCreate: true,
    });
    expect(result.code).toBe(2);
    expect(result.err).toContain('central unreachable');
  });

  it('exits 2 when the Central answers an error status', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--token', 'tok'], {
      statusCreate: 503,
    });
    expect(result.code).toBe(2);
    expect(result.err).toContain('503');
  });

  it('exits 2 without a token', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('BIPEUR_TOKEN');
    expect(result.calls).toHaveLength(0);
  });

  it('exits 2 on an invalid --ttl, without calling the Central', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--ttl', 'soon', '--token', 'tok']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('invalid --ttl');
    expect(result.calls).toHaveLength(0);
  });

  it('maps a yes/no choice verdict to 0 and 1', async () => {
    const yes = await run(['ask', 'Deploy now?', '--yes-no', '--token', 'tok'], {
      decisions: ['choice'],
      choice: 'A',
    });
    expect(yes.code).toBe(0);
    const no = await run(['ask', 'Deploy now?', '--yes-no', '--token', 'tok'], {
      decisions: ['choice'],
      choice: 'B',
    });
    expect(no.code).toBe(1);
  });

  it('polls again while the decision is pending', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--token', 'tok'], {
      decisions: ['pending', 'pending', 'approved'],
    });
    expect(result.code).toBe(0);
    expect(result.calls.filter((call) => call.url.includes('/decision'))).toHaveLength(3);
  });
});

describe('BIP-F-29 — bip ask --json', () => {
  it('prints exactly {status, choice, page_id, latency_ms}', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--json', '--token', 'tok'], {
      decisions: ['approved'],
      latencyMs: 1200,
    });
    const parsed: unknown = JSON.parse(result.out);
    expect(parsed).toEqual({
      status: 'approved',
      choice: null,
      page_id: 'page_1',
      latency_ms: 1200,
    });
    expect(Object.keys(parsed as object)).toEqual(['status', 'choice', 'page_id', 'latency_ms']);
    expect(result.out.trim().split('\n')).toHaveLength(1);
  });

  it('sends the choice page and returns the chosen letter', async () => {
    const result = await run(
      ['ask', 'Which date lib?', '--choice', 'A=dayjs,B=luxon,C=temporal', '--json', '--token', 'tok'],
      { decisions: ['choice'], choice: 'C' },
    );
    const parsed = JSON.parse(result.out) as { status: string; choice: string | null };
    expect(parsed).toEqual(expect.objectContaining({ status: 'choice', choice: 'C' }));
    expect(result.code).toBe(0);

    const created = result.calls.find((call) => call.url.endsWith('/v1/pages'));
    expect(created?.body).toMatchObject({
      kind: 'question',
      question: 'Which date lib?',
      options: [
        { code: 'A', label: 'dayjs' },
        { code: 'B', label: 'luxon' },
        { code: 'C', label: 'temporal' },
      ],
    });
  });

  it('sends the ttl in seconds and the station alias', async () => {
    const result = await run(
      ['ask', 'Deploy now?', '--yes-no', '--ttl', '10m', '--station', 'fw', '--token', 'tok'],
      { decisions: ['approved'] },
    );
    const created = result.calls.find((call) => call.url.endsWith('/v1/pages'));
    expect(created?.body).toMatchObject({ ttl_seconds: 600, station: 'fw' });
  });
});

describe('BIP-F-29 — bip --dry-run and bip notify', () => {
  it('composes the line without touching the Central', async () => {
    const result = await run(['ask', 'Deploy now?', '--yes-no', '--dry-run', '--token', 'tok']);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^510 cli PICK Deploy now\? #[0-9a-f]{4}$/m);
    expect(result.out).toContain('dry run');
    expect(result.calls).toHaveLength(0);
  });

  it('logs a notice without creating a page', async () => {
    const result = await run(['notify', 'night build finished', '--token', 'tok']);
    expect(result.code).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.url).toContain('/v1/notices');
    expect(result.calls[0]?.body).toMatchObject({ line: 'night build finished' });
  });

  it('prints the help page with the exit codes', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Exit codes');
    expect(result.out).toContain('3  expired');
  });
});
