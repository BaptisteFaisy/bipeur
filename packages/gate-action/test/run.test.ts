/**
 * BIP-F-48 — the whole step, with a fake Central: page, wait, decide, report,
 * exit code. Nothing here opens a socket or sleeps for real, and the token that
 * the fake Central leaks in an error message must never reach the job log.
 */
import { describe, expect, it } from 'vitest';
import { factsOf, fingerprintOf } from '../../central/src/compose.js';
import { runGate, runGatePr } from '../src/index.js';

const TOKEN = 'supers…cret';

/** The Central, as a value: what it was asked, and the answers it will give. */
function fakeCentral(waits: unknown[], options: { page?: unknown; failWith?: Error } = {}) {
  const bodies: Record<string, unknown>[] = [];
  const polls: { pageId: string; seconds: number }[] = [];
  let index = 0;
  return {
    bodies,
    polls,
    async createPage(body: Record<string, unknown>) {
      if (options.failWith) throw options.failWith;
      bodies.push(body);
      return { id: 'pg_1', line: '310 bip DEPLOY fly deploy #a3f9', fingerprint: 'f'.repeat(64), station: 'bipeur', ...(options.page ?? {}) };
    },
    async waitDecision(pageId: string, seconds: number) {
      polls.push({ pageId, seconds });
      const answer = waits[Math.min(index, waits.length - 1)];
      index += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

function io() {
  const lines: string[] = [];
  return {
    lines,
    log: (text: string) => lines.push(text),
    info: (text: string) => lines.push(text),
    error: (text: string) => lines.push(text),
  };
}

const env = {
  INPUT_URL: 'https://pager.example.com',
  INPUT_TOKEN: TOKEN,
  INPUT_COMMAND: 'flyctl deploy --ha=false',
  GITHUB_REPOSITORY: 'Tradoooo/bipeur',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_WORKSPACE: '/w',
  GITHUB_RUN_ID: '77',
  GITHUB_RUN_ATTEMPT: '1',
};

/** A clock that moves by `step` on every read, so the loop terminates at once. */
function movingClock(step: number) {
  let t = 1_700_000_000_000;
  return () => (t += step);
}

async function gate(central: ReturnType<typeof fakeCentral>, overrides: Record<string, string> = {}) {
  const sink = io();
  const exits: number[] = [];
  const verdict = await runGate({
    env: { ...env, ...overrides },
    central,
    io: sink,
    exit: (code: number) => exits.push(code),
    now: movingClock(30_000),
    sleep: async () => undefined,
  });
  return { verdict, sink, exits };
}

describe('runGate — the job runs, or the job fails', () => {
  it('passes the step on a human approval and publishes the page', async () => {
    const central = fakeCentral([{ status: 'approved', simulated: false, page_id: 'pg_1', latency_ms: 4200 }]);
    const { verdict, sink, exits } = await gate(central);
    expect(verdict.outcome).toBe('pass');
    expect(exits).toEqual([]);
    expect(central.bodies[0]!['command']).toBe('flyctl deploy --ha=false');
    expect(String(central.bodies[0]!['stats'])).toContain('a'.repeat(40));
    expect(sink.lines.join('\n')).toContain('310 bip DEPLOY fly deploy #a3f9');
  });

  it('fails the step on a refusal, with one error line and exit 1', async () => {
    const central = fakeCentral([{ status: 'denied', reason: 'not from CI', page_id: 'pg_1' }]);
    const { verdict, sink, exits } = await gate(central);
    expect(verdict.outcome).toBe('fail');
    expect(verdict.reason).toContain('not from CI');
    expect(exits).toEqual([1]);
    expect(sink.lines.join('\n')).toContain('::error::');
  });

  it('fails on an expiry and on a page still pending at the deadline', async () => {
    const expired = await gate(fakeCentral([{ status: 'expired', page_id: 'pg_1' }]));
    expect(expired.verdict.outcome).toBe('fail');
    expect(expired.verdict.reason).toMatch(/timeout is never an approval/);

    const pending = await gate(fakeCentral([{ status: 'pending', page_id: 'pg_1' }]));
    expect(pending.verdict.outcome).toBe('fail');
    expect(pending.verdict.reason).toMatch(/no decision before the job deadline/);
  });

  it('fails when shadow mode approved instead of a human (BIP-F-42)', async () => {
    const { verdict } = await gate(fakeCentral([{ status: 'approved', simulated: true, page_id: 'pg_1' }]));
    expect(verdict.outcome).toBe('fail');
    expect(verdict.reason).toMatch(/shadow mode/);
  });

  it('fails when the choice the human picked is not the one the workflow declared', async () => {
    const central = fakeCentral([{ status: 'choice', choice: 'B', page_id: 'pg_1' }]);
    const { verdict } = await gate(central);
    expect(verdict.outcome).toBe('fail');
    const allowed = await gate(fakeCentral([{ status: 'choice', choice: 'B', page_id: 'pg_1' }]), {
      'INPUT_ALLOW-CHOICE': 'B',
    });
    expect(allowed.verdict.outcome).toBe('pass');
  });

  it('long-polls with slices the Central accepts (50 s cap), never one 10-minute wait', async () => {
    const central = fakeCentral([{ status: 'pending' }, { status: 'approved' }]);
    await gate(central, { 'INPUT_TIMEOUT-MINUTES': '10' });
    expect(central.polls.length).toBeGreaterThan(0);
    for (const poll of central.polls) expect(poll.seconds).toBeLessThanOrEqual(50);
  });

  it('fails closed when the Central cannot be reached, and retries a blip', async () => {
    const blip = fakeCentral([new Error('ECONNRESET'), { status: 'approved' }]);
    const recovered = await gate(blip);
    expect(recovered.verdict.outcome).toBe('pass');

    const down = fakeCentral([], { failWith: new Error(`connect ECONNREFUSED (token ${TOKEN})`) });
    const failed = await gate(down);
    expect(failed.verdict.outcome).toBe('fail');
    expect(failed.verdict.reason).toMatch(/could not be reached/);
    expect(failed.sink.lines.join('\n')).not.toContain(TOKEN);
  });

  it('never prints the token, whatever the Central echoed back', async () => {
    const central = fakeCentral([{ status: 'approved' }]);
    const { sink } = await gate(central);
    expect(sink.lines.join('\n')).not.toContain(TOKEN);
    expect(sink.lines.join('\n')).toContain('310 bip DEPLOY');
  });

  it('names the missing input and fails without paging anybody', async () => {
    const central = fakeCentral([{ status: 'approved' }]);
    const sink = io();
    const exits: number[] = [];
    const verdict = await runGate({
      env: { ...env, INPUT_COMMAND: '' },
      central,
      io: sink,
      exit: (code: number) => exits.push(code),
    });
    expect(verdict.outcome).toBe('fail');
    expect(verdict.reason).toMatch(/"command" is required/);
    expect(central.bodies).toEqual([]);
    expect(exits).toEqual([1]);
  });
});

describe('the SHA binding is the real fingerprint, not a claim', () => {
  const prEnv = { ...env, GITHUB_SHA: 'd'.repeat(40), GITHUB_EVENT_PATH: '/tmp/event.json' };
  const event = {
    number: 42,
    pull_request: { head: { sha: 'b'.repeat(40), ref: 'feat/gate' }, base: { ref: 'main' } },
    repository: { full_name: 'Tradoooo/bipeur' },
  };

  async function gatePr(shas: string) {
    const central = fakeCentral([{ status: 'approved' }]);
    const result = await runGatePr({
      env: { ...prEnv, 'INPUT_SHA': shas },
      central,
      io: io(),
      exit: () => undefined,
      now: movingClock(30_000),
      sleep: async () => undefined,
      // The event payload is read through the injected reader, so no runner.
      readEvent: () => JSON.stringify(event),
    });
    return { central, result };
  }

  it('pages the head SHA of the pull request', async () => {
    const { central } = await gatePr('');
    const body = central.bodies[0]!;
    expect(Object.values(factsOf(body as never)).join(' ')).toContain('b'.repeat(40));
    expect(String(body['dedupe_key'])).toContain(`42:${'b'.repeat(40)}`);
  });

  it('a new push is a different fingerprint, so an approval cannot ride onto another commit', async () => {
    const before = await gatePr('');
    const after = await gatePr('c'.repeat(40));
    const fpBefore = fingerprintOf(before.central.bodies[0]! as never);
    const fpAfter = fingerprintOf(after.central.bodies[0]! as never);
    expect(fpBefore).toMatch(/^[0-9a-f]{64}$/);
    expect(fpAfter).toMatch(/^[0-9a-f]{64}$/);
    expect(fpAfter).not.toBe(fpBefore);
  });

  it('the same commit twice is the same fingerprint — the page is deduped, not re-paged', async () => {
    const first = await gatePr('');
    const second = await gatePr('');
    const a = fingerprintOf(first.central.bodies[0]! as never);
    const b = fingerprintOf(second.central.bodies[0]! as never);
    expect(a).toBe(b);
  });
});
