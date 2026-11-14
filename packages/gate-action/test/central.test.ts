/**
 * BIP-F-48 — reading the wire and talking to the Central. No socket: `fetchImpl`
 * is injected, so the shape of the answer and the hygiene of the message are both
 * asserted directly.
 */
import { describe, expect, it } from 'vitest';
import { GateError, createCentral, pageOf, requestOf, waitOf } from '../src/index.js';

const TOKEN = 'supers…cret';

/** Either a payload, or a responder that builds one (a status, a body, an error). */
type Responder = (url: string, init?: RequestInit) => unknown;

/** A fetch that records what it was asked and answers `answer`. */
function fakeFetch(answer: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const responder = answer as Responder;
  const impl = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const body = typeof answer === 'function' ? responder(url, init) : answer;
    if (body instanceof Error) throw body;
    // A function may answer with a full fake Response (status, body reader).
    if (body && typeof body === 'object' && 'ok' in (body as object)) return body as Response;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  };
  return { impl, calls };
}

describe('pageOf — the three shapes the Central has answered', () => {
  it('reads the documented page_id answer', () => {
    const page = pageOf({ page_id: 'pg_1', line: '310 bip DEPLOY main #a3f9', fingerprint: 'ab'.repeat(32), code: 310 });
    expect(page).toMatchObject({ id: 'pg_1', line: '310 bip DEPLOY main #a3f9', code: 310 });
  });
  it('still accepts {id} and {page:{id}}', () => {
    expect(pageOf({ id: 'pg_2' }).id).toBe('pg_2');
    expect(pageOf({ page: { id: 'pg_3', line: 'x' } }).line).toBe('x');
  });
  it('refuses an answer with no page id rather than waiting on nothing', () => {
    expect(() => pageOf({ line: 'no id' })).toThrow(/did not return a page id/);
    expect(() => pageOf(null)).toThrow(/did not return a page id/);
  });
});

describe('waitOf — a decision the contract does not know is an error', () => {
  it('reads a settled answer', () => {
    const wait = waitOf({ status: 'approved', simulated: false, page_id: 'pg_1', choice: null, fingerprint: 'ff', latency_ms: 4200 });
    expect(wait).toMatchObject({ status: 'approved', simulated: false, latencyMs: 4200, choice: null });
  });
  it('marks a shadow-mode verdict as simulated, not as approved-by-a-human', () => {
    expect(waitOf({ status: 'approved', simulated: true }).simulated).toBe(true);
  });
  it('rejects a missing or unknown status', () => {
    expect(() => waitOf({})).toThrow(/no status/);
    expect(() => waitOf({ status: 'maybe' })).toThrow(/unknown status/);
  });
});

describe('requestOf', () => {
  it('joins the base without doubling slashes', () => {
    expect(requestOf('https://p.example.com/', '/v1/pages', {}).url).toBe('https://p.example.com/v1/pages');
  });
});

describe('createCentral', () => {
  it('posts the page with a bearer token and returns the id', async () => {
    const { impl, calls } = fakeFetch({ page_id: 'pg_1', line: 'l' });
    const central = createCentral({ url: 'https://p.example.com', token: TOKEN, fetchImpl: impl });
    const page = await central.createPage({ kind: 'tool', command: 'fly deploy' });
    expect(page.id).toBe('pg_1');
    expect(calls[0]!.url).toBe('https://p.example.com/v1/pages');
    expect(calls[0]!.init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(String(calls[0]!.init.body))['command']).toBe('fly deploy');
  });

  it('long-polls the decision with the wait it was given', async () => {
    const { impl, calls } = fakeFetch({ status: 'pending', page_id: 'pg_1' });
    const central = createCentral({ url: 'https://p.example.com', token: TOKEN, fetchImpl: impl });
    const wait = await central.waitDecision('pg_1', 45);
    expect(wait.status).toBe('pending');
    expect(calls[0]!.url).toBe('https://p.example.com/v1/pages/pg_1/decision?wait=45');
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('turns a non-2xx answer into a refusal-shaped error, without the token', async () => {
    const { impl } = fakeFetch(() => ({
      ok: false,
      status: 401,
      text: async () => `bad token ${TOKEN}`,
    }));
    const central = createCentral({ url: 'https://p.example.com', token: TOKEN, fetchImpl: impl });
    let message = '';
    await central.createPage({ kind: 'tool' }).catch((error: Error) => { message = error.message; });
    expect(message).toContain('401');
    expect(message).not.toContain(TOKEN);
    expect(message).toContain('***');
  });

  it('treats an unreachable Central as a value, never as an approval', async () => {
    const { impl } = fakeFetch(new Error('connect ECONNREFUSED 10.0.0.1:8080'));
    const central = createCentral({ url: 'https://p.example.com', token: TOKEN, fetchImpl: impl });
    await expect(central.createPage({ kind: 'tool' })).rejects.toBeInstanceOf(GateError);
    await expect(central.createPage({ kind: 'tool' })).rejects.toThrow(/ECONNREFUSED/);
  });

  it('refuses a non-JSON body instead of parsing a proxy page', async () => {
    const { impl } = fakeFetch(() => ({ ok: true, status: 200, text: async () => '<html>gateway</html>' }));
    const central = createCentral({ url: 'https://p.example.com', token: TOKEN, fetchImpl: impl });
    await expect(central.createPage({ kind: 'tool' })).rejects.toThrow(/non-JSON/);
  });
});
