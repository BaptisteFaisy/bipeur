/**
 * The Beeper side of the gateway: the SNPP message becomes a page payload the
 * Central validates (the honesty rule), and the HTTP client speaks the two
 * endpoints of A.9 with the station token.
 */
import { describe, expect, it } from 'vitest';
import {
  CentralError,
  buildPageRequest,
  httpBeeperClient,
  parsePageLine,
  type FetchLike,
  type PageDraft,
} from '../src/client.js';

const draft = (overrides: Partial<PageDraft> = {}): PageDraft => ({
  pager: 'lea',
  message: '310 fw PUSH main>origin 3 commits +120-14 #07c2',
  choices: [
    { code: '0001', text: 'Approve' },
    { code: '0002', text: 'Deny' },
  ],
  ackRead: true,
  ttlSeconds: 900,
  ...overrides,
});

describe('parsePageLine — the MESSage text is already a page line', () => {
  it('splits code, station, verb and subject', () => {
    expect(parsePageLine('310 fw PUSH main>origin 3 commits +120-14 #07c2')).toEqual({
      code: 310,
      station: 'fw',
      verb: 'PUSH',
      subject: 'main>origin 3 commits +120-14 #07c2',
    });
  });

  it('drops a code that Beeper does not know, keeping the text', () => {
    // 080 is below the range of A.6 (codes start at 100), so the whole message
    // is a question.
    const parsed = parsePageLine('080 fw RUN something');
    expect(parsed.code).toBeUndefined();
    expect(parsed.station).toBe('snpp');
    expect(parsed.subject).toBe('080 fw RUN something');
  });

  it('treats free text as a plain question', () => {
    expect(parsePageLine('Deploy now?')).toEqual({ station: 'snpp', subject: 'Deploy now?' });
  });
});

describe('buildPageRequest — validated by the shared contract', () => {
  it('maps the seeded replies to the pager letters', () => {
    const request = buildPageRequest(draft());
    expect(request.kind).toBe('question');
    if (request.kind !== 'question') return;
    expect(request.options).toEqual([
      { code: 'A', label: 'Approve' },
      { code: 'B', label: 'Deny' },
    ]);
    expect(request.ttl_seconds).toBe(900);
    expect(request.station).toBe('fw');
    expect(request.code).toBe(310);
    expect(request.verb).toBe('PUSH');
  });

  it('sends no options when fewer than two replies were seeded', () => {
    const request = buildPageRequest(draft({ choices: [{ code: '0001', text: 'Go' }] }));
    if (request.kind !== 'question') throw new Error('expected a question');
    expect(request.options).toBeUndefined();
  });

  it('clamps the lifetime to the bounds of the contract', () => {
    const short = buildPageRequest(draft({ ttlSeconds: 1 }));
    const long = buildPageRequest(draft({ ttlSeconds: 999_999 }));
    if (short.kind !== 'question' || long.kind !== 'question') throw new Error('question');
    expect(short.ttl_seconds).toBe(30);
    expect(long.ttl_seconds).toBe(86_400);
  });

  it('refuses a payload the contract would reject, with a clear error', () => {
    expect(() => buildPageRequest(draft({ message: '' }))).toThrow(CentralError);
  });
});

interface Recorded {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(answers: { status: number; body: unknown }[]): {
  impl: FetchLike;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const impl: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const answer = answers.shift() ?? { status: 200, body: {} };
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
    });
  };
  return { impl, calls };
}

describe('httpBeeperClient — the two endpoints of A.9', () => {
  it('POSTs the page with the station token and reads the page id', async () => {
    const { impl, calls } = fakeFetch([
      { status: 201, body: { page_id: 'page_1', fingerprint: 'ab', line: '310 fw PUSH x #ab12' } },
    ]);
    const client = httpBeeperClient({ url: 'http://central.test/', token: 'bip_t', fetchImpl: impl });
    const created = await client.createPage(draft());

    expect(created.pageId).toBe('page_1');
    expect(calls[0]!.url).toBe('http://central.test/v1/pages');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers?.authorization).toBe('Bearer bip_t');
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ kind: 'question', station: 'fw' });
  });

  it('GETs the decision with the wait of the caller', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { status: 'choice', choice: 'B', latency_ms: 41200 } },
    ]);
    const client = httpBeeperClient({ url: 'http://central.test', token: 't', fetchImpl: impl });
    const decision = await client.waitDecision('page_1', 25);

    expect(decision).toEqual({ status: 'choice', choice: 'B', latencyMs: 41_200 });
    expect(calls[0]!.url).toBe('http://central.test/v1/pages/page_1/decision?wait=25');
  });

  it('reads the page state for the read acknowledgement', async () => {
    const { impl } = fakeFetch([{ status: 200, body: { state: 'read' } }]);
    const client = httpBeeperClient({ url: 'http://central.test', token: 't', fetchImpl: impl });
    expect(await client.getPageState?.('page_1')).toBe('read');
  });

  it('answers false when the Central is unreachable', async () => {
    const impl: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));
    const client = httpBeeperClient({ url: 'http://central.test', token: 't', fetchImpl: impl });
    expect(await client.isOnline()).toBe(false);
  });

  it('raises a CentralError on a refused page', async () => {
    const { impl } = fakeFetch([{ status: 401, body: {} }]);
    const client = httpBeeperClient({ url: 'http://central.test', token: 't', fetchImpl: impl });
    await expect(client.createPage(draft())).rejects.toThrow(CentralError);
  });
});
